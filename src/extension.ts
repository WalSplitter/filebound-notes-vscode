import * as vscode from 'vscode';
import { NotesViewProvider } from './notesViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NotesViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NotesViewProvider.viewType, provider)
  );
}

export function deactivate(): void {}
