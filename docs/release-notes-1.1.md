# Pipeline Lab 1.1

Version 1.1 combines the stabilization/package milestone with the first learning-experience release.

## Added

- Versioned project download/import with source, configuration, and breakpoints.
- Device-local browser draft save/restore.
- JSON execution-trace export containing the final core state, reference comparison, events, and timeline.
- Four guided labs with live checkpoints.
- Searchable inline ISA reference.
- Full-forwarding/no-forwarding and predictor comparison runs using independent C++ WebAssembly simulators.
- C++ reference-interpreter diagnostics that identify incorrect architectural register results.
- Keyboard shortcuts, skip navigation, accessible tabs/dialogs, visible focus, and reduced-motion support.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Assemble and reset |
| `Ctrl/Cmd + S` | Download project |
| `F10` | Step one cycle |
| `Shift + F10` | Step one retired instruction |
| `?` | Open the quick guide |
| `Escape` | Close the active guide or learning dialog |

## Compatibility

See [browser-support.md](browser-support.md). The automated release gate covers the native core, generated WebAssembly, production build, server assets, and browser interaction. Firefox and Safari remain manual smoke-test targets when available.
