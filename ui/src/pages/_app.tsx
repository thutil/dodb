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

      if (isReload || isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true, passive: false });
    document.addEventListener("keydown", handleKeyDown, { capture: true, passive: false });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

  return (
    <>
      <Component {...pageProps} />
      <GlobalTooltip />
    </>
  );
}
