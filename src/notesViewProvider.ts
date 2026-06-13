import * as vscode from 'vscode';
import * as path from 'path';

type NotesMap = Record<string, string>;

interface SymbolItem {
  name: string;
  kind: string;
  line: number;
  endLine: number;
}

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

function flattenSymbols(
  symbols: vscode.DocumentSymbol[],
  out: SymbolItem[],
  prefix?: string
): void {
  for (const s of symbols) {
    const fullName = prefix ? `${prefix}.${s.name}` : s.name;
    out.push({
      name: fullName,
      kind: vscode.SymbolKind[s.kind],
      line: s.range.start.line + 1,
      endLine: s.range.end.line + 1,
    });
    if (s.children?.length) {
      flattenSymbols(s.children, out, s.name);
    }
  }
}

export class NotesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'filebound-notes.notesView';

  private _view?: vscode.WebviewView;
  private _currentRelPath: string | null = null;
  private _currentFileUri: vscode.Uri | undefined;

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

    webviewView.webview.onDidReceiveMessage(
      async (msg: {
        type: string;
        content?: string;
        relPath?: string;
        line?: number;
        endLine?: number;
      }) => {
        switch (msg.type) {
          case 'ready':
            await this._sendCurrentNote();
            break;
          case 'save':
            if (msg.relPath) {
              await this._persistNote(msg.relPath, msg.content ?? '');
            }
            break;
          case 'clearFile':
            if (this._currentRelPath !== null) {
              await this._persistNote(this._currentRelPath, '');
              await this._sendCurrentNote();
            }
            break;
          case 'openStorage':
            await this._revealStorageFile();
            break;
          case 'getRef':
            await this._sendLineRef();
            break;
          case 'getSymbols':
            await this._sendSymbols();
            break;
          case 'gotoLine':
            if (msg.line !== undefined) {
              await this._gotoLine(msg.line, msg.endLine ?? msg.line);
            }
            break;
        }
      }
    );

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

  // ── public API ────────────────────────────────────────────────────────

  public async insertRefFromEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this._view) return;
    await vscode.commands.executeCommand('filebound-notes.notesView.focus');
    await this._sendLineRef(editor);
  }

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

      if (this._currentRelPath === oldKey) {
        this._currentRelPath = newKey;
      }
    }

    if (changed) {
      await this._writeNotes(notes);
    }
  }

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

  // ── private ───────────────────────────────────────────────────────────

  private async _sendLineRef(editor?: vscode.TextEditor): Promise<void> {
    const ed = editor ?? vscode.window.activeTextEditor;
    if (!ed || !this._view) return;
    const sel = ed.selection;
    const start = sel.start.line + 1;
    const end = sel.end.line + 1;
    const ref = start === end ? `@L${start}` : `@L${start}-${end}`;
    this._view.webview.postMessage({ type: 'insertRef', text: ref, focus: true });
  }

  private async _sendSymbols(): Promise<void> {
    if (!this._view) return;

    const uri = this._currentFileUri;
    if (!uri) {
      this._view.webview.postMessage({ type: 'symbols', items: [] });
      return;
    }

    const results = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    );

    const items: SymbolItem[] = [];
    if (results?.length) {
      flattenSymbols(results, items);
    }

    this._view.webview.postMessage({ type: 'symbols', items });
  }

  private async _gotoLine(line: number, endLine: number): Promise<void> {
    if (!this._currentFileUri) return;
    const start = Math.max(0, line - 1);
    const end = Math.max(0, endLine - 1);
    const range = new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER);
    const doc = await vscode.workspace.openTextDocument(this._currentFileUri);
    await vscode.window.showTextDocument(doc, { selection: range, preserveFocus: false });
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
        // file didn't exist
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
      this._currentFileUri = undefined;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    const fileUri = editor.document.uri;
    const folder = this._resolveWorkspaceFolder(fileUri);

    if (!folder) {
      this._currentRelPath = null;
      this._currentFileUri = undefined;
      this._view.webview.postMessage({ type: 'load', file: null, content: '' });
      return;
    }

    const relPath = toRelKey(folder, fileUri);
    this._currentRelPath = relPath;
    this._currentFileUri = fileUri;

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

    /* ── header ── */
    #header {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      min-height: 18px;
    }

    #filename {
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .hdr-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    .hdr-btn.visible { display: flex; }

    #ref-btn    { margin-left: auto; }
    #reveal-btn { margin-left: 2px; }
    #clear-btn  { margin-left: 2px; }

    /* ── placeholder ── */
    #placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      opacity: 0.6;
    }

    /* ── note container ── */
    #note-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      min-height: 0;
    }

    /* shared layout for textarea and rendered view */
    textarea, #note-rendered {
      flex: 1;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      line-height: 1.6;
      padding: 6px 8px;
      border-radius: 2px;
      border: 1px solid var(--vscode-input-border, transparent);
      min-height: 0;
    }

    textarea {
      resize: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      outline: none;
      width: 100%;
    }
    textarea:focus { border-color: var(--vscode-focusBorder); }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

    /* ── rendered note view ── */
    #note-rendered {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-y: auto;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      cursor: text;
    }
    #note-rendered:empty::before {
      content: 'Write a note for this file…';
      color: var(--vscode-input-placeholderForeground);
    }

    /* ── line reference badges ── */
    .line-ref {
      display: inline-block;
      color: var(--vscode-textLink-foreground, #3794ff);
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
      border: 1px solid var(--vscode-textSeparator-foreground, rgba(128,128,128,0.25));
      border-radius: 3px;
      padding: 0 5px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.85em;
      line-height: 1.7;
      cursor: pointer;
      white-space: nowrap;
      vertical-align: baseline;
    }
    .line-ref::before { content: '↗ '; font-size: 0.9em; opacity: 0.8; }
    .line-ref:hover {
      text-decoration: underline;
      border-color: var(--vscode-textLink-foreground, #3794ff);
    }

    /* ── autocomplete dropdown ── */
    #autocomplete {
      position: absolute;
      bottom: calc(100% - 8px);
      left: 0;
      right: 0;
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-widget-border, #454545));
      border-radius: 3px;
      z-index: 10;
      max-height: 200px;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }

    .ac-item {
      display: flex;
      align-items: center;
      padding: 3px 8px;
      cursor: pointer;
      gap: 6px;
      font-size: 12px;
      line-height: 1.6;
    }
    .ac-item.selected,
    .ac-item:hover {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .ac-kind {
      font-size: 10px;
      font-weight: 700;
      width: 14px;
      text-align: center;
      flex-shrink: 0;
      border-radius: 2px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .ac-kind-function, .ac-kind-method, .ac-kind-constructor { color: #dcdcaa; }
    .ac-kind-class    { color: #4ec9b0; }
    .ac-kind-interface { color: #b8d7a3; }
    .ac-kind-variable, .ac-kind-field, .ac-kind-property { color: #9cdcfe; }
    .ac-kind-module, .ac-kind-namespace, .ac-kind-package { color: #c8c8c8; }
    .ac-kind-enum     { color: #b5cea8; }

    .ac-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ac-line {
      font-size: 10px;
      opacity: 0.55;
      flex-shrink: 0;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .ac-empty {
      padding: 6px 8px;
      font-size: 11px;
      opacity: 0.6;
      font-style: italic;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="header">
    <span id="filename"></span>
    <span id="status">Saved</span>
    <button id="ref-btn" class="hdr-btn" title="Insert line reference at cursor (@L…)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/>
        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/>
      </svg>
    </button>
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

  <div id="note-container" class="hidden">
    <div id="autocomplete" class="hidden">
      <div id="autocomplete-list"></div>
    </div>
    <div id="note-rendered"></div>
    <textarea id="note" class="hidden" placeholder="Write a note for this file…"></textarea>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const filenameEl    = document.getElementById('filename');
    const statusEl      = document.getElementById('status');
    const refBtn        = document.getElementById('ref-btn');
    const revealBtn     = document.getElementById('reveal-btn');
    const clearBtn      = document.getElementById('clear-btn');
    const placeholderEl = document.getElementById('placeholder');
    const containerEl   = document.getElementById('note-container');
    const renderedEl    = document.getElementById('note-rendered');
    const noteEl        = document.getElementById('note');
    const acEl          = document.getElementById('autocomplete');
    const acListEl      = document.getElementById('autocomplete-list');

    let saveTimer      = null;
    let statusTimer    = null;
    let currentRelPath = null;
    let allSymbols     = [];
    let acItems        = [];   // currently shown (filtered) items
    let acSelectedIdx  = 0;

    // ── save helpers ────────────────────────────────────────────────────

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

    // ── render helpers ──────────────────────────────────────────────────

    function escapeHtml(t) {
      return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderRefs(text) {
      return escapeHtml(text).replace(/@L(\\d+)(?:-(\\d+))?/g, (match, s, e) => {
        const dataEnd = e ? \` data-end="\${e}"\` : '';
        return \`<span class="line-ref" data-start="\${s}"\${dataEnd}>\${match}</span>\`;
      });
    }

    function updateRendered() {
      renderedEl.innerHTML = renderRefs(noteEl.value);
    }

    function showRendered() {
      updateRendered();
      renderedEl.classList.remove('hidden');
      noteEl.classList.add('hidden');
    }

    function showEditor() {
      noteEl.classList.remove('hidden');
      renderedEl.classList.add('hidden');
      noteEl.focus();
    }

    // ── autocomplete ────────────────────────────────────────────────────

    const KIND_CHAR = {
      Function: 'f', Method: 'f', Constructor: 'k',
      Class: 'C', Interface: 'I', Enum: 'E',
      Variable: 'v', Property: 'p', Field: 'p',
      Module: 'm', Namespace: 'm', Package: 'm',
    };

    function kindChar(k) { return KIND_CHAR[k] || '·'; }

    function getCurrentAtQuery() {
      const pos = noteEl.selectionStart;
      const before = noteEl.value.slice(0, pos);
      const m = before.match(/@(\\w*)$/);
      return m ? { query: m[1], atStart: pos - m[0].length } : null;
    }

    function renderAc(filtered) {
      acItems = filtered.slice(0, 25);
      acSelectedIdx = 0;
      acListEl.innerHTML = '';

      if (acItems.length === 0) {
        acListEl.innerHTML = '<div class="ac-empty">No symbols found</div>';
        acEl.classList.remove('hidden');
        return;
      }

      acItems.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'ac-item' + (idx === 0 ? ' selected' : '');
        el.dataset.idx = String(idx);
        const kindClass = 'ac-kind-' + item.kind.toLowerCase();
        const lineLabel = item.endLine !== item.line ? \`L\${item.line}-\${item.endLine}\` : \`L\${item.line}\`;
        el.innerHTML =
          \`<span class="ac-kind \${kindClass}">\${kindChar(item.kind)}</span>\` +
          \`<span class="ac-name">\${escapeHtml(item.name)}</span>\` +
          \`<span class="ac-line">\${lineLabel}</span>\`;
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          insertAcItem(idx);
        });
        acListEl.appendChild(el);
      });

      acEl.classList.remove('hidden');
    }

    function hideAc() {
      acEl.classList.add('hidden');
      acItems = [];
      acSelectedIdx = 0;
    }

    function updateAcSelection(newIdx) {
      const items = acListEl.querySelectorAll('.ac-item');
      items[acSelectedIdx]?.classList.remove('selected');
      acSelectedIdx = Math.max(0, Math.min(newIdx, acItems.length - 1));
      const next = items[acSelectedIdx];
      if (next) {
        next.classList.add('selected');
        next.scrollIntoView({ block: 'nearest' });
      }
    }

    function insertAcItem(idx) {
      const item = acItems[idx];
      if (!item) return;
      const at = getCurrentAtQuery();
      if (!at) return;

      const ref = item.endLine !== item.line
        ? \`@L\${item.line}-\${item.endLine}\`
        : \`@L\${item.line}\`;

      const after = noteEl.value.slice(noteEl.selectionStart);
      noteEl.value = noteEl.value.slice(0, at.atStart) + ref + after;
      const pos = at.atStart + ref.length;
      noteEl.setSelectionRange(pos, pos);
      noteEl.dispatchEvent(new Event('input'));
      hideAc();
    }

    function triggerAc(query) {
      if (allSymbols.length === 0) {
        vscode.postMessage({ type: 'getSymbols' });
        return;
      }
      const q = query.toLowerCase();
      const filtered = q
        ? allSymbols.filter(s => s.name.toLowerCase().includes(q))
        : allSymbols;
      renderAc(filtered);
    }

    // ── textarea events ──────────────────────────────────────────────────

    noteEl.addEventListener('input', () => {
      // debounced save
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (currentRelPath) {
          vscode.postMessage({ type: 'save', relPath: currentRelPath, content: noteEl.value });
          flashSaved();
        }
      }, 500);

      // autocomplete trigger
      const at = getCurrentAtQuery();
      if (at) {
        triggerAc(at.query);
      } else {
        hideAc();
      }
    });

    noteEl.addEventListener('keydown', (e) => {
      if (acEl.classList.contains('hidden')) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateAcSelection(acSelectedIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateAcSelection(acSelectedIdx - 1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (acItems.length > 0) {
          e.preventDefault();
          insertAcItem(acSelectedIdx);
        }
      } else if (e.key === 'Escape') {
        hideAc();
      }
    });

    noteEl.addEventListener('blur', () => {
      // Small delay so mousedown on ac-item fires first
      setTimeout(() => {
        if (!acEl.classList.contains('hidden')) return;
        flushSave();
        showRendered();
      }, 150);
    });

    // ── rendered note events ─────────────────────────────────────────────

    renderedEl.addEventListener('click', (e) => {
      const ref = e.target.closest('.line-ref');
      if (ref) {
        const start = parseInt(ref.dataset.start, 10);
        const end = ref.dataset.end ? parseInt(ref.dataset.end, 10) : start;
        vscode.postMessage({ type: 'gotoLine', line: start, endLine: end });
      } else {
        showEditor();
      }
    });

    // ── header button events ─────────────────────────────────────────────

    refBtn.addEventListener('click', () => {
      showEditor();
      vscode.postMessage({ type: 'getRef' });
    });

    revealBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openStorage' });
    });

    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFile' });
    });

    // ── host messages ────────────────────────────────────────────────────

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'load') {
        flushSave();
        hideAc();
        allSymbols = [];
        currentRelPath = msg.relPath ?? null;

        if (msg.file === null) {
          filenameEl.textContent = '';
          [refBtn, revealBtn, clearBtn].forEach(b => b.classList.remove('visible'));
          placeholderEl.classList.remove('hidden');
          containerEl.classList.add('hidden');
        } else {
          filenameEl.textContent = msg.file;
          [refBtn, revealBtn, clearBtn].forEach(b => b.classList.add('visible'));
          placeholderEl.classList.add('hidden');
          containerEl.classList.remove('hidden');
          noteEl.value = msg.content;
          if (msg.content) {
            showRendered();
          } else {
            showEditor();
          }
        }
        return;
      }

      if (msg.type === 'symbols') {
        allSymbols = msg.items;
        const at = getCurrentAtQuery();
        if (at && !noteEl.classList.contains('hidden')) {
          const q = at.query.toLowerCase();
          const filtered = q
            ? allSymbols.filter(s => s.name.toLowerCase().includes(q))
            : allSymbols;
          renderAc(filtered);
        }
        return;
      }

      if (msg.type === 'insertRef') {
        if (msg.focus) { showEditor(); }
        const start = noteEl.selectionStart;
        const end   = noteEl.selectionEnd;
        const before = noteEl.value.slice(0, start);
        const after  = noteEl.value.slice(end);
        const sep = (before.length && !before.endsWith(' ') && !before.endsWith('\\n')) ? ' ' : '';
        const insert = sep + msg.text;
        noteEl.value = before + insert + after;
        const pos = start + insert.length;
        noteEl.setSelectionRange(pos, pos);
        noteEl.dispatchEvent(new Event('input'));
        return;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
