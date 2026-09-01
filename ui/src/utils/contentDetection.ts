export type ContentType = "markdown" | "html" | "json" | "plaintext";

export interface ContentInfo {
  type: ContentType;
  label: string;
  badgeClass: string;
  titleSnippet?: string;
  isStructured: boolean;
}

/**
 * Common column name patterns indicating rich/long textual or structured content.
 */
const CONTENT_COL_NAMES = [
  "content",
  "body",
  "description",
  "desc",
  "detail",
  "details",
  "text",
  "note",
  "notes",
  "comment",
  "comments",
  "article",
  "post",
  "summary",
  "document",
  "doc",
  "readme",
  "changelog",
  "bio",
  "message",
  "payload",
  "metadata",
  "config",
  "data",
  "params",
  "json",
  "html",
  "markdown",
  "md",
  "sql",
  "query",
  "log",
  "logs",
  "xml",
];

export function isRichContentColumn(colName?: string, colType?: string): boolean {
  if (!colName && !colType) return false;
  const t = (colType || "").toLowerCase();
  const n = (colName || "").toLowerCase();

  // Explicit type matches
  if (
    t.includes("json") ||
    t.includes("text") ||
    t.includes("clob") ||
    t.includes("blob")
  ) {
    return true;
  }

  // Name matches
  return CONTENT_COL_NAMES.some((kw) => n === kw || n.includes(kw));
}

/**
 * Test whether a value string is valid JSON
 */
function tryParseJson(str: string): { isJson: boolean; isArray: boolean; keysCount?: number } {
  const trimmed = str.trim();
  if (
    (!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
    (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
  ) {
    return { isJson: false, isArray: false };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const isArray = Array.isArray(parsed);
      const keysCount = isArray ? parsed.length : Object.keys(parsed).length;
      return { isJson: true, isArray, keysCount };
    }
  } catch {
    // not json
  }
  return { isJson: false, isArray: false };
}

/**
 * Test whether string has obvious HTML structure
 */
function isLikelyHtml(str: string): boolean {
  const trimmed = str.trim();
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return true;
  }
  // Check for common HTML paired or self-closing tags
  const htmlTagPattern = /<\/?(p|div|span|h[1-6]|ul|ol|li|table|tr|td|th|article|section|header|footer|nav|blockquote|pre|code|button|form|input|strong|em|b|i|a|br)\b[^>]*>/i;
  return htmlTagPattern.test(trimmed);
}

/**
 * Test whether string has Markdown structure (excluding image/assets)
 */
function isLikelyMarkdown(str: string): { isMd: boolean; title?: string } {
  const trimmed = str.trim();
  
  // Extract heading if exists (e.g. # Heading or ## Subheading)
  const headingMatch = trimmed.match(/^#{1,6}\s+([^\n\r]+)/m);
  if (headingMatch) {
    return { isMd: true, title: headingMatch[1].trim() };
  }

  // Check code blocks ``` or ~~~
  if (/```[\s\S]*?```/.test(trimmed) || /~~~[\s\S]*?~~~/.test(trimmed)) {
    return { isMd: true };
  }

  // Check bullet lists, numbered lists, blockquotes, markdown tables, bold/italic markers
  let mdPatternsFound = 0;
  if (/^(\s*[-*+]\s+[^\n]+)/m.test(trimmed)) mdPatternsFound++;
  if (/^(\s*\d+\.\s+[^\n]+)/m.test(trimmed)) mdPatternsFound++;
  if (/^>\s+[^\n]+/m.test(trimmed)) mdPatternsFound++;
  if (/\|[^\n\r]+\|\s*\n\s*\|[-:\s|]+\|/m.test(trimmed)) mdPatternsFound += 2;
  if (/(\*\*[^*\n]+\*\*|__[^_\n]+__)/.test(trimmed)) mdPatternsFound++;
  if (/\[[^\n\]]+\]\([^)\n]+\)/.test(trimmed)) mdPatternsFound++;

  return { isMd: mdPatternsFound >= 1 };
}

/**
 * Detect content type from raw value and column context
 */
export function detectContentType(
  val: unknown,
  colName?: string,
  colType?: string
): ContentType {
  if (val === null || val === undefined) return "plaintext";

  if (typeof val === "object") {
    return "json";
  }

  const str = String(val);
  const n = (colName || "").toLowerCase();
  const t = (colType || "").toLowerCase();

  // Check JSON
  if (t.includes("json") || n.includes("json")) {
    const jsonCheck = tryParseJson(str);
    if (jsonCheck.isJson) return "json";
  } else {
    const jsonCheck = tryParseJson(str);
    if (jsonCheck.isJson) return "json";
  }

  // Check HTML
  if (n.includes("html") || isLikelyHtml(str)) {
    return "html";
  }

  // Check Markdown
  if (n.includes("markdown") || n === "md" || n.endsWith("_md")) {
    return "markdown";
  }
  const mdCheck = isLikelyMarkdown(str);
  if (mdCheck.isMd) {
    return "markdown";
  }

  return "plaintext";
}

/**
 * Get display info for a cell if it qualifies as rich content
 */
export function getContentInfo(
  val: unknown,
  colName?: string,
  colType?: string
): ContentInfo | null {
  if (val === null || val === undefined || val === "__AUTO__") return null;

  const isColMatch = isRichContentColumn(colName, colType);

  if (typeof val === "object") {
    const isArray = Array.isArray(val);
    const count = isArray ? val.length : Object.keys(val).length;
    return {
      type: "json",
      label: "JSON",
      badgeClass: "badge-json",
      titleSnippet: isArray ? `Array (${count} items)` : `Object (${count} keys)`,
      isStructured: true,
    };
  }

  const str = String(val);
  const trimmed = str.trim();

  // Check JSON string
  const jsonCheck = tryParseJson(str);
  if (jsonCheck.isJson) {
    return {
      type: "json",
      label: "JSON",
      badgeClass: "badge-json",
      titleSnippet: jsonCheck.isArray
        ? `Array (${jsonCheck.keysCount} items)`
        : `Object (${jsonCheck.keysCount} keys)`,
      isStructured: true,
    };
  }

  // Check HTML
  if (isLikelyHtml(str) || (colName && colName.toLowerCase().includes("html"))) {
    return {
      type: "html",
      label: "HTML",
      badgeClass: "badge-html",
      titleSnippet: "HTML Document",
      isStructured: true,
    };
  }

  // Check Markdown
  const mdCheck = isLikelyMarkdown(str);
  if (
    mdCheck.isMd ||
    (colName && (colName.toLowerCase().includes("markdown") || colName.toLowerCase().endsWith("_md")))
  ) {
    return {
      type: "markdown",
      label: "MD",
      badgeClass: "badge-markdown",
      titleSnippet: mdCheck.title ? `Title: ${mdCheck.title}` : "Markdown Document",
      isStructured: true,
    };
  }

  // If column name suggests rich content and string is multiline or long
  if (isColMatch && (str.includes("\n") || str.length > 50)) {
    return {
      type: "plaintext",
      label: "TXT",
      badgeClass: "badge-txt",
      titleSnippet: `${str.length} chars`,
      isStructured: false,
    };
  }

  // Generic long multiline text
  if (str.includes("\n") || str.length > 80) {
    return {
      type: "plaintext",
      label: "TXT",
      badgeClass: "badge-txt",
      titleSnippet: `${str.length} chars`,
      isStructured: false,
    };
  }

  return null;
}
