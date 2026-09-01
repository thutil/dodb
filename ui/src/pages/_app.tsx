import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { GlobalTooltip } from "@/components/GlobalTooltip";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const code = e.code || "";
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // 1. Block all Reload shortcuts (Cmd+R, Ctrl+R, Cmd+Shift+R, Ctrl+Shift+R, F5, Ctrl+F5)
      const isReload =
        (isCmdOrCtrl && (key === "r" || code === "KeyR")) ||
        key === "f5" ||
        code === "F5" ||
        e.keyCode === 116;

      // 2. Block DevTools and View Source shortcuts
      const isF12 = key === "f12" || code === "F12" || e.keyCode === 123;
      const isInspect =
        isCmdOrCtrl &&
        (e.shiftKey || e.altKey) &&
        (key === "i" || key === "j" || key === "c" || code === "KeyI" || code === "KeyJ" || code === "KeyC");
      const isViewSource = isCmdOrCtrl && (key === "u" || code === "KeyU");

      // 3. Block Browser / Webview Window Zoom shortcuts (Cmd/Ctrl + '+', '-', '0', Equal, Minus, NumpadAdd, etc.)
      const isZoom =
        isCmdOrCtrl &&
        (key === "+" ||
          key === "=" ||
          key === "-" ||
          key === "_" ||
          key === "0" ||
          code === "Equal" ||
          code === "Minus" ||
          code === "Digit0" ||
          code === "NumpadAdd" ||
          code === "NumpadSubtract" ||
          code === "Numpad0" ||
          e.keyCode === 187 || // '+' or '='
          e.keyCode === 189 || // '-' or '_'
          e.keyCode === 107 || // NumpadAdd
          e.keyCode === 109 || // NumpadSubtract
          e.keyCode === 48 ||  // '0'
          e.keyCode === 96);   // Numpad0

      if (isReload || isF12 || isInspect || isViewSource || isZoom) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 4. Block pinch-to-zoom and Ctrl+wheel / Cmd+wheel window zoom
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    // 5. Block macOS / WebKit gesture pinch-to-zoom
    const handleGesture = (e: Event) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true, passive: false });
    document.addEventListener("keydown", handleKeyDown, { capture: true, passive: false });
    window.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("gesturestart", handleGesture, { passive: false });
    document.addEventListener("gesturechange", handleGesture, { passive: false });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("wheel", handleWheel);
      document.removeEventListener("wheel", handleWheel);
      document.removeEventListener("gesturestart", handleGesture);
      document.removeEventListener("gesturechange", handleGesture);
    };
  }, []);

  return (
    <>
      <Component {...pageProps} />
      <GlobalTooltip />
    </>
  );
}
