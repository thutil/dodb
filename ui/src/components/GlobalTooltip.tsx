import React, { useEffect, useRef } from "react";

/**
 * GlobalTooltip
 * Standalone high-performance DOM-managed tooltip that only displays for
 * intentionally marked elements with [data-tooltip] (important action buttons,
 * icon-only buttons, main toolbars).
 *
 * Implemented completely outside of React's Virtual DOM to eliminate any risk of
 * React 19 reconciliation errors.
 */
export const GlobalTooltip: React.FC = () => {
  const currentTargetRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const warmTimerRef = useRef<number | null>(null);
  const isWarmRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // Create standalone DOM nodes outside React's fiber tree
    const tooltipEl = document.createElement("div");
    tooltipEl.className = "dodb-global-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.style.position = "fixed";
    tooltipEl.style.zIndex = "99999999";
    tooltipEl.style.pointerEvents = "none";

    const arrowEl = document.createElement("div");
    arrowEl.className = "dodb-global-tooltip-arrow";

    const contentEl = document.createElement("div");
    contentEl.className = "dodb-global-tooltip-content";

    tooltipEl.appendChild(arrowEl);
    tooltipEl.appendChild(contentEl);
    document.body.appendChild(tooltipEl);

    const hideTooltip = (immediate = false) => {
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      currentTargetRef.current = null;

      tooltipEl.classList.remove("is-visible");

      if (warmTimerRef.current) {
        window.clearTimeout(warmTimerRef.current);
      }
      if (immediate) {
        isWarmRef.current = false;
      } else {
        // Keep warm for 280ms so moving across adjacent buttons has zero delay
        warmTimerRef.current = window.setTimeout(() => {
          isWarmRef.current = false;
        }, 280);
      }
    };

    const setTooltipContent = (text: string) => {
      contentEl.replaceChildren();

      // Check for shortcut pattern in parentheses, e.g. (⌘R) or (Ctrl+Enter)
      const match = text.match(/^(.*?)\s*(\((?:⌘|Ctrl|Cmd|Shift|Alt|Esc)[^)]*\))$/i);
      if (match) {
        const textSpan = document.createElement("span");
        textSpan.textContent = match[1];
        contentEl.appendChild(textSpan);

        const kbd = document.createElement("kbd");
        kbd.className = "dodb-global-tooltip-kbd";
        kbd.textContent = match[2].slice(1, -1);
        contentEl.appendChild(kbd);
      } else {
        const span = document.createElement("span");
        span.textContent = text;
        contentEl.appendChild(span);
      }
    };

    const updatePosition = (target: HTMLElement, text: string) => {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hideTooltip(true);
        return;
      }

      setTooltipContent(text);

      const tw = tooltipEl.offsetWidth || 110;
      const th = tooltipEl.offsetHeight || 26;

      const prefPos = (target.getAttribute("data-tooltip-pos") as "top" | "bottom" | "left" | "right") || "auto";
      let placed: "top" | "bottom" | "left" | "right" = "top";

      if (prefPos === "bottom" || prefPos === "left" || prefPos === "right" || prefPos === "top") {
        placed = prefPos;
      } else {
        // Auto position: top by default, but if near window top (e.g. Header or top of sidebar < 52px), flip to bottom
        if (rect.top < 52) {
          placed = "bottom";
        } else {
          placed = "top";
        }
      }

      // Avoid collision with Header (height ~44px) and viewport bounds
      const TOP_MIN = 46;
      if (placed === "top" && rect.top - th - 8 < TOP_MIN) {
        placed = "bottom";
      } else if (placed === "bottom" && rect.bottom + th + 8 > window.innerHeight) {
        placed = "top";
      } else if (placed === "left" && rect.left - tw - 8 < 0) {
        placed = "right";
      } else if (placed === "right" && rect.right + tw + 8 > window.innerWidth) {
        placed = "left";
      }

      let x = 0;
      let y = 0;
      let arrowOffset = 0;

      if (placed === "top") {
        const centerX = rect.left + rect.width / 2;
        x = centerX - tw / 2;
        y = rect.top - th - 7;
        const clampedX = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
        arrowOffset = Math.max(10, Math.min(tw - 10, centerX - clampedX));
        x = clampedX;
        arrowEl.style.left = `${Math.round(arrowOffset)}px`;
        arrowEl.style.top = "";
      } else if (placed === "bottom") {
        const centerX = rect.left + rect.width / 2;
        x = centerX - tw / 2;
        y = rect.bottom + 7;
        const clampedX = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
        arrowOffset = Math.max(10, Math.min(tw - 10, centerX - clampedX));
        x = clampedX;
        arrowEl.style.left = `${Math.round(arrowOffset)}px`;
        arrowEl.style.top = "";
      } else if (placed === "left") {
        const centerY = rect.top + rect.height / 2;
        x = rect.left - tw - 7;
        y = centerY - th / 2;
        const clampedY = Math.max(8, Math.min(window.innerHeight - th - 8, y));
        arrowOffset = Math.max(8, Math.min(th - 8, centerY - clampedY));
        y = clampedY;
        arrowEl.style.top = `${Math.round(arrowOffset)}px`;
        arrowEl.style.left = "";
      } else if (placed === "right") {
        const centerY = rect.top + rect.height / 2;
        x = rect.right + 7;
        y = centerY - th / 2;
        const clampedY = Math.max(8, Math.min(window.innerHeight - th - 8, y));
        arrowOffset = Math.max(8, Math.min(th - 8, centerY - clampedY));
        y = clampedY;
        arrowEl.style.top = `${Math.round(arrowOffset)}px`;
        arrowEl.style.left = "";
      }

      tooltipEl.setAttribute("data-placed", placed);
      tooltipEl.style.left = `${Math.round(x)}px`;
      tooltipEl.style.top = `${Math.round(y)}px`;
      tooltipEl.classList.add("is-visible");

      isWarmRef.current = true;
      if (warmTimerRef.current) {
        window.clearTimeout(warmTimerRef.current);
        warmTimerRef.current = null;
      }
    };

    const handlePointerOver = (e: PointerEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      if (!rawTarget) return;

      // Only trigger on elements intentionally marked with [data-tooltip]
      const target = rawTarget.closest<HTMLElement>("[data-tooltip]");

      if (!target) {
        if (currentTargetRef.current) {
          hideTooltip(false);
        }
        return;
      }

      // Still hovering on the same element
      if (currentTargetRef.current === target) {
        return;
      }

      const text = (target.getAttribute("data-tooltip") || "").trim();
      if (!text) {
        hideTooltip(false);
        return;
      }

      currentTargetRef.current = target;
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
      }

      const showNow = () => {
        if (currentTargetRef.current !== target) return;
        updatePosition(target, text);
      };

      if (isWarmRef.current) {
        showNow();
      } else {
        showTimerRef.current = window.setTimeout(showNow, 85);
      }
    };

    const handlePointerOut = (e: PointerEvent) => {
      const target = currentTargetRef.current;
      if (!target) return;

      const related = e.relatedTarget as HTMLElement | null;
      if (related && target.contains(related)) {
        return;
      }

      hideTooltip(false);
    };

    const handleDismissImmediate = () => {
      hideTooltip(true);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideTooltip(true);
      }
    };

    document.addEventListener("pointerover", handlePointerOver, { passive: true });
    document.addEventListener("pointerout", handlePointerOut, { passive: true });
    document.addEventListener("pointerdown", handleDismissImmediate, { passive: true });
    window.addEventListener("scroll", handleDismissImmediate, { passive: true, capture: true });
    window.addEventListener("blur", handleDismissImmediate, { passive: true });
    window.addEventListener("keydown", handleKeyDown, { passive: true });

    return () => {
      if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
      if (warmTimerRef.current) window.clearTimeout(warmTimerRef.current);
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("pointerdown", handleDismissImmediate);
      window.removeEventListener("scroll", handleDismissImmediate, true);
      window.removeEventListener("blur", handleDismissImmediate);
      window.removeEventListener("keydown", handleKeyDown);
      if (tooltipEl.parentNode) {
        tooltipEl.parentNode.removeChild(tooltipEl);
      }
    };
  }, []);

  return null;
};
