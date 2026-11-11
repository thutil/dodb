/**
 * Pure Native ERD Schema Diagram Export & Print Utilities
 * Multi-page Data Dictionary & Architecture Report Generator
 * Zero external libraries: uses native Canvas 2D rendering and Print iframe.
 */

import { saveFile } from "./saveFile";
import { apiClient } from "./apiClient";
import { escapeHtml } from "./security";

export type PaperSize = "A4" | "A3" | "Letter" | "Fit";
export type PaperOrientation = "landscape" | "portrait";
export type ExportFormat = "png" | "jpg" | "print";
export type ExportScope = "all" | "selected" | "viewport";
export type ExportScale = 1 | 2 | 3;
export type ReportType = "full_report" | "diagram_only" | "dictionary_only";

export interface DiagramExportOptions {
  format: ExportFormat;
  paperSize: PaperSize;
  orientation: PaperOrientation;
  scope: ExportScope;
  scale: ExportScale;
  reportType?: ReportType; // 2-page report, diagram only, or dictionary only
  isTransparent?: boolean; // Clean transparent PNG without background, banner, or watermark
  theme?: "dark" | "light";
  filename?: string;
  databaseName?: string;
  nodesData?: Array<{
    id: string;
    position: { x: number; y: number };
    data?: any;
    selected?: boolean;
  }>;
  edgesData?: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tableName: string;
  columnsCountText: string;
  isCollapsed: boolean;
  /** Column count before an export capped the card (defaults to columns.length). */
  totalColumns?: number;
  /** Columns left off the card by the export cap. */
  hiddenColumns?: number;
  columns: Array<{
    name: string;
    type: string;
    isPk: boolean;
    isFk?: boolean;
    fkTarget?: string;
    /** Referenced table, for FK columns. */
    fkTable?: string;
    isGeom: boolean;
  }>;
}

export interface ParsedEdge {
  id: string;
  pathD?: string;
  source?: string;
  target?: string;
  sourceCol?: string;
  targetCol?: string;
  label?: string;
}

// Standard Paper Dimensions in Millimeters
const PAPER_MM: Record<
  Exclude<PaperSize, "Fit">,
  { width: number; height: number }
> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 215.9, height: 279.4 },
};

/**
 * Get target aspect ratio and pixel dimensions for paper size and orientation
 */
export function getPaperDimensions(
  paperSize: PaperSize,
  orientation: PaperOrientation,
  contentBounds: RectBounds,
  scale: ExportScale = 2,
): { width: number; height: number; aspectRatio: number } {
  if (paperSize === "Fit") {
    const pad = 80;
    const w = (contentBounds.width + pad * 2) * scale;
    const h = (contentBounds.height + pad * 2) * scale;
    return {
      width: Math.max(900, Math.round(w)),
      height: Math.max(650, Math.round(h)),
      aspectRatio: w / (h || 1),
    };
  }

  const dim = PAPER_MM[paperSize];
  const mmW = orientation === "landscape" ? dim.height : dim.width;
  const mmH = orientation === "landscape" ? dim.width : dim.height;

  // Base 96 DPI pixel conversion * scale multiplier (~3.78 px/mm)
  const pxPerMm = 3.78;
  const targetW = Math.round(mmW * pxPerMm * scale);
  const targetH = Math.round(mmH * pxPerMm * scale);

  return {
    width: targetW,
    height: targetH,
    aspectRatio: mmW / mmH,
  };
}

/**
 * Extract node position from style transform: translate(Xpx, Ypx)
 */
function parseNodeTransform(el: HTMLElement): { x: number; y: number } {
  const transform = el.style.transform || "";
  const match = transform.match(
    /translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/i,
  );
  if (match) {
    return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  }
  return { x: el.offsetLeft, y: el.offsetTop };
}

/**
 * Resolve vertical & horizontal overlaps between nodes
 * Guarantees no two tables ever overlap regardless of number of columns
 */
function resolveNodeOverlaps(nodes: ParsedNode[]): void {
  if (nodes.length <= 1) return;

  // Group nodes into approximate vertical columns (tolerance 80px)
  const columnBuckets: ParsedNode[][] = [];
  const sortedByX = [...nodes].sort((a, b) => a.x - b.x);

  for (const node of sortedByX) {
    let placed = false;
    for (const bucket of columnBuckets) {
      if (Math.abs(bucket[0].x - node.x) < 80) {
        bucket.push(node);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columnBuckets.push([node]);
    }
  }

  // Within each column, sort by Y and ensure minimum gap
  const vGap = 50;
  for (const bucket of columnBuckets) {
    bucket.sort((a, b) => a.y - b.y);
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1];
      const curr = bucket[i];
      const minAllowedY = prev.y + prev.height + vGap;
      if (curr.y < minAllowedY) {
        curr.y = minAllowedY;
      }
    }
  }

  // 2D Iterative collision pass for cross-column overlaps
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const a = nodes[i];
        const b = nodes[j];

        const xOverlap = b.x < a.x + a.width + 30 && b.x + b.width + 30 > a.x;
        if (xOverlap) {
          if (b.y >= a.y && b.y < a.y + a.height + 40) {
            b.y = a.y + a.height + 45;
          }
        }
      }
    }
  }
}

/**
 * Parse all table nodes either from React Flow state or DOM elements
 */
export function parseTableNodes(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): { nodes: ParsedNode[]; bounds: RectBounds } {
  const parsedNodes: ParsedNode[] = [];

  // Option A: Extract directly from React Flow nodesData state (Most accurate)
  if (options.nodesData && options.nodesData.length > 0) {
    for (const n of options.nodesData) {
      if (
        options.scope === "selected" &&
        selectedNodeIds &&
        selectedNodeIds.size > 0 &&
        !selectedNodeIds.has(n.id)
      ) {
        continue;
      }

      const tableData = n.data?.table || {};
      const tableName = tableData.name || n.data?.tableName || n.id;
      const rawCols: any[] = tableData.columns || n.data?.columns || [];
      const fkMap = n.data?.fkMap || {};

      const columns = rawCols.map((c: any) => {
        const colName = typeof c === "string" ? c : c.name || "";
        const fkRel = fkMap[colName];
        return {
          name: colName,
          type: typeof c === "object" ? c.type || "" : "",
          isPk: typeof c === "object" ? !!c.primaryKey : false,
          isFk: !!fkRel,
          fkTarget: fkRel ? `${fkRel.toTable}.${fkRel.toColumn}` : undefined,
          fkTable: fkRel ? fkRel.toTable : undefined,
          isGeom: false,
        };
      });

      const width = 280;
      const headerHeight = 38;
      const rowHeight = 28;
      const height = headerHeight + Math.max(1, columns.length) * rowHeight + 8;

      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;

      parsedNodes.push({
        id: n.id,
        x,
        y,
        width,
        height,
        tableName,
        columnsCountText: `${columns.length}`,
        isCollapsed: false,
        columns,
      });
    }
  } else {
    // Option B: Fallback DOM parser
    const nodesLayer = flowContainer.querySelector(
      ".react-flow__nodes",
    ) as HTMLElement | null;
    if (nodesLayer) {
      const nodeElements = Array.from(
        nodesLayer.querySelectorAll(".react-flow__node"),
      ) as HTMLElement[];
      for (const el of nodeElements) {
        const id = el.getAttribute("data-id") || "";
        if (
          options.scope === "selected" &&
          selectedNodeIds &&
          selectedNodeIds.size > 0 &&
          !selectedNodeIds.has(id)
        ) {
          continue;
        }

        const { x, y } = parseNodeTransform(el);
        const width = Math.max(280, el.offsetWidth || 280);
        const height = el.offsetHeight || 140;

        const tableNameEl = el.querySelector(".card-tbl-name, .table-name");
        const tableName = tableNameEl?.textContent?.trim() || id;

        const countEl = el.querySelector(
          ".card-col-count, .card-tbl-count, .table-sub-count",
        );
        const columnsCountText = countEl?.textContent?.trim() || "";

        const isCollapsed = el.classList.contains("is-collapsed");

        const columnRows = Array.from(
          el.querySelectorAll(".col-row, .column-row"),
        ) as HTMLElement[];
        const columns = columnRows.map((row) => {
          const nameEl = row.querySelector(".col-name");
          const name = nameEl?.textContent?.trim() || "";
          const typeEl = row.querySelector(".col-type, .col-type-tag");
          const type = typeEl?.textContent?.trim() || "";
          const isPk =
            !!row.querySelector(".pk-icon, .pk-tag") ||
            row.classList.contains("pk-row") ||
            row.classList.contains("is-pk");
          const isFk =
            !!row.querySelector(".fk-icon, .fk-tag") ||
            row.classList.contains("fk-row") ||
            row.classList.contains("is-fk");
          const isGeom = !!row.querySelector(".gis-icon, .col-geom-icon");
          return { name, type, isPk, isFk, isGeom };
        });

        const headerHeight = 38;
        const rowHeight = 28;
        const computedHeight = isCollapsed
          ? headerHeight
          : headerHeight + columns.length * rowHeight + 8;
        const finalHeight = Math.max(height, computedHeight);

        parsedNodes.push({
          id,
          x,
          y,
          width,
          height: finalHeight,
          tableName,
          columnsCountText,
          isCollapsed,
          columns,
        });
      }
    }
  }

  // Resolve any collision or overlap!
  resolveNodeOverlaps(parsedNodes);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of parsedNodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  if (parsedNodes.length === 0 || minX === Infinity) {
    return {
      nodes: [],
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    };
  }

  const padding = 60;
  return {
    nodes: parsedNodes,
    bounds: {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    },
  };
}

/**
 * Parse all SVG edges connecting tables
 */
export function parseEdges(flowContainer: HTMLElement): ParsedEdge[] {
  const edgesLayer = flowContainer.querySelector(
    ".react-flow__edges",
  ) as HTMLElement | null;
  if (!edgesLayer) return [];

  const edgeElements = Array.from(
    edgesLayer.querySelectorAll(".react-flow__edge"),
  ) as HTMLElement[];
  const parsedEdges: ParsedEdge[] = [];

  for (const el of edgeElements) {
    const id = el.getAttribute("data-id") || "";
    const pathEl = el.querySelector(
      "path.react-flow__edge-path",
    ) as SVGPathElement | null;
    const pathD = pathEl?.getAttribute("d") || "";
    if (pathD) {
      const labelEl = el.querySelector(".react-flow__edge-text");
      const label = labelEl?.textContent?.trim();
      parsedEdges.push({ id, pathD, label });
    }
  }

  return parsedEdges;
}

/**
 * Helper to draw a rounded rectangle on Canvas 2D
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Export layout
//
// The on-screen layout is tuned for panning a canvas, not for paper: with many
// tables it is a very wide, shallow strip, and one table with a hundred columns
// stretches the whole thing vertically. For export the tables are re-packed
// into the page's own shape, related tables are kept next to each other, and
// tall cards are capped (the data dictionary pages still list every column).
// When even that leaves the text too small to read, the print report adds
// detail pages drawn at a readable size.
// ---------------------------------------------------------------------------

const CARD_W = 280;
const CARD_HEADER_H = 32;
const CARD_ROW_H = 22;
const CARD_PAD_B = 8;
const BODY_FONT_PX = 11.5;
/** Most column rows a card shows in an export before collapsing the rest. */
const EXPORT_MAX_ROWS = 10;
const PACK_GAP_X = 56;
const PACK_GAP_Y = 24;
/** Printed size (mm) of the column-name font below which detail pages are added. */
const MIN_READABLE_EM_MM = 1.6;
/** Printed size (mm) of the column-name font on detail pages. */
const DETAIL_EM_MM = 1.8;
const MAX_DETAIL_PAGES = 40;

interface ExportEdge {
  source: string;
  target: string;
  sourceCol?: string;
  targetCol?: string;
}

interface ExportModel {
  cards: ParsedNode[];
  edges: ExportEdge[];
  /** DOM edge paths, only used when tables keep their on-screen positions. */
  domEdges: ParsedEdge[];
  repacked: boolean;
}

interface PageLabels {
  title: string;
  meta: string;
  footerRight: string;
}

function columnFromHandle(
  handle: string | null | undefined,
  table: string,
): string | undefined {
  if (!handle) return undefined;
  const prefix = `${table}:`;
  return handle.startsWith(prefix) ? handle.slice(prefix.length) : undefined;
}

/** Cap a card at EXPORT_MAX_ROWS rows, keeping key columns first when it is cut. */
function capCardColumns(n: ParsedNode): ParsedNode {
  const total = n.columns.length;
  if (n.isCollapsed || total <= EXPORT_MAX_ROWS) {
    const rows = n.isCollapsed ? 0 : Math.max(1, total);
    return {
      ...n,
      width: CARD_W,
      totalColumns: total,
      hiddenColumns: 0,
      height: CARD_HEADER_H + rows * CARD_ROW_H + CARD_PAD_B,
    };
  }
  const ordered = [
    ...n.columns.filter((c) => c.isPk),
    ...n.columns.filter((c) => !c.isPk && c.isFk),
    ...n.columns.filter((c) => !c.isPk && !c.isFk),
  ];
  const visible = ordered.slice(0, EXPORT_MAX_ROWS - 1);
  return {
    ...n,
    width: CARD_W,
    columns: visible,
    totalColumns: total,
    hiddenColumns: total - visible.length,
    height: CARD_HEADER_H + EXPORT_MAX_ROWS * CARD_ROW_H + CARD_PAD_B,
  };
}

/**
 * Order tables so each group of tables linked by foreign keys is contiguous
 * (largest group first, breadth-first from its most connected table), followed
 * by unrelated tables in name order. Packing in this order keeps related
 * tables near each other, so relationship lines stay short.
 */
function orderByRelationClusters(
  cards: ParsedNode[],
  edges: ExportEdge[],
): ParsedNode[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const adj = new Map<string, Set<string>>(
    cards.map((c) => [c.id, new Set<string>()]),
  );
  for (const e of edges) {
    if (e.source === e.target) continue;
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const degree = (id: string) => adj.get(id)?.size ?? 0;
  const byDegree = [...cards].sort(
    (a, b) =>
      degree(b.id) - degree(a.id) || a.tableName.localeCompare(b.tableName),
  );

  const seen = new Set<string>();
  const groups: ParsedNode[][] = [];
  for (const start of byDegree) {
    if (seen.has(start.id)) continue;
    const group: ParsedNode[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      group.push(byId.get(id)!);
      const next = [...(adj.get(id) ?? [])]
        .filter((n) => !seen.has(n))
        .sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
      for (const n of next) {
        seen.add(n);
        queue.push(n);
      }
    }
    groups.push(group);
  }

  const connected = groups
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);
  const singles = groups
    .filter((g) => g.length === 1)
    .flat()
    .sort((a, b) => a.tableName.localeCompare(b.tableName));
  return [...connected.flat(), ...singles];
}

/** Masonry-pack cards into `columnCount` columns, each card into the shortest column. */
function packColumns(
  cards: ParsedNode[],
  columnCount: number,
): { nodes: ParsedNode[]; width: number; height: number } {
  const colY = new Array<number>(columnCount).fill(0);
  const nodes = cards.map((card) => {
    let col = 0;
    for (let i = 1; i < columnCount; i++) if (colY[i] < colY[col]) col = i;
    const placed = { ...card, x: col * (CARD_W + PACK_GAP_X), y: colY[col] };
    colY[col] += card.height + PACK_GAP_Y;
    return placed;
  });
  const used = Math.min(columnCount, cards.length);
  return {
    nodes,
    width: used * CARD_W + Math.max(0, used - 1) * PACK_GAP_X,
    height: Math.max(0, Math.max(...colY) - PACK_GAP_Y),
  };
}

/** Pick the column count whose packed shape fills an area of the given aspect best. */
function packForAspect(cards: ParsedNode[], aspect: number): ParsedNode[] {
  if (cards.length === 0) return [];
  let best = packColumns(cards, 1);
  let bestScore = Math.min(aspect / best.width, 1 / best.height);
  for (let k = 2; k <= cards.length; k++) {
    const p = packColumns(cards, k);
    const score = Math.min(aspect / p.width, 1 / p.height);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best.nodes;
}

/** Split cards across pages of `capH` layout units, `columnCount` columns each. */
function paginateCards(
  cards: ParsedNode[],
  columnCount: number,
  capH: number,
): ParsedNode[][] {
  const pages: ParsedNode[][] = [];
  let current: ParsedNode[] = [];
  const colY = new Array<number>(columnCount).fill(0);
  for (const card of cards) {
    let col = 0;
    for (let i = 1; i < columnCount; i++) if (colY[i] < colY[col]) col = i;
    if (current.length > 0 && colY[col] + card.height > capH) {
      pages.push(current);
      current = [];
      colY.fill(0);
      col = 0;
    }
    current.push({ ...card, x: col * (CARD_W + PACK_GAP_X), y: colY[col] });
    colY[col] += card.height + PACK_GAP_Y;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function buildExportModel(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): ExportModel {
  const { nodes } = parseTableNodes(flowContainer, options, selectedNodeIds);
  const ids = new Set(nodes.map((n) => n.id));

  // Without React Flow state there are no reliable column handles, so keep the
  // on-screen positions and the rendered edge paths.
  if (!options.nodesData || options.nodesData.length === 0) {
    const domEdges = nodes.length > 1 ? parseEdges(flowContainer) : [];
    return { cards: nodes, edges: [], domEdges, repacked: false };
  }

  const edges: ExportEdge[] =
    nodes.length > 1
      ? (options.edgesData || [])
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e) => ({
            source: e.source,
            target: e.target,
            sourceCol: columnFromHandle(e.sourceHandle, e.source),
            targetCol: columnFromHandle(e.targetHandle, e.target),
          }))
      : [];

  const cards = orderByRelationClusters(nodes.map(capCardColumns), edges);
  return { cards, edges, domEdges: [], repacked: true };
}

function boundsOf(nodes: ParsedNode[], pad: number): RectBounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1200, height: 800 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** Drawable area of a page in canvas pixels (inside margins, banner and footer). */
function pageFrame(
  paper: { width: number; height: number },
  options: DiagramExportOptions,
) {
  const isTransparent = !!options.isTransparent && options.format === "png";
  const s = options.scale;
  const topBanner = isTransparent ? 0 : 44 * s;
  const bottomFooter = isTransparent ? 0 : 28 * s;
  const margin = (isTransparent ? 24 : 36) * s;
  const topGap = isTransparent ? 0 : 10 * s;
  return {
    left: margin,
    top: margin + topBanner + topGap,
    width: paper.width - margin * 2,
    height: paper.height - margin * 2 - topBanner - bottomFooter - topGap,
  };
}

/** Canvas pixels per printed millimetre for a fixed paper size. */
function canvasPxPerMm(options: DiagramExportOptions): number {
  return 3.78 * options.scale;
}

/** Shorten `text` with an ellipsis so it fits in `maxWidth` with the current font. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

/**
 * Draw one diagram page. Fits `nodes` to the page unless `fixedScale` (layout
 * units → canvas px) is given, in which case they are drawn at that size.
 */
function drawDiagramPage(
  nodes: ParsedNode[],
  model: ExportModel,
  options: DiagramExportOptions,
  labels: PageLabels,
  fixedScale?: number,
): HTMLCanvasElement {
  const bounds = boundsOf(nodes, fixedScale ? 0 : 24);
  const paper = getPaperDimensions(
    options.paperSize,
    options.orientation,
    bounds,
    options.scale,
  );

  const canvas = document.createElement("canvas");
  canvas.width = paper.width;
  canvas.height = paper.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D canvas context");

  const isLightPrint = options.format === "print" || options.theme === "light";
  const isTransparent = !!options.isTransparent && options.format === "png";

  // Palette styling
  const colors = isLightPrint
    ? {
        bg: "#ffffff",
        cardBg: "#ffffff",
        cardBorder: "#cbd5e1",
        headerBg: "#f1f5f9",
        headerText: "#0f172a",
        subText: "#64748b",
        rowBorder: "#eef2f6",
        colName: "#1e293b",
        colType: "#64748b",
        pkBg: "rgba(59, 130, 246, 0.12)",
        pkText: "#2563eb",
        fkBg: "rgba(16, 185, 129, 0.12)",
        fkText: "#059669",
        edgeStroke: "rgba(37, 99, 235, 0.7)",
        edgeDot: "#2563eb",
        gridDots: "rgba(0, 0, 0, 0.04)",
        metaText: "#64748b",
        bannerBorder: "#e2e8f0",
      }
    : {
        bg: "#0b0f19",
        cardBg: "#111827",
        cardBorder: "#1f2937",
        headerBg: "#1a2234",
        headerText: "#f9fafb",
        subText: "#9ca3af",
        rowBorder: "#1f2937",
        colName: "#f3f4f6",
        colType: "#9ca3af",
        pkBg: "rgba(59, 130, 246, 0.2)",
        pkText: "#60a5fa",
        fkBg: "rgba(16, 185, 129, 0.2)",
        fkText: "#34d399",
        edgeStroke: "rgba(59, 130, 246, 0.75)",
        edgeDot: "#60a5fa",
        gridDots: "rgba(255, 255, 255, 0.04)",
        metaText: "#9ca3af",
        bannerBorder: "#1f2937",
      };

  // 1. Paper background (skipped for transparent PNG)
  if (!isTransparent) {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = colors.gridDots;
    const dotGap = 24 * options.scale;
    for (let gx = 0; gx < canvas.width; gx += dotGap) {
      for (let gy = 0; gy < canvas.height; gy += dotGap) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1 * options.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Fit transform: horizontally centred, top aligned.
  const frame = pageFrame(paper, options);
  const scaleFactor =
    fixedScale ??
    Math.min(frame.width / bounds.width, frame.height / bounds.height);
  const offsetX =
    frame.left +
    (frame.width - bounds.width * scaleFactor) / 2 -
    bounds.x * scaleFactor;
  const offsetY = frame.top - bounds.y * scaleFactor;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scaleFactor, scaleFactor);

  const nodeMap = new Map<string, ParsedNode>(nodes.map((n) => [n.id, n]));
  const fontMono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  // 2. Relationship lines, under the cards. Each line leaves the FK column row
  //    and enters the referenced column row.
  const rowCenterY = (n: ParsedNode, col?: string) => {
    const idx =
      col && !n.isCollapsed ? n.columns.findIndex((c) => c.name === col) : -1;
    return idx >= 0
      ? n.y + CARD_HEADER_H + idx * CARD_ROW_H + CARD_ROW_H / 2
      : n.y + CARD_HEADER_H / 2;
  };
  const endpoints: Array<[number, number]> = [];
  let drawnRelations = 0;

  ctx.save();
  ctx.strokeStyle = colors.edgeStroke;
  ctx.lineWidth = Math.max(1.4, (1.2 * options.scale) / scaleFactor);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (model.repacked) {
    for (const e of model.edges) {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (!src || !tgt) continue;
      drawnRelations++;
      const y1 = rowCenterY(src, e.sourceCol);
      const y2 = rowCenterY(tgt, e.targetCol);
      const srcCx = src.x + src.width / 2;
      const tgtCx = tgt.x + tgt.width / 2;
      let x1: number;
      let x2: number;
      ctx.beginPath();
      if (src === tgt || Math.abs(srcCx - tgtCx) < src.width / 2) {
        // Same column: loop out to the right.
        x1 = src.x + src.width;
        x2 = tgt.x + tgt.width;
        const bulge = 36 + Math.min(60, Math.abs(y2 - y1) * 0.12);
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + bulge, y1, x2 + bulge, y2, x2, y2);
      } else if (tgtCx > srcCx) {
        x1 = src.x + src.width;
        x2 = tgt.x;
        const dx = Math.max(30, (x2 - x1) * 0.5);
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      } else {
        x1 = src.x;
        x2 = tgt.x + tgt.width;
        const dx = Math.max(30, (x1 - x2) * 0.5);
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 - dx, y1, x2 + dx, y2, x2, y2);
      }
      ctx.stroke();
      endpoints.push([x1, y1], [x2, y2]);
    }
  } else {
    for (const edge of model.domEdges) {
      try {
        ctx.stroke(new Path2D(edge.pathD));
        drawnRelations++;
      } catch {
        // Unparseable path: skip it.
      }
    }
  }
  ctx.restore();

  // 3. Table cards
  const cardRadius = 7;
  for (const node of nodes) {
    // Card shadow + body
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.12)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = colors.cardBg;
    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, cardRadius);
    ctx.fill();
    ctx.restore();

    // Header
    ctx.save();
    ctx.fillStyle = colors.headerBg;
    ctx.beginPath();
    ctx.moveTo(node.x + cardRadius, node.y);
    ctx.lineTo(node.x + node.width - cardRadius, node.y);
    ctx.quadraticCurveTo(
      node.x + node.width,
      node.y,
      node.x + node.width,
      node.y + cardRadius,
    );
    ctx.lineTo(node.x + node.width, node.y + CARD_HEADER_H);
    ctx.lineTo(node.x, node.y + CARD_HEADER_H);
    ctx.lineTo(node.x, node.y + cardRadius);
    ctx.quadraticCurveTo(node.x, node.y, node.x + cardRadius, node.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colors.cardBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y + CARD_HEADER_H);
    ctx.lineTo(node.x + node.width, node.y + CARD_HEADER_H);
    ctx.stroke();
    ctx.restore();

    // Border
    ctx.strokeStyle = colors.cardBorder;
    ctx.lineWidth = 1.2;
    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, cardRadius);
    ctx.stroke();

    // Header title + column count
    ctx.textBaseline = "middle";
    const countText = `${node.totalColumns ?? node.columns.length} cols`;
    ctx.font = `10.5px ${fontMono}`;
    const countW = ctx.measureText(countText).width;
    ctx.fillStyle = colors.subText;
    ctx.textAlign = "right";
    ctx.fillText(
      countText,
      node.x + node.width - 12,
      node.y + CARD_HEADER_H / 2,
    );
    ctx.textAlign = "left";

    ctx.font = `bold 12.5px ${fontMono}`;
    ctx.fillStyle = colors.headerText;
    ctx.fillText(
      fitText(ctx, node.tableName, node.width - 12 - 14 - countW - 10),
      node.x + 14,
      node.y + CARD_HEADER_H / 2,
    );

    if (node.isCollapsed) continue;

    // Column rows
    let rowY = node.y + CARD_HEADER_H;
    const rowCount = node.columns.length;
    for (let i = 0; i < rowCount; i++) {
      const col = node.columns[i];
      if (i > 0) {
        ctx.strokeStyle = colors.rowBorder;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(node.x + 10, rowY);
        ctx.lineTo(node.x + node.width - 10, rowY);
        ctx.stroke();
      }

      const midY = rowY + CARD_ROW_H / 2;
      let textStartX = node.x + 14;

      if (col.isPk || col.isFk) {
        const badgeW = 26;
        const badgeH = 14;
        ctx.fillStyle = col.isPk ? colors.pkBg : colors.fkBg;
        drawRoundedRect(ctx, textStartX, midY - badgeH / 2, badgeW, badgeH, 3);
        ctx.fill();
        ctx.font = `bold 8.5px ${fontMono}`;
        ctx.fillStyle = col.isPk ? colors.pkText : colors.fkText;
        ctx.fillText(col.isPk ? "PK" : "FK", textStartX + 5, midY + 1);
        textStartX += badgeW + 8;
      }

      // Right-hand text: the type, or for an FK whose target table is on
      // another page, where it points.
      const offPageTarget =
        col.isFk && col.fkTable && !nodeMap.has(col.fkTable)
          ? col.fkTable
          : undefined;
      const rightText = offPageTarget ? `→ ${offPageTarget}` : col.type;
      let rightW = 0;
      if (rightText) {
        ctx.font = `10.5px ${fontMono}`;
        const maxRight = node.width * 0.5;
        const shown = fitText(ctx, rightText, maxRight);
        rightW = ctx.measureText(shown).width;
        ctx.fillStyle = offPageTarget ? colors.fkText : colors.colType;
        ctx.textAlign = "right";
        ctx.fillText(shown, node.x + node.width - 14, midY + 1);
        ctx.textAlign = "left";
      }

      ctx.font = `${BODY_FONT_PX}px ${fontMono}`;
      ctx.fillStyle = colors.colName;
      const nameMax =
        node.x + node.width - 14 - (rightW ? rightW + 8 : 0) - textStartX;
      ctx.fillText(fitText(ctx, col.name, nameMax), textStartX, midY + 1);

      rowY += CARD_ROW_H;
    }

    if (node.hiddenColumns && node.hiddenColumns > 0) {
      ctx.strokeStyle = colors.rowBorder;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(node.x + 10, rowY);
      ctx.lineTo(node.x + node.width - 10, rowY);
      ctx.stroke();
      ctx.font = `italic 10.5px ${fontMono}`;
      ctx.fillStyle = colors.subText;
      ctx.fillText(
        `+ ${node.hiddenColumns} more columns`,
        node.x + 14,
        rowY + CARD_ROW_H / 2 + 1,
      );
    }
  }

  // Line end dots on top of the card edges
  ctx.fillStyle = colors.edgeDot;
  for (const [x, y] of endpoints) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // 4. Banner + footer (not on transparent PNG)
  if (!isTransparent) {
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold ${Math.round(13 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = isLightPrint ? "#0f172a" : "#f8fafc";
    ctx.fillText(labels.title, 24 * options.scale, 24 * options.scale);

    ctx.font = `${Math.round(10 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = colors.metaText;
    ctx.fillText(
      labels.meta.replace("{relations}", String(drawnRelations)),
      24 * options.scale,
      38 * options.scale,
    );

    ctx.strokeStyle = colors.bannerBorder;
    ctx.lineWidth = 1 * options.scale;
    ctx.beginPath();
    ctx.moveTo(20 * options.scale, 44 * options.scale);
    ctx.lineTo(canvas.width - 20 * options.scale, 44 * options.scale);
    ctx.stroke();

    const footerY = canvas.height - 14 * options.scale;
    ctx.font = `${Math.round(9.5 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = colors.metaText;
    ctx.fillText(
      "Legend: [PK] Primary Key   [FK] Foreign Key   ─── Relationship",
      24 * options.scale,
      footerY,
    );
    ctx.textAlign = "right";
    ctx.fillText(
      labels.footerRight,
      canvas.width - 24 * options.scale,
      footerY,
    );
    ctx.textAlign = "left";
    ctx.restore();
  }

  return canvas;
}

/**
 * Render the ERD for export: an overview of every table on one page, plus —
 * for print, when the overview text would be too small to read — detail pages
 * at a readable size. PNG/JPG use only the overview.
 */
export async function captureDiagramPages(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): Promise<HTMLCanvasElement[]> {
  const model = buildExportModel(flowContainer, options, selectedNodeIds);
  const dbName = options.databaseName || "Database Schema";
  const pageLabel = `${options.paperSize} ${options.orientation.toUpperCase()}`;
  const tableCount = model.cards.length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // Overview layout, packed to the page's drawable shape.
  let overviewNodes = model.cards;
  let overviewScale = 0;
  let detailPages: ParsedNode[][] = [];
  let detailScale = 0;

  if (model.repacked) {
    const isFit = options.paperSize === "Fit";
    let aspect = 1.5;
    if (!isFit) {
      const probe = getPaperDimensions(
        options.paperSize,
        options.orientation,
        { x: 0, y: 0, width: 1, height: 1 },
        options.scale,
      );
      const frame = pageFrame(probe, options);
      aspect = frame.width / frame.height;
      overviewNodes = packForAspect(model.cards, aspect);
      const b = boundsOf(overviewNodes, 24);
      overviewScale = Math.min(frame.width / b.width, frame.height / b.height);

      const emMm = (BODY_FONT_PX * overviewScale) / canvasPxPerMm(options);
      if (
        options.format === "print" &&
        emMm < MIN_READABLE_EM_MM &&
        tableCount > 1
      ) {
        detailScale = (DETAIL_EM_MM * canvasPxPerMm(options)) / BODY_FONT_PX;
        const capW = frame.width / detailScale;
        const capH = frame.height / detailScale;
        const columnCount = Math.max(
          1,
          Math.floor((capW + PACK_GAP_X) / (CARD_W + PACK_GAP_X)),
        );
        detailPages = paginateCards(model.cards, columnCount, capH).slice(
          0,
          MAX_DETAIL_PAGES,
        );
      }
    } else {
      overviewNodes = packForAspect(model.cards, aspect);
    }
  }

  const hasDetail = detailPages.length > 0;
  const canvases: HTMLCanvasElement[] = [];

  canvases.push(
    drawDiagramPage(overviewNodes, model, options, {
      title: `ERD Architecture Diagram: ${dbName}`,
      meta: `${plural(tableCount, "Table")} • {relations} Relations • ${pageLabel}${
        hasDetail
          ? ` • Overview — readable detail on the next ${plural(detailPages.length, "page")}`
          : ""
      }`,
      footerRight: hasDetail ? `Overview` : "Architecture Diagram",
    }),
  );

  detailPages.forEach((pageNodes, i) => {
    canvases.push(
      drawDiagramPage(
        pageNodes,
        model,
        options,
        {
          title: `ERD Detail ${i + 1}/${detailPages.length}: ${dbName}`,
          meta: `${plural(pageNodes.length, "Table")} on this page • {relations} Relations shown • → table = reference on another page`,
          footerRight: `Detail ${i + 1} of ${detailPages.length}`,
        },
        detailScale,
      ),
    );
  });

  return canvases;
}

/**
 * Capture the ERD overview to a single canvas (PNG / JPG export).
 */
export async function captureDiagramToCanvas(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): Promise<HTMLCanvasElement> {
  const [overview] = await captureDiagramPages(
    flowContainer,
    options,
    selectedNodeIds,
  );
  return overview;
}

/**
 * Generate HTML Report Document for Page 2: Schema Data Dictionary
 */
export function generateDataDictionaryHtml(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): string {
  const { nodes } = parseTableNodes(flowContainer, options, selectedNodeIds);
  const exportedNodeIds = new Set(nodes.map((n) => n.id));
  const validEdges =
    nodes.length > 1 && options.edgesData
      ? options.edgesData.filter(
          (e) => exportedNodeIds.has(e.source) && exportedNodeIds.has(e.target),
        )
      : [];

  const dbName = options.databaseName || "Database Schema";
  const isLandscape = options.orientation === "landscape";

  const totalCols = nodes.reduce((acc, n) => acc + n.columns.length, 0);

  const tablesHtml = nodes
    .map((table) => {
      const rowsHtml = table.columns
        .map((col) => {
          const pkBadge = col.isPk
            ? `<span class="badge pk-badge">PK</span>`
            : "";
          const fkBadge = col.isFk
            ? `<span class="badge fk-badge">FK${col.fkTarget ? ` &rarr; ${escapeHtml(col.fkTarget)}` : ""}</span>`
            : "";
          return `
            <tr>
              <td class="col-name-cell">
                <strong>${escapeHtml(col.name)}</strong>
              </td>
              <td class="col-type-cell"><code>${escapeHtml(col.type || "text")}</code></td>
              <td class="col-key-cell">${pkBadge} ${fkBadge}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="table-card">
          <div class="table-card-header">
            <span class="table-title">${escapeHtml(table.tableName)}</span>
            <span class="table-badge">${table.columns.length} columns</span>
          </div>
          <table class="dictionary-table">
            <thead>
              <tr>
                <th>Column Name</th>
                <th>Type</th>
                <th>Keys & Relations</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    })
    .join("");

  // Relationships Summary Table
  const relsHtml =
    validEdges.length > 0
      ? `
      <div class="section-card">
        <h3 class="section-heading">Foreign Key Relationships (${validEdges.length})</h3>
        <table class="dictionary-table rel-table">
          <thead>
            <tr>
              <th>From Table (Foreign Key)</th>
              <th></th>
              <th>To Table (Primary Key)</th>
            </tr>
          </thead>
          <tbody>
            ${validEdges
              .map(
                (e) => `
              <tr>
                <td><strong>${escapeHtml(e.source)}</strong></td>
                <td style="text-align: center; color: #3b82f6; font-weight: bold;">&rarr;</td>
                <td><strong>${escapeHtml(e.target)}</strong></td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
      : "";

  return `
    <div class="report-page data-dictionary-page">
      <!-- Report Header -->
      <div class="report-header">
        <div class="report-title-group">
          <h1 class="report-main-title">Data Dictionary &amp; Schema Specifications</h1>
          <p class="report-subtitle font-mono">Database: <strong>${escapeHtml(dbName)}</strong> &bull; Generated by dodb Studio</p>
        </div>
        <div class="report-stats-grid font-mono">
          <div class="stat-pill"><span class="stat-num">${nodes.length}</span> Tables</div>
          <div class="stat-pill"><span class="stat-num">${totalCols}</span> Columns</div>
          <div class="stat-pill"><span class="stat-num">${validEdges.length}</span> Relations</div>
        </div>
      </div>

      <!-- Tables Data Dictionary Grid -->
      <div class="dictionary-grid ${isLandscape ? "landscape-grid" : "portrait-grid"}">
        ${tablesHtml}
      </div>

      <!-- Relationships Matrix -->
      ${relsHtml}

      <!-- Report Footer -->
      <div class="report-footer font-mono">
        <span>ERD Schema Report &bull; Data Dictionary</span>
        <span>Data Dictionary</span>
      </div>
    </div>
  `;
}

/**
 * Trigger Native Browser Print Dialog for 2-Page Multi-Page Report
 */
export async function printDiagram(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): Promise<void> {
  const reportType = options.reportType || "full_report";

  // Remove anything left over from a previous print before building a new sheet.
  cleanupPrintPortal();

  // Capture Page 1 Diagram if requested
  const diagramUrls: string[] = [];
  if (reportType !== "dictionary_only") {
    const canvases = await captureDiagramPages(
      flowContainer,
      { ...options, format: "print", scale: 2 },
      selectedNodeIds,
    );
    for (const canvas of canvases) {
      // A Blob URL keeps multi-MB base64 strings out of innerHTML and the DOM.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const url = blob
        ? URL.createObjectURL(blob)
        : canvas.toDataURL("image/png");
      if (url.startsWith("blob:")) activeDiagramBlobUrls.push(url);
      diagramUrls.push(url);
    }

    // Preload images so they are fully decoded before printing
    await Promise.all(
      diagramUrls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
            if (img.complete) resolve();
          }),
      ),
    );
  }

  // Generate Page 2 Data Dictionary HTML if requested
  const dictionaryHtml =
    reportType !== "diagram_only"
      ? generateDataDictionaryHtml(flowContainer, options, selectedNodeIds)
      : "";

  const pageSizeStyle =
    options.paperSize === "Fit"
      ? "A4 landscape"
      : `${options.paperSize} ${options.orientation}`;

  // Height (mm) each diagram page may use. Sized in mm because `vh` is
  // ill-defined in paged media, and kept conservative: the macOS print panel
  // (Wails windowPrint) adds its own 30pt margins on top of the @page margin
  // and always prints landscape, so the short side of the paper is the safe
  // page height. Anything taller spills onto a mostly blank extra page.
  const paperMm =
    PAPER_MM[options.paperSize === "Fit" ? "A4" : options.paperSize];
  const shortSideMm = Math.min(paperMm.width, paperMm.height);
  const PAGE_MARGIN_MM = 8 * 2;
  const NATIVE_MARGIN_MM = 10.6 * 2;
  const diagramMaxHeightMm = Math.floor(
    shortSideMm - PAGE_MARGIN_MM - NATIVE_MARGIN_MM - 4,
  );

  // Inject print stylesheet
  const styleEl = document.createElement("style");
  styleEl.id = "dodb-print-styles";
  styleEl.textContent = `
    @media screen {
      #dodb-print-portal {
        display: none !important;
      }
    }
    @media print {
      @page {
        size: ${pageSizeStyle};
        margin: 8mm;
      }
      /* The app shell pins html/body to the viewport (position: fixed,
         overflow: hidden). Undo that so the report flows across pages instead
         of WebKit paginating a tall box inside a clipped, fixed body. */
      html, body, #__next {
        position: static !important;
        inset: auto !important;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        background: #ffffff !important;
      }
      body > *:not(#dodb-print-portal) {
        display: none !important;
      }
      #dodb-print-portal {
        display: block !important;
        position: static !important;
        width: 100% !important;
        background: #ffffff !important;
        color: #0f172a !important;
        z-index: 9999999 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 11px;
        line-height: 1.4;
      }
      * {
        box-sizing: border-box;
      }
      .font-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .page-diagram {
        display: block;
        width: 100%;
        height: ${diagramMaxHeightMm}mm;
        margin: 0;
        padding: 0;
        overflow: hidden;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .page-diagram + .page-diagram {
        page-break-before: always;
      }
      .diagram-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center top;
        display: block;
        margin: 0 auto;
      }
      .data-dictionary-page {
        padding: 10px 0;
        page-break-before: always;
      }
      .report-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        border-bottom: 2px solid #0f172a;
        padding-bottom: 10px;
        margin-bottom: 16px;
      }
      .report-main-title {
        font-size: 16px;
        font-weight: 800;
        margin: 0 0 4px 0;
        color: #0f172a;
      }
      .report-subtitle {
        font-size: 10.5px;
        color: #64748b;
        margin: 0;
      }
      .report-stats-grid {
        display: flex;
        gap: 8px;
      }
      .stat-pill {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        color: #334155;
      }
      .stat-num {
        font-weight: 700;
        color: #0f172a;
      }
      /* Plain block / multi-column flow: CSS grid + break-inside: avoid is
         very slow to fragment in WebKit with dozens of cards. */
      .dictionary-grid {
        display: block;
        margin-bottom: 18px;
      }
      .landscape-grid {
        column-count: 2;
        column-gap: 14px;
      }
      .portrait-grid {
        column-count: 1;
      }
      .table-card {
        display: inline-block;
        width: 100%;
        margin: 0 0 14px 0;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .table-card-header {
        background: #f8fafc;
        border-bottom: 1px solid #cbd5e1;
        padding: 6px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .table-title {
        font-weight: 700;
        font-family: ui-monospace, monospace;
        font-size: 12px;
        color: #0f172a;
      }
      .table-badge {
        font-size: 9.5px;
        font-family: ui-monospace, monospace;
        background: #e2e8f0;
        color: #475569;
        padding: 2px 6px;
        border-radius: 10px;
      }
      .dictionary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10.5px;
      }
      .dictionary-table th {
        background: #f1f5f9;
        text-align: left;
        padding: 5px 8px;
        font-size: 9.5px;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid #e2e8f0;
      }
      .dictionary-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: middle;
      }
      .dictionary-table tr:last-child td {
        border-bottom: none;
      }
      .col-name-cell {
        font-family: ui-monospace, monospace;
        color: #0f172a;
      }
      .col-type-cell code {
        font-family: ui-monospace, monospace;
        color: #64748b;
        background: #f8fafc;
        padding: 1px 4px;
        border-radius: 3px;
      }
      .badge {
        display: inline-block;
        font-size: 8.5px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 3px;
        font-family: ui-monospace, monospace;
      }
      .pk-badge {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .fk-badge {
        background: #d1fae5;
        color: #047857;
      }
      .section-card {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        margin-top: 14px;
        break-inside: avoid;
      }
      .section-heading {
        background: #f8fafc;
        border-bottom: 1px solid #cbd5e1;
        padding: 6px 10px;
        margin: 0;
        font-size: 11.5px;
        font-weight: 700;
        color: #0f172a;
      }
      .report-footer {
        border-top: 1px solid #e2e8f0;
        padding-top: 8px;
        margin-top: 20px;
        display: flex;
        justify-content: space-between;
        font-size: 9.5px;
        color: #94a3b8;
      }
    }
  `;
  document.head.appendChild(styleEl);

  // Inject print portal into body
  const portal = document.createElement("div");
  portal.id = "dodb-print-portal";
  portal.innerHTML = `
    ${diagramUrls
      .map(
        (url, i) =>
          `<div class="page-diagram"><img src="${url}" alt="ERD Diagram page ${i + 1}" class="diagram-image" /></div>`,
      )
      .join("")}
    ${dictionaryHtml}
  `;
  document.body.appendChild(portal);

  // Let layout settle before handing the page to the print engine.
  await new Promise((resolve) => setTimeout(resolve, 100));

  // The portal stays in the DOM (hidden on screen) until the print finishes or
  // the next print starts. Removing it on a timer while the native panel is
  // still paginating forced WebKit to re-lay out the whole app for print.
  window.addEventListener("afterprint", cleanupPrintPortal, { once: true });

  // Print exactly once: the native panel in the desktop app, window.print()
  // only when there is no native host (browser dev mode).
  const handledNatively = await apiClient.printWindow();
  if (!handledNatively) {
    window.print();
  }
}

let activeDiagramBlobUrls: string[] = [];

/** Remove the print portal, its stylesheet, and the diagram Blob URL. */
function cleanupPrintPortal(): void {
  document.getElementById("dodb-print-portal")?.remove();
  document.getElementById("dodb-print-styles")?.remove();
  activeDiagramBlobUrls.forEach((url) => URL.revokeObjectURL(url));
  activeDiagramBlobUrls = [];
}

/**
 * Trigger Image Download for PNG / JPG
 */
export async function downloadDiagramImage(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>,
): Promise<string | null> {
  const canvas = await captureDiagramToCanvas(
    flowContainer,
    options,
    selectedNodeIds,
  );
  const mimeType = options.format === "jpg" ? "image/jpeg" : "image/png";
  const quality = options.format === "jpg" ? 0.92 : 1.0;
  const dataUrl = canvas.toDataURL(mimeType, quality);

  const safeDb = (options.databaseName || "schema").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const ext = options.format === "jpg" ? "jpg" : "png";
  const defaultFilename =
    options.filename || `${safeDb}_erd_${options.scope}_${Date.now()}.${ext}`;

  return await saveFile(defaultFilename, dataUrl);
}
