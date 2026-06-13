# filebound-notes

A VS Code extension that attaches plain-text notes to individual files. Notes appear in a sidebar panel and auto-save as you type.

## Features

- Activity Bar panel titled **File Notes**
- Note content switches automatically when the active editor changes
- Each file gets its own independent note
- Persists notes in `.vscode/file-notes.json` (workspace-local)
- Auto-saves 500 ms after you stop typing — no save button
- Styled with VS Code theme variables

## Setup

```bash
npm install
```

## Build

```bash
npm run compile      # one-shot build → out/
npm run watch        # rebuild on change
```

## Run & Debug

Press **F5** in VS Code to launch the Extension Development Host. The **File Notes** icon appears in the Activity Bar.

For fast iteration: run `npm run watch` in a terminal first, then F5. Reload the host with **Ctrl+R** after changes compile.

## Package

```bash
npx vsce package
```

Produces a `.vsix` installable via **Extensions: Install from VSIX…**

## Storage format

`.vscode/file-notes.json` is a flat JSON object keyed by workspace-relative file path:

```json
{
  "src/index.ts": "Entry point — registers all commands.",
  "README.md": "Remember to update the screenshot."
}
```

Empty notes are removed from the file automatically on save.
