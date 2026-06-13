# Claude Integration — filebound-notes

> Configuration and command templates for AI-assisted development of the **filebound-notes** VS Code extension.

---

## Folder structure

```
.claude/
├── docs/
│   └── README.md          ← this file
├── commands/
│   ├── quick-start.md     general project orientation
│   ├── feature.md         implement a new feature
│   ├── bug.md             investigate and fix a bug
│   ├── refactor.md        improve code quality
│   ├── tests.md           write test cases
│   ├── api.md             VS Code API patterns
│   ├── perf.md            performance optimisation
│   └── ...
└── settings.json          allowed/denied shell commands
```

---

## Quick reference

### Build & run

```bash
npm install
npm run compile        # one-shot build → out/
npm run watch          # rebuild on change
npm run lint           # ESLint (flat config, CommonJS)
npm run type-check     # tsc --noEmit
```

Press **F5** in VS Code to launch the Extension Development Host.  
Reload with **Ctrl+R** after each recompile.

### Key source files

| File | Purpose |
|---|---|
| [`src/extension.ts`](../../src/extension.ts) | Activation entry point, command & event registration |
| [`src/notesViewProvider.ts`](../../src/notesViewProvider.ts) | `WebviewViewProvider` — webview, file I/O, gutter decorations, search |
| [`src/notesDecorationProvider.ts`](../../src/notesDecorationProvider.ts) | `FileDecorationProvider` — Explorer file-tree badges |
| [`package.json`](../../package.json) | Extension manifest, commands, view contributions |

---

## Features (current state)

| Feature | Implementation |
|---|---|
| Per-file notes in Explorer sidebar | `WebviewViewProvider` webview |
| Auto-save with 500 ms debounce | debounced `postMessage` → `onDidReceiveMessage` |
| View / edit toggle | dual `#note-rendered` + `textarea` elements |
| Line references `@L42` / `@L42-55` | regex render → clickable badges → `showTextDocument` |
| IntelliSense for `@` | `executeDocumentSymbolProvider` → Quick Pick dropdown |
| Insert ref from editor / context menu | `insertRefFromEditor` command, `editor/context` menu |
| File-tree decorations (✎ badge) | `NotesDecorationProvider` implements `FileDecorationProvider` |
| Gutter indicators for referenced lines | `createTextEditorDecorationType` — left border + overview ruler |
| Notes search | `searchNotes` command → `showQuickPick` with full-text filter |
| File rename / delete sync | `onDidRenameFiles` / `onDidDeleteFiles` handlers |
| Storage outside repo | `context.storageUri` — never committed to git |

---

## Message protocol (extension ↔ webview)

| Direction | Message |
|---|---|
| webview → host | `{ type: 'ready' }` on load |
| host → webview | `{ type: 'load', file, relPath, content }` |
| webview → host | `{ type: 'save', relPath, content }` after 500 ms debounce |
| webview → host | `{ type: 'clearFile' }` |
| webview → host | `{ type: 'getRef' }` |
| webview → host | `{ type: 'getSymbols' }` |
| webview → host | `{ type: 'gotoLine', line, endLine }` |
| webview → host | `{ type: 'openStorage' }` |
| host → webview | `{ type: 'symbols', items: SymbolItem[] }` |
| host → webview | `{ type: 'insertRef', text, focus }` |

---

## Using the command templates

1. Open Claude Code (CLI or VS Code extension).
2. Reference a template with `/project:<name>`, e.g. `/project:feature`.
3. Fill in `$ARGUMENTS` and describe what you need.

### Available slash commands

| Command | Use it when… |
|---|---|
| `/project:quick-start` | First session — get oriented |
| `/project:feature` | Adding a new capability to the extension |
| `/project:bug` | Investigating a runtime or type error |
| `/project:refactor` | Cleaning up or restructuring existing code |
| `/project:api` | Working with a VS Code API not used yet |
| `/project:tests` | Writing tests for a new or existing module |
| `/project:perf` | Optimising webview render or provider calls |

---

## Constraints Claude should follow

- **CommonJS output** — `package.json` has no `"type": "module"`; no `import`/`export` in config files
- **Strict TypeScript** — `noUnusedLocals`, `noUnusedParameters` enabled
- **CSP** — webview HTML must use nonce-based `Content-Security-Policy`
- **No bundler** — plain `tsc`, source in `src/`, output in `out/`
- **ESLint flat config** — `require()` style in `eslint.config.js`, no `typescript-eslint` unified package

---

*Last updated: 2026-06-13*
