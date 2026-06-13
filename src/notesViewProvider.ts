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

export class NotesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'filebound-notes.notesView';

  private _view?: vscode.WebviewView;
  private _currentRelPath: string | null = null;
  private _currentWorkspaceFolder: vscode.WorkspaceFolder | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; content?: string }) => {
      if (message.type === 'ready') {
        await this._sendCurrentNote();
      } else if (message.type === 'save' && this._currentRelPath !== null) {
        await this._persistNote(this._currentRelPath, message.content ?? '');
      }
    });

    vscode.window.onDidChangeActiveTextEditor(async () => {
      await this._sendCurrentNote();
    });

    webviewView.onDidChangeVisibility(async () => {
      if (webviewView.visible) {
        await this._sendCurrentNote();
      }
    });
  }

  private _resolveWorkspaceFolder(fileUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return (
      vscode.workspace.getWorkspaceFolder(fileUri) ?? vscode.workspace.workspaceFolders?.[0]
    );
  }

  private _storageUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, '.vscode', 'file-notes.json');
  }

  private async _loadNotes(folder: vscode.WorkspaceFolder): Promise<NotesMap> {
    try {
      const raw = await vscode.workspace.fs.readFile(this._storageUri(folder));
      return JSON.parse(Buffer.from(raw).toString('utf8')) as NotesMap;
    } catch {
      return {};
    }
  }

  private async _persistNote(relPath: string, content: string): Promise<void> {
    const folder = this._currentWorkspaceFolder;
    if (!folder) {
      return;
    }

    const notes = await this._loadNotes(folder);
    if (content === '') {
      delete notes[relPath];
    } else {
      notes[relPath] = content;
    }

    const vscodeDirUri = vscode.Uri.joinPath(folder.uri, '.vscode');
    try {
      await vscode.workspace.fs.createDirectory(vscodeDirUri);
    } catch {
      // directory already exists
    }

    await vscode.workspace.fs.writeFile(
      this._storageUri(folder),
      Buffer.from(JSON.stringify(notes, null, 2), 'utf8')
    );
  }

  private async _sendCurrentNote(): Promise<void> {
    if (!this._view) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this._currentRelPath = null;
      this._currentWorkspaceFolder = undefined;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    const fileUri = editor.document.uri;
    const folder = this._resolveWorkspaceFolder(fileUri);

    if (!folder) {
      this._currentRelPath = null;
      this._currentWorkspaceFolder = undefined;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    this._currentWorkspaceFolder = folder;
    const relPath = path.relative(folder.uri.fsPath, fileUri.fsPath).replace(/\\/g, '/');
    this._currentRelPath = relPath;

    const notes = await this._loadNotes(folder);
    const content = notes[relPath] ?? '';
    const filename = path.basename(fileUri.fsPath);

    this._view.webview.postMessage({ type: 'load', file: filename, content });
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
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
      justify-content: space-between;
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
  </div>
  <div id="placeholder">No file open</div>
  <div id="textarea-wrapper" class="hidden">
    <textarea id="note" placeholder="Write a note for this file…"></textarea>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const filenameEl = document.getElementById('filename');
    const statusEl   = document.getElementById('status');
    const placeholderEl = document.getElementById('placeholder');
    const wrapperEl  = document.getElementById('textarea-wrapper');
    const noteEl     = document.getElementById('note');

    let saveTimer = null;
    let statusTimer = null;

    function flashSaved() {
      if (statusTimer) clearTimeout(statusTimer);
      statusEl.classList.add('visible');
      statusTimer = setTimeout(() => statusEl.classList.remove('visible'), 1500);
    }

    noteEl.addEventListener('input', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        vscode.postMessage({ type: 'save', content: noteEl.value });
        flashSaved();
      }, 500);
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'load') return;

      if (msg.file === null) {
        filenameEl.textContent = '';
        placeholderEl.classList.remove('hidden');
        wrapperEl.classList.add('hidden');
      } else {
        filenameEl.textContent = msg.file;
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
