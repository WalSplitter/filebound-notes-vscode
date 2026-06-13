import * as vscode from 'vscode';
import * as path from 'path';

type NotesMap = Record<string, string>;

export class NotesDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private _notes: NotesMap = {};

  update(notes: NotesMap): void {
    this._notes = notes;
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return undefined;
    const key = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
    if (key in this._notes) {
      return {
        badge: '✎',
        tooltip: 'File has a note',
        color: new vscode.ThemeColor('charts.blue'),
      };
    }
    return undefined;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
