import * as vscode from 'vscode';
import { NotesViewProvider } from './notesViewProvider';
import { NotesDecorationProvider } from './notesDecorationProvider';

export function activate(context: vscode.ExtensionContext): void {
  const decorationProvider = new NotesDecorationProvider();

  const provider = new NotesViewProvider(
    context.extensionUri,
    context.storageUri,
    (notes) => decorationProvider.update(notes)
  );

  context.subscriptions.push(
    provider,
    decorationProvider,
    vscode.window.registerFileDecorationProvider(decorationProvider),
    vscode.window.registerWebviewViewProvider(NotesViewProvider.viewType, provider),

    vscode.commands.registerCommand('filebound-notes.clearAll', () =>
      provider.clearAllNotes()
    ),

    vscode.commands.registerCommand('filebound-notes.insertRefFromEditor', () =>
      provider.insertRefFromEditor()
    ),

    vscode.commands.registerCommand('filebound-notes.searchNotes', () =>
      provider.searchNotes()
    ),

    vscode.workspace.onDidRenameFiles(async (e) => {
      await provider.handleRenameFiles(e.files);
    }),

    vscode.workspace.onDidDeleteFiles(async (e) => {
      await provider.handleDeleteFiles(e.files);
    })
  );

  void provider.initialize();
}

export function deactivate(): void {}
