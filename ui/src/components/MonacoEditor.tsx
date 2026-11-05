import dynamic from "next/dynamic";

/**
 * The only way the app should load Monaco.
 *
 * Left alone, @monaco-editor/react downloads Monaco from jsDelivr at runtime, so
 * the editor's code would not be what the lockfile says and DOMPurify patches
 * could not reach it. This bundles the pinned, patched package instead.
 * ssr: false because Monaco touches `window` as soon as it is imported.
 */
const MonacoEditor = dynamic(
  async () => {
    const monaco = await import("monaco-editor");

    self.MonacoEnvironment = {
      getWorker(_workerId, label) {
        // Each URL must be a literal for the bundler to emit the worker file.
        switch (label) {
          case "json":
            return new Worker(new URL("monaco-editor/language/json/json.worker.js", import.meta.url), { type: "module" });
          case "css":
          case "scss":
          case "less":
            return new Worker(new URL("monaco-editor/language/css/css.worker.js", import.meta.url), { type: "module" });
          case "html":
          case "handlebars":
          case "razor":
            return new Worker(new URL("monaco-editor/language/html/html.worker.js", import.meta.url), { type: "module" });
          case "typescript":
          case "javascript":
            return new Worker(new URL("monaco-editor/language/typescript/ts.worker.js", import.meta.url), { type: "module" });
          default:
            return new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), { type: "module" });
        }
      },
    };

    const { default: Editor, loader } = await import("@monaco-editor/react");
    loader.config({ monaco });
    return Editor;
  },
  { ssr: false },
);

export default MonacoEditor;
