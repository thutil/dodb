import { apiClient } from "./apiClient";

function browserDownload(filename: string, text: string): string {
  if (typeof window === "undefined") return filename;
  const mimeType = filename.endsWith(".json") || filename.endsWith(".geojson")
    ? "application/json;charset=utf-8"
    : filename.endsWith(".csv")
    ? "text/csv;charset=utf-8"
    : "text/plain;charset=utf-8";
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { }
  }, 4000);
  return filename;
}

/**
 * Saves text through the host's native save dialog (in the desktop app),
 * or falls back to standard browser file download when running in a web browser.
 */
export async function saveTextFile(
  suggestedName: string,
  contents: string,
): Promise<string | null> {
  // If running in browser dev mode (e.g. localhost:3000), use browser download immediately
  // to avoid losing user gesture activation across async network trips.
  if (
    typeof window !== "undefined" &&
    (window.location.port === "3000" || Boolean(process.env.NEXT_PUBLIC_DODB_API))
  ) {
    return browserDownload(suggestedName, contents);
  }

  try {
    return await apiClient.saveTextFile(suggestedName, contents);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      typeof window !== "undefined" &&
      (msg.includes("no file dialogs") ||
        msg.includes("Failed to fetch") ||
        msg.includes("save_text_file failed"))
    ) {
      return browserDownload(suggestedName, contents);
    }
    throw err;
  }
}

/**
 * Fire-and-forget variant for the export buttons.
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


