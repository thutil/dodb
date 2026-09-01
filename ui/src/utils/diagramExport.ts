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
  columns: Array<{
    name: string;
    type: string;
    isPk: boolean;
    isFk?: boolean;
    fkTarget?: string;
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
const PAPER_MM: Record<Exclude<PaperSize, "Fit">, { width: number; height: number }> = {
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
  scale: ExportScale = 2
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
  const match = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/i);
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
  selectedNodeIds?: Set<string>
): { nodes: ParsedNode[]; bounds: RectBounds } {
  const parsedNodes: ParsedNode[] = [];

  // Option A: Extract directly from React Flow nodesData state (Most accurate)
  if (options.nodesData && options.nodesData.length > 0) {
    for (const n of options.nodesData) {
      if (options.scope === "selected" && selectedNodeIds && selectedNodeIds.size > 0 && !selectedNodeIds.has(n.id)) {
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
    const nodesLayer = flowContainer.querySelector(".react-flow__nodes") as HTMLElement | null;
    if (nodesLayer) {
      const nodeElements = Array.from(nodesLayer.querySelectorAll(".react-flow__node")) as HTMLElement[];
      for (const el of nodeElements) {
        const id = el.getAttribute("data-id") || "";
        if (options.scope === "selected" && selectedNodeIds && selectedNodeIds.size > 0 && !selectedNodeIds.has(id)) {
          continue;
        }

        const { x, y } = parseNodeTransform(el);
        const width = Math.max(280, el.offsetWidth || 280);
        const height = el.offsetHeight || 140;

        const tableNameEl = el.querySelector(".card-tbl-name, .table-name");
        const tableName = tableNameEl?.textContent?.trim() || id;

        const countEl = el.querySelector(".card-col-count, .card-tbl-count, .table-sub-count");
        const columnsCountText = countEl?.textContent?.trim() || "";

        const isCollapsed = el.classList.contains("is-collapsed");

        const columnRows = Array.from(el.querySelectorAll(".col-row, .column-row")) as HTMLElement[];
        const columns = columnRows.map((row) => {
          const nameEl = row.querySelector(".col-name");
          const name = nameEl?.textContent?.trim() || "";
          const typeEl = row.querySelector(".col-type, .col-type-tag");
          const type = typeEl?.textContent?.trim() || "";
          const isPk = !!row.querySelector(".pk-icon, .pk-tag") || row.classList.contains("pk-row") || row.classList.contains("is-pk");
          const isFk = !!row.querySelector(".fk-icon, .fk-tag") || row.classList.contains("fk-row") || row.classList.contains("is-fk");
          const isGeom = !!row.querySelector(".gis-icon, .col-geom-icon");
          return { name, type, isPk, isFk, isGeom };
        });

        const headerHeight = 38;
        const rowHeight = 28;
        const computedHeight = isCollapsed ? headerHeight : headerHeight + columns.length * rowHeight + 8;
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
  const edgesLayer = flowContainer.querySelector(".react-flow__edges") as HTMLElement | null;
  if (!edgesLayer) return [];

  const edgeElements = Array.from(edgesLayer.querySelectorAll(".react-flow__edge")) as HTMLElement[];
  const parsedEdges: ParsedEdge[] = [];

  for (const el of edgeElements) {
    const id = el.getAttribute("data-id") || "";
    const pathEl = el.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
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
  radius: number
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

/**
 * Capture Page 1: ERD Architecture Diagram to Canvas
 */
export async function captureDiagramToCanvas(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>
): Promise<HTMLCanvasElement> {
  const { nodes, bounds } = parseTableNodes(flowContainer, options, selectedNodeIds);
  const domEdges = parseEdges(flowContainer);

  const paper = getPaperDimensions(options.paperSize, options.orientation, bounds, options.scale);

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
        headerBg: "#f8fafc",
        headerText: "#0f172a",
        subText: "#64748b",
        rowBorder: "#f1f5f9",
        colName: "#1e293b",
        colType: "#64748b",
        pkBg: "rgba(59, 130, 246, 0.12)",
        pkText: "#2563eb",
        fkBg: "rgba(16, 185, 129, 0.12)",
        fkText: "#059669",
        edgeStroke: "#3b82f6",
        gridDots: "rgba(0, 0, 0, 0.04)",
        metaText: "#64748b",
        bannerBg: "#f8fafc",
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
        edgeStroke: "#3b82f6",
        gridDots: "rgba(255, 255, 255, 0.04)",
        metaText: "#9ca3af",
        bannerBg: "#111827",
        bannerBorder: "#1f2937",
      };

  // 1. Draw Paper Background (Skip if Transparent PNG)
  if (!isTransparent) {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle background dot grid pattern
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

  // Header Banner Height Allocation (0 if Transparent)
  const topBannerHeight = isTransparent ? 0 : 44 * options.scale;
  const bottomFooterHeight = isTransparent ? 0 : 28 * options.scale;

  // Calculate Fitting Transformation with clean top alignment
  const margin = (isTransparent ? 24 : 36) * options.scale;
  const availW = paper.width - margin * 2;
  const availH = paper.height - margin * 2 - topBannerHeight - bottomFooterHeight;

  const scaleFactor = Math.min(availW / bounds.width, availH / bounds.height);
  const fitW = bounds.width * scaleFactor;
  const fitH = bounds.height * scaleFactor;

  const offsetX = margin + (availW - fitW) / 2 - bounds.x * scaleFactor;
  const offsetY = margin + topBannerHeight + 10 * options.scale - bounds.y * scaleFactor;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scaleFactor, scaleFactor);

  // 2. Draw Edges (Bezier curves)
  ctx.save();
  ctx.strokeStyle = colors.edgeStroke;
  ctx.lineWidth = (2 / scaleFactor) * Math.max(1, options.scale * 0.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const nodeMap = new Map<string, ParsedNode>(nodes.map((n) => [n.id, n]));
  const exportedNodeIds = new Set<string>(nodes.map((n) => n.id));

  // Only draw edges if more than 1 table is selected and BOTH tables are in the export
  const edgeMapById = new Map((options.edgesData || []).map((e) => [e.id, e]));

  const validDomEdges =
    nodes.length > 1
      ? domEdges.filter((edge) => {
          const edgeData = edgeMapById.get(edge.id);
          if (edgeData) {
            return exportedNodeIds.has(edgeData.source) && exportedNodeIds.has(edgeData.target);
          }
          const parts = edge.id.replace(/^e-/, "").split("-");
          if (parts.length >= 2) {
            return exportedNodeIds.has(parts[0]) && exportedNodeIds.has(parts[1]);
          }
          return false;
        })
      : [];

  const validDataEdges =
    nodes.length > 1 && options.edgesData
      ? options.edgesData.filter((e) => exportedNodeIds.has(e.source) && exportedNodeIds.has(e.target))
      : [];

  if (validDomEdges.length > 0) {
    for (const edge of validDomEdges) {
      try {
        const p = new Path2D(edge.pathD);
        ctx.stroke(p);
      } catch {
        // Fallback
      }
    }
  } else if (validDataEdges.length > 0) {
    for (const e of validDataEdges) {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (src && tgt) {
        const x1 = src.x + src.width;
        const y1 = src.y + 38 + 14;
        const x2 = tgt.x;
        const y2 = tgt.y + 38 + 14;
        const c1x = x1 + Math.max(50, (x2 - x1) * 0.4);
        const c2x = x2 - Math.max(50, (x2 - x1) * 0.4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(c1x, y1, c2x, y2, x2, y2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // 3. Draw Table Cards
  const fontMono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  for (const node of nodes) {
    const cardRadius = 7;

    // Card Shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // Card Body Fill
    ctx.fillStyle = colors.cardBg;
    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, cardRadius);
    ctx.fill();
    ctx.restore();

    // Card Border
    ctx.strokeStyle = colors.cardBorder;
    ctx.lineWidth = 1.2;
    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, cardRadius);
    ctx.stroke();

    // Card Header Banner
    const headerHeight = 38;
    ctx.save();
    ctx.fillStyle = colors.headerBg;
    ctx.beginPath();
    ctx.moveTo(node.x + cardRadius, node.y);
    ctx.lineTo(node.x + node.width - cardRadius, node.y);
    ctx.quadraticCurveTo(node.x + node.width, node.y, node.x + node.width, node.y + cardRadius);
    ctx.lineTo(node.x + node.width, node.y + headerHeight);
    ctx.lineTo(node.x, node.y + headerHeight);
    ctx.lineTo(node.x, node.y + cardRadius);
    ctx.quadraticCurveTo(node.x, node.y, node.x + cardRadius, node.y);
    ctx.closePath();
    ctx.fill();

    // Header divider line
    ctx.strokeStyle = colors.cardBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y + headerHeight);
    ctx.lineTo(node.x + node.width, node.y + headerHeight);
    ctx.stroke();
    ctx.restore();

    // Header Title
    ctx.font = `bold 12.5px ${fontMono}`;
    ctx.fillStyle = colors.headerText;
    ctx.textBaseline = "middle";
    ctx.fillText(node.tableName, node.x + 14, node.y + headerHeight / 2);

    // Columns count text on right of header
    if (node.columnsCountText) {
      ctx.font = `10.5px ${fontMono}`;
      ctx.fillStyle = colors.subText;
      ctx.textAlign = "right";
      ctx.fillText(`${node.columns.length} cols`, node.x + node.width - 14, node.y + headerHeight / 2);
      ctx.textAlign = "left";
    }

    // Draw Column Rows
    if (!node.isCollapsed && node.columns.length > 0) {
      let rowY = node.y + headerHeight;
      const rowHeight = 28;

      for (let i = 0; i < node.columns.length; i++) {
        const col = node.columns[i];

        // Column row divider
        if (i > 0) {
          ctx.strokeStyle = colors.rowBorder;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(node.x + 10, rowY);
          ctx.lineTo(node.x + node.width - 10, rowY);
          ctx.stroke();
        }

        const midY = rowY + rowHeight / 2;

        let textStartX = node.x + 14;

        // PK pill badge
        if (col.isPk) {
          const pkW = 26;
          const pkH = 15;
          ctx.fillStyle = colors.pkBg;
          drawRoundedRect(ctx, textStartX, midY - pkH / 2, pkW, pkH, 3);
          ctx.fill();

          ctx.font = `bold 8.5px ${fontMono}`;
          ctx.fillStyle = colors.pkText;
          ctx.fillText("PK", textStartX + 5, midY + 1);
          textStartX += pkW + 8;
        } else if (col.isFk) {
          const fkW = 26;
          const fkH = 15;
          ctx.fillStyle = colors.fkBg;
          drawRoundedRect(ctx, textStartX, midY - fkH / 2, fkW, fkH, 3);
          ctx.fill();

          ctx.font = `bold 8.5px ${fontMono}`;
          ctx.fillStyle = colors.fkText;
          ctx.fillText("FK", textStartX + 5, midY + 1);
          textStartX += fkW + 8;
        }

        // Column Name
        ctx.font = `11.5px ${fontMono}`;
        ctx.fillStyle = colors.colName;
        ctx.fillText(col.name, textStartX, midY + 1);

        // Column Type on right
        if (col.type) {
          ctx.font = `10.5px ${fontMono}`;
          ctx.fillStyle = colors.colType;
          ctx.textAlign = "right";
          ctx.fillText(col.type, node.x + node.width - 14, midY + 1);
          ctx.textAlign = "left";
        }

        rowY += rowHeight;
      }
    }
  }

  ctx.restore();

  // 4. Top Header Report Banner (Only when NOT Transparent)
  if (!isTransparent) {
    ctx.save();
    const dbName = options.databaseName || "Database Schema";
    const relCount = validDataEdges.length || validDomEdges.length;

    // Title Text
    ctx.font = `bold ${Math.round(13 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = isLightPrint ? "#0f172a" : "#f8fafc";
    ctx.fillText(`ERD Architecture Diagram: ${dbName}`, 24 * options.scale, 24 * options.scale);

    // Subtitle Metadata Chips
    ctx.font = `${Math.round(10 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = colors.metaText;
    const metaText = `${nodes.length} Table${nodes.length === 1 ? "" : "s"} • ${relCount} Relation${relCount === 1 ? "" : "s"} • ${options.paperSize} ${options.orientation.toUpperCase()}`;
    ctx.fillText(metaText, 24 * options.scale, 38 * options.scale);

    // Divider Line
    ctx.strokeStyle = colors.bannerBorder;
    ctx.lineWidth = 1 * options.scale;
    ctx.beginPath();
    ctx.moveTo(20 * options.scale, 44 * options.scale);
    ctx.lineTo(canvas.width - 20 * options.scale, 44 * options.scale);
    ctx.stroke();

    // 5. Bottom Footer with Legend & Page Number
    const footerY = canvas.height - 14 * options.scale;

    ctx.font = `${Math.round(9.5 * options.scale)}px ${fontMono}`;
    ctx.fillStyle = colors.metaText;
    ctx.fillText("Legend: [PK] Primary Key   [FK] Foreign Key   ─── Relationship Reference", 24 * options.scale, footerY);

    ctx.textAlign = "right";
    ctx.fillText(
      options.reportType === "full_report" ? "Page 1 of 2 • Architecture Diagram" : "Page 1 of 1",
      canvas.width - 24 * options.scale,
      footerY
    );
    ctx.textAlign = "left";

    ctx.restore();
  }

  return canvas;
}

/**
 * Generate HTML Report Document for Page 2: Schema Data Dictionary
 */
export function generateDataDictionaryHtml(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>
): string {
  const { nodes } = parseTableNodes(flowContainer, options, selectedNodeIds);
  const exportedNodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = nodes.length > 1 && options.edgesData
    ? options.edgesData.filter((e) => exportedNodeIds.has(e.source) && exportedNodeIds.has(e.target))
    : [];

  const dbName = options.databaseName || "Database Schema";
  const isLandscape = options.orientation === "landscape";

  const totalCols = nodes.reduce((acc, n) => acc + n.columns.length, 0);

  const tablesHtml = nodes
    .map((table) => {
      const rowsHtml = table.columns
        .map((col) => {
          const pkBadge = col.isPk ? `<span class="badge pk-badge">PK</span>` : "";
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
            `
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
        <span>Page 2 of 2</span>
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
  selectedNodeIds?: Set<string>
): Promise<void> {
  const reportType = options.reportType || "full_report";

  // Capture Page 1 Diagram if requested
  let diagramDataUrl = "";
  if (reportType !== "dictionary_only") {
    const canvas = await captureDiagramToCanvas(
      flowContainer,
      { ...options, format: "print", scale: 2 },
      selectedNodeIds
    );
    diagramDataUrl = canvas.toDataURL("image/png");

    // Preload image so it is fully decoded before printing
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.src = diagramDataUrl;
      if (img.complete) {
        resolve();
      } else {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      }
    });
  }

  // Generate Page 2 Data Dictionary HTML if requested
  const dictionaryHtml =
    reportType !== "diagram_only"
      ? generateDataDictionaryHtml(flowContainer, options, selectedNodeIds)
      : "";

  const pageSizeStyle =
    options.paperSize === "Fit" ? "A4 landscape" : `${options.paperSize} ${options.orientation}`;

  // Clean up any stale portal / style elements
  const existingPortal = document.getElementById("dodb-print-portal");
  if (existingPortal?.parentNode) existingPortal.parentNode.removeChild(existingPortal);
  const existingStyle = document.getElementById("dodb-print-styles");
  if (existingStyle?.parentNode) existingStyle.parentNode.removeChild(existingStyle);

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
      body > *:not(#dodb-print-portal) {
        display: none !important;
      }
      #dodb-print-portal {
        display: block !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
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
        margin: 0;
        padding: 0;
        page-break-after: always;
      }
      .diagram-image {
        width: 100%;
        max-height: 94vh;
        object-fit: contain;
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
      .dictionary-grid {
        display: grid;
        gap: 14px;
        margin-bottom: 18px;
      }
      .landscape-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .portrait-grid {
        grid-template-columns: 1fr;
      }
      .table-card {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #ffffff;
        break-inside: avoid;
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
    ${
      diagramDataUrl
        ? `<div class="page-diagram"><img src="${diagramDataUrl}" alt="ERD Diagram" class="diagram-image" /></div>`
        : ""
    }
    ${dictionaryHtml}
  `;
  document.body.appendChild(portal);

  // Short delay to allow layout reflow
  await new Promise((resolve) => setTimeout(resolve, 100));

  const cleanup = () => {
    if (portal.parentNode) portal.parentNode.removeChild(portal);
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  };

  try {
    // Attempt Wails native window print first
    await apiClient.printWindow();
    // Also trigger window.print() for web browsers / webview
    window.print();
  } catch (err) {
    console.error("Print invocation error:", err);
    window.print();
  } finally {
    // Clean up after print sheet closes
    setTimeout(cleanup, 2500);
  }
}

/**
 * Trigger Image Download for PNG / JPG
 */
export async function downloadDiagramImage(
  flowContainer: HTMLElement,
  options: DiagramExportOptions,
  selectedNodeIds?: Set<string>
): Promise<string | null> {
  const canvas = await captureDiagramToCanvas(flowContainer, options, selectedNodeIds);
  const mimeType = options.format === "jpg" ? "image/jpeg" : "image/png";
  const quality = options.format === "jpg" ? 0.92 : 1.0;
  const dataUrl = canvas.toDataURL(mimeType, quality);

  const safeDb = (options.databaseName || "schema").replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = options.format === "jpg" ? "jpg" : "png";
  const defaultFilename =
    options.filename ||
    `${safeDb}_erd_${options.scope}_${Date.now()}.${ext}`;

  return await saveFile(defaultFilename, dataUrl);
}
