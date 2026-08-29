import { apiClient } from "./apiClient";

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

function browserDownload(filename: string, textOrDataUrl: string): string {
  if (typeof window === "undefined") return filename;
  let url: string;
  let needRevoke = false;

  if (textOrDataUrl.startsWith("data:")) {
    try {
      const blob = dataUrlToBlob(textOrDataUrl);
      url = URL.createObjectURL(blob);
      needRevoke = true;
    } catch {
      url = textOrDataUrl;
    }
  } else {
    const mimeType = filename.endsWith(".json") || filename.endsWith(".geojson")
      ? "application/json;charset=utf-8"
      : filename.endsWith(".csv")
      ? "text/csv;charset=utf-8"
      : "text/plain;charset=utf-8";
    const blob = new Blob([textOrDataUrl], { type: mimeType });
    url = URL.createObjectURL(blob);
    needRevoke = true;
  }

  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      if (needRevoke) {
        URL.revokeObjectURL(url);
      }
    } catch { }
  }, 4000);
  return filename;
}

/**
 * Saves text or binary data URLs through the host's native save dialog (in the desktop app),
 * or falls back to standard browser file download when running in a web browser.
 */
export async function saveFile(
  suggestedName: string,
  contentsOrDataUrl: string,
): Promise<string | null> {
  try {
    return await apiClient.saveTextFile(suggestedName, contentsOrDataUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      typeof window !== "undefined" &&
      (msg.includes("dialog") ||
        msg.includes("Failed to fetch") ||
        msg.includes("save_text_file failed") ||
        msg.includes("ErrNoDialogs") ||
        msg.includes("not available in this build"))
    ) {
      return browserDownload(suggestedName, contentsOrDataUrl);
    }
    if (typeof window !== "undefined") {
      return browserDownload(suggestedName, contentsOrDataUrl);
    }
    throw err;
  }
}

/** Backward compatible alias for saving text files */
export const saveTextFile = saveFile;

/**
 * Fire-and-forget variant for the export buttons.
 */
export function saveFileAsync(
  suggestedName: string,
  contents: string,
  onError?: (message: string) => void,
): void {
  void saveFile(suggestedName, contents).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (onError) onError(message);
    else console.error(`could not save ${suggestedName}: ${message}`);
  });
}

export const saveTextFileAsync = saveFileAsync;


