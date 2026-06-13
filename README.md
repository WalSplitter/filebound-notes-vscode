# filebound-notes

A VS Code extension that attaches notes to individual files. Notes live in the Explorer sidebar and auto-save as you type.

## Features

- **File Notes panel** in the Explorer sidebar (auto-expanded, below Timeline)
- Note content switches automatically when the active editor changes
- Each file gets its own independent note
- **View mode** — renders the note with clickable line references; click anywhere to edit
- **Edit mode** — plain textarea; switches back to view mode on blur
- Auto-saves 500 ms after you stop typing — no save button needed
- Brief "Saved" indicator after each auto-save

### Line references

Write `@L42` or `@L42-55` anywhere in a note to reference a code location. In view mode the reference appears as a styled badge — clicking it jumps to that line in the editor.

**Three ways to insert a reference:**

| Method | How |
|---|---|
| Type `@` in the note | IntelliSense dropdown appears with all symbols from the current file (functions, classes, variables…). Filter by typing, navigate with ↑↓, confirm with Enter or Tab. |
| Link button (⛓) in the panel header | Inserts `@L{n}` at the cursor position based on the active editor's cursor / selection. |
| Right-click in the editor | **File Notes: Insert Line Reference to File Notes** — works with selections too (`@L42-55`). |

### File-tree decorations

Files that have a note show a `✎` badge in the Explorer file tree. The badge color adapts to the active theme and disappears automatically when the note is cleared.

### Gutter indicators

Lines referenced by `@L42` or `@L42-55` in a note get a subtle left-border highlight and an overview-ruler mark in the active editor — so referenced code is visible at a glance without opening the notes panel.

### Panel header buttons

| Button | Action |
|---|---|
| ⛓ | Insert line reference at cursor |
| 📁 | Reveal the notes storage file in the OS file explorer |
| 🗑 | Clear the note for the current file |

### Commands (Command Palette)

- `File Notes: Search Notes` — opens a Quick Pick with all saved notes; type to filter by filename or note content, press Enter to jump to that file
- `File Notes: Clear All Notes` — deletes all notes after confirmation

## Setup

```bash
npm install
```

## Build

```bash
npm run compile      # one-shot build → out/
npm run watch        # rebuild on change (recommended during development)
```

## Run & Debug

Press **F5** to launch the Extension Development Host. The **FILE NOTES** section appears in the Explorer sidebar.

For fast iteration: run `npm run watch` in a terminal first, then F5. Reload the host with **Ctrl+R** after each recompile.

## Package

```bash
npx vsce package
```

Produces a `.vsix` installable via **Extensions: Install from VSIX…**

## Storage

Notes are stored in VS Code's own workspace storage — outside the repository, never committed to git, but persisted across sessions and specific to each workspace.

Storage path (Windows example):
```
%APPDATA%\Code\User\workspaceStorage\<hash>\mgrosshauser.filebound-notes\file-notes.json
```

Format — flat JSON keyed by workspace-relative file path:
```json
{
  "src/index.ts": "Entry point. @L5-12 registers all commands.",
  "src/utils.ts": "Helper for @L23 — see issue #42."
}
```

Empty notes are removed from the map automatically. When the last note is deleted the storage file is removed entirely.

### File rename & delete

When a file is renamed, moved, or deleted via VS Code's Explorer, the corresponding note is updated or removed automatically.
