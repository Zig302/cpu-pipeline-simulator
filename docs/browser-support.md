# Browser support

Pipeline Lab targets the current and previous major releases of Chrome, Edge, Firefox, and Safari on desktop. The application requires WebAssembly, ES modules, `BigInt`-capable JavaScript, `Blob`, `URL.createObjectURL`, and the File API.

The automated gate validates the production worker, fingerprinted JavaScript/CSS/WASM assets, WebAssembly compilation, MIME types, and a real Chromium-family browser workflow. Before a tagged release, manually smoke-test Firefox and Safari/WebKit when those browsers are available:

1. Load and complete the Load-use example.
2. Open the Learning Center and complete one checkpoint.
3. Download and re-import a project.
4. Export a trace and inspect that it is valid JSON.
5. Run a forwarding comparison.
6. Check keyboard focus, `Ctrl/Cmd+Enter`, `F10`, `Shift+F10`, and reduced-motion behavior.

The app shows a fatal initialization screen rather than substituting a JavaScript CPU when WebAssembly cannot initialize.
