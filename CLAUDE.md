# filebound-notes — Claude Guidelines

## Project

VS Code extension (TypeScript, CommonJS output, no bundler).
Source in `src/`, compiled to `out/` by `tsc`.
Extension manifest: `package.json` (no `"type": "module"`).

## Key files

- [src/extension.ts](src/extension.ts) — activation entry point
- [src/notesViewProvider.ts](src/notesViewProvider.ts) — `WebviewViewProvider`, message protocol, file I/O
- [media/icon.svg](media/icon.svg) — Activity Bar icon
- `package.json` — contributes `viewsContainers` + `views`

## Build & debug

```bash
npm run compile   # tsc → out/
npm run watch     # watch mode
# F5 in VS Code → Extension Development Host
```

## Storage

Notes in `.vscode/file-notes.json`, flat JSON `{ "rel/path": "note" }`.
Empty notes are deleted from the map on save.
Path separator normalized to `/` (forward slash).

## Message protocol (extension ↔ webview)

| Direction | Message |
|-----------|---------|
| webview → host | `{ type: 'ready' }` on load |
| host → webview | `{ type: 'load', file: string \| null, content: string }` |
| webview → host | `{ type: 'save', content: string }` after 500 ms debounce |
