import * as vscode from 'vscode';
import * as path from 'path';

type NotesMap = Record<string, string>;

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function toRelKey(folder: vscode.WorkspaceFolder, fileUri: vscode.Uri): string {
  return path.relative(folder.uri.fsPath, fileUri.fsPath).replace(/\\/g, '/');
}

export class NotesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'filebound-notes.notesView';

  private _view?: vscode.WebviewView;
  private _currentRelPath: string | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _storageUri: vscode.Uri | undefined
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; content?: string; relPath?: string }) => {
      if (message.type === 'ready') {
        await this._sendCurrentNote();
      } else if (message.type === 'save' && message.relPath) {
        // relPath carried in the message avoids the race: the save always
        // targets the file that was active when the user typed, not the
        // file that happens to be active when the debounce fires.
        await this._persistNote(message.relPath, message.content ?? '');
      } else if (message.type === 'clearFile' && this._currentRelPath !== null) {
        await this._persistNote(this._currentRelPath, '');
        await this._sendCurrentNote();
      } else if (message.type === 'openStorage') {
        await this._revealStorageFile();
      }
    });

    // Fix: dispose the listener when the webview is disposed to prevent
    // accumulation if the panel is closed and reopened.
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(async () => {
      await this._sendCurrentNote();
    });
    webviewView.onDidDispose(() => activeEditorListener.dispose());

    webviewView.onDidChangeVisibility(async () => {
      if (webviewView.visible) {
        await this._sendCurrentNote();
      }
    });
  }

  // Called from extension.ts when files are renamed/moved
  public async handleRenameFiles(
    files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>
  ): Promise<void> {
    const notes = await this._loadNotes();
    let changed = false;

    for (const { oldUri, newUri } of files) {
      const folder = this._resolveWorkspaceFolder(oldUri);
      if (!folder) continue;

      const oldKey = toRelKey(folder, oldUri);
      if (!(oldKey in notes)) continue;

      const newFolder = this._resolveWorkspaceFolder(newUri) ?? folder;
      const newKey = toRelKey(newFolder, newUri);

      notes[newKey] = notes[oldKey];
      delete notes[oldKey];
      changed = true;

      // Keep UI in sync if the renamed file is currently active
      if (this._currentRelPath === oldKey) {
        this._currentRelPath = newKey;
      }
    }

    if (changed) {
      await this._writeNotes(notes);
    }
  }

  // Called from extension.ts when files are deleted
  public async handleDeleteFiles(files: ReadonlyArray<vscode.Uri>): Promise<void> {
    const notes = await this._loadNotes();
    let changed = false;

    for (const fileUri of files) {
      const folder = this._resolveWorkspaceFolder(fileUri);
      if (!folder) continue;

      const key = toRelKey(folder, fileUri);
      if (key in notes) {
        delete notes[key];
        changed = true;
      }
    }

    if (changed) {
      await this._writeNotes(notes);
    }
  }

  private async _revealStorageFile(): Promise<void> {
    const uri = this._notesFileUri();
    if (!uri) {
      vscode.window.showInformationMessage('File Notes: no workspace storage available.');
      return;
    }
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.commands.executeCommand('revealFileInOS', uri);
    } catch {
      vscode.window.showInformationMessage('File Notes: no notes saved yet.');
    }
  }

  // Called from extension.ts via the "Clear All Notes" command
  public async clearAllNotes(): Promise<void> {
    const count = Object.keys(await this._loadNotes()).length;
    if (count === 0) {
      vscode.window.showInformationMessage('File Notes: no notes to clear.');
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Delete all ${count} file note${count === 1 ? '' : 's'}?`,
      { modal: true },
      'Delete All'
    );
    if (answer !== 'Delete All') return;
    await this._writeNotes({});
    await this._sendCurrentNote();
  }

  private _resolveWorkspaceFolder(fileUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(fileUri);
  }

  private _notesFileUri(): vscode.Uri | undefined {
    if (!this._storageUri) return undefined;
    return vscode.Uri.joinPath(this._storageUri, 'file-notes.json');
  }

  private async _loadNotes(): Promise<NotesMap> {
    const uri = this._notesFileUri();
    if (!uri) return {};
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString('utf8')) as NotesMap;
    } catch {
      return {};
    }
  }

  private async _writeNotes(notes: NotesMap): Promise<void> {
    const uri = this._notesFileUri();
    if (!uri) return;
    if (Object.keys(notes).length === 0) {
      try {
        await vscode.workspace.fs.delete(uri);
      } catch {
        // file didn't exist — nothing to do
      }
      return;
    }
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(notes, null, 2), 'utf8')
    );
  }

  private async _persistNote(relPath: string, content: string): Promise<void> {
    const notes = await this._loadNotes();
    if (content === '') {
      delete notes[relPath];
    } else {
      notes[relPath] = content;
    }
    await this._writeNotes(notes);
  }

  private async _sendCurrentNote(): Promise<void> {
    if (!this._view) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._currentRelPath = null;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    const fileUri = editor.document.uri;
    const folder = this._resolveWorkspaceFolder(fileUri);

    if (!folder) {
      this._currentRelPath = null;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    const relPath = toRelKey(folder, fileUri);
    this._currentRelPath = relPath;

    const notes = await this._loadNotes();
    const content = notes[relPath] ?? '';
    const filename = path.basename(fileUri.fsPath);

    this._view.webview.postMessage({ type: 'load', file: filename, relPath, content });
  }

  private _getHtmlForWebview(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>File Notes</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 8px;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    #header {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      min-height: 18px;
    }

    #filename {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.75;
    }

    .hdr-btn {
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.6;
      flex-shrink: 0;
      line-height: 0;
      border-radius: 3px;
    }

    .hdr-btn:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }

    .hdr-btn.visible { display: flex; }

    #clear-btn { margin-left: 2px; }
    #reveal-btn { margin-left: auto; }

    #status {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0;
      transition: opacity 0.2s ease;
      white-space: nowrap;
      margin-left: 4px;
      flex-shrink: 0;
    }

    #status.visible { opacity: 1; }

    #placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      opacity: 0.6;
    }

    #textarea-wrapper {
      flex: 1;
      display: flex;
    }

    textarea {
      flex: 1;
      resize: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      line-height: 1.5;
      outline: none;
    }

    textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="header">
    <span id="filename"></span>
    <span id="status">Saved</span>
    <button id="reveal-btn" class="hdr-btn" title="Show notes file in Explorer">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"/>
      </svg>
    </button>
    <button id="clear-btn" class="hdr-btn" title="Clear note for this file">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66H14.5a.5.5 0 0 0 0-1h-.996a.59.59 0 0 0-.01 0zM3.04 3.5h9.92l-.845 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92z"/>
      </svg>
    </button>
  </div>
  <div id="placeholder">No file open</div>
  <div id="textarea-wrapper" class="hidden">
    <textarea id="note" placeholder="Write a note for this file…"></textarea>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const filenameEl = document.getElementById('filename');
    const statusEl   = document.getElementById('status');
    const revealBtn  = document.getElementById('reveal-btn');
    const clearBtn   = document.getElementById('clear-btn');
    const placeholderEl = document.getElementById('placeholder');
    const wrapperEl  = document.getElementById('textarea-wrapper');
    const noteEl     = document.getElementById('note');

    let saveTimer = null;
    let statusTimer = null;
    let currentRelPath = null;

    function flashSaved() {
      if (statusTimer) clearTimeout(statusTimer);
      statusEl.classList.add('visible');
      statusTimer = setTimeout(() => statusEl.classList.remove('visible'), 1500);
    }

    function flushSave() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      if (currentRelPath) {
        vscode.postMessage({ type: 'save', relPath: currentRelPath, content: noteEl.value });
        flashSaved();
      }
    }

    noteEl.addEventListener('input', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (currentRelPath) {
          vscode.postMessage({ type: 'save', relPath: currentRelPath, content: noteEl.value });
          flashSaved();
        }
      }, 500);
    });

    revealBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openStorage' });
    });

    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFile' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'load') return;

      if (msg.file === null) {
        flushSave();
        currentRelPath = null;
        filenameEl.textContent = '';
        revealBtn.classList.remove('visible');
        clearBtn.classList.remove('visible');
        placeholderEl.classList.remove('hidden');
        wrapperEl.classList.add('hidden');
      } else {
        flushSave();
        currentRelPath = msg.relPath;
        filenameEl.textContent = msg.file;
        revealBtn.classList.add('visible');
        clearBtn.classList.add('visible');
        placeholderEl.classList.add('hidden');
        wrapperEl.classList.remove('hidden');
        noteEl.value = msg.content;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
