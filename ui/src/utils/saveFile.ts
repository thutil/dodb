import { apiClient } from "./apiClient";

/**
 * Saves text through the host's native save dialog.
 *
 * The app used to export with `<a download>` and a blob URL. That works in a
 * browser and did work under Tauri, but under the Wails webview the click
 * dispatches without error and no file is ever written -- confirmed by the
 * Phase 0 spike, which triggered a download and then looked for the file. Every
 * export path therefore goes through the backend, which owns the dialog and the
 * write.
 *
 * Returns the chosen path, or null when the user cancelled.
 */
export async function saveTextFile(
  suggestedName: string,
  contents: string,
): Promise<string | null> {
  return apiClient.saveTextFile(suggestedName, contents);
}

/**
 * Fire-and-forget variant for the many export buttons whose handlers are
 * synchronous. A failure is surfaced rather than swallowed: an export that
 * silently does nothing is the exact bug this module exists to fix.
 */
export function saveTextFileAsync(
  suggestedName: string,
  contents: string,
  onError?: (message: string) => void,
): void {
  void saveTextFile(suggestedName, contents).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (onError) onError(message);
    else console.error(`could not save ${suggestedName}: ${message}`);
  });
}
