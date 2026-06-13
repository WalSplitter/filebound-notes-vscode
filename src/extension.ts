import * as vscode from 'vscode';
import { NotesViewProvider } from './notesViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NotesViewProvider(context.extensionUri, context.storageUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NotesViewProvider.viewType, provider),

    vscode.commands.registerCommand('filebound-notes.clearAll', () =>
      provider.clearAllNotes()
    ),

    vscode.commands.registerCommand('filebound-notes.insertRefFromEditor', () =>
      provider.insertRefFromEditor()
    ),

    vscode.workspace.onDidRenameFiles(async (e) => {
      await provider.handleRenameFiles(e.files);
    }),

    vscode.workspace.onDidDeleteFiles(async (e) => {
      await provider.handleDeleteFiles(e.files);
    })
  );
}

export function deactivate(): void {}
