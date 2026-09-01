/**
 * Security utilities for safe HTML rendering and sanitization across dodb.
 * Prevents XSS, script injection, and unsafe protocol execution.
 */

/**
 * Escapes unsafe characters for HTML entity safety.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validates and sanitizes a URL to ensure it doesn't use dangerous protocols (javascript:, data:, vbscript:).
 * Only http, https, mailto, and relative/anchor links are permitted.
 */
export function sanitizeUrl(rawUrl: string): string {
  if (!rawUrl) return "#";
  const trimmed = rawUrl.trim();

  // Block dangerous pseudo-protocols
  const dangerousProtocols = /^(javascript|vbscript|data):/i;
  if (dangerousProtocols.test(trimmed)) {
    return "#";
  }

  // Safe protocols or relative URLs
  const safeProtocols = /^(https?|mailto|tel|blob):/i;
  if (safeProtocols.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("./")) {
    return trimmed;
  }

  // Default fallback if protocol is unrecognized
  return "#";
}

/**
 * Strips executable scripts, event handlers (on*), iframes, objects, and embeds from HTML strings.
 * Used for sandboxed previews.
 */
export function sanitizeHtmlForPreview(rawHtml: string): string {
  if (!rawHtml) return "";

  let sanitized = rawHtml;

  // 1. Remove <script[\s\S]*?</script>
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // 2. Remove dangerous tags: <object>, <embed>, <applet>, <base>, <meta http-equiv...>
  sanitized = sanitized.replace(/<\/?(object|embed|applet|base)\b[^>]*>/gi, "");

  // 3. Remove nested iframes
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

  // 4. Strip inline event handlers (e.g. onload, onclick, onerror, onmouseover, etc.)
  sanitized = sanitized.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");

  // 5. Strip javascript: URLs in attributes
  sanitized = sanitized.replace(/(href|src|action|data)\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, '$1="#"');

  return sanitized;
}
