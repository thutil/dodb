// =======================================================================
// dodb GIS & Spatial Data Utilities
// Supports PostGIS, MySQL Spatial, SpatiaLite, WKT, GeoJSON, EWKB/WKB Hex
// =======================================================================

export type GisGeometryType =
  | "Point"
  | "LineString"
  | "Polygon"
  | "MultiPoint"
  | "MultiLineString"
  | "MultiPolygon"
  | "GeometryCollection";

export interface GeoJsonGeometry {
  type: GisGeometryType;
  coordinates: any;
  geometries?: GeoJsonGeometry[];
  srid?: number;
}

export interface GisSummary {
  type: GisGeometryType | "Geometry" | "Unknown";
  label: string;
  coordsPreview: string;
  srid?: number;
  pointCount?: number;
}

/**
 * Check whether a database column is a GIS / Geometry / Spatial column
 */
export function isGeometryColumn(colType?: string, colName?: string): boolean {
  const t = (colType || "").toLowerCase();
  const n = (colName || "").toLowerCase();

  const isTypeMatch = /(geometry|geography|geom|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|spatial)/.test(t);
  const isNameMatch = /(^geom$|^geometry$|^shape$|^the_geom$|^location$|^coordinates$|^lat_lng$|^wkt$|^geojson$)/.test(n);

  return isTypeMatch || isNameMatch;
}

/**
 * Check whether a given value is likely spatial/GIS data
 */
export function isGisData(val: unknown): boolean {
  if (!val) return false;

  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (obj.type && (obj.coordinates || obj.geometries)) {
      const typeStr = String(obj.type).toLowerCase();
      return /point|linestring|polygon|geometrycollection/.test(typeStr);
    }
    return false;
  }

  if (typeof val === "string") {
    const s = val.trim();
    if (s.length === 0) return false;

    // Check WKT or EWKT (e.g. SRID=4326;POINT(...))
    if (/^(SRID=\d+;)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*[\(zZmMsS]/i.test(s)) {
      return true;
    }

    // Check GeoJSON string
    if (s.startsWith("{") && s.endsWith("}") && s.includes('"type"') && (s.includes('"coordinates"') || s.includes('"geometries"'))) {
      return true;
    }

    // Check WKB / EWKB Hex string (starts with 00/01 and typical type bytes)
    if (/^[0-9a-fA-F]{16,}$/.test(s)) {
      const first4 = s.slice(0, 4);
      if (first4 === "0101" || first4 === "0102" || first4 === "0103" || first4 === "0104" || first4 === "0105" || first4 === "0106" || first4 === "0107" ||
          first4 === "0000" || first4 === "0020" || first4 === "0120") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse WKT (Well-Known Text) string into a GeoJsonGeometry object
 */
export function parseWkt(wkt: string): GeoJsonGeometry | null {
  let s = wkt.trim();
  if (!s) return null;

  let srid: number | undefined;
  const sridMatch = s.match(/^SRID=(\d+);/i);
  if (sridMatch) {
    srid = parseInt(sridMatch[1], 10);
    s = s.slice(sridMatch[0].length).trim();
  }

  // Identify Geometry Type
  const typeMatch = s.match(/^([A-Za-z]+)(\s+(?:Z|M|ZM))?\s*\(([\s\S]*)\)$/i);
  if (!typeMatch) {
    // Try simple POINT(1 2) format
    const altMatch = s.match(/^([A-Za-z]+)\s*\(([\s\S]*)\)$/i);
    if (!altMatch) return null;
    return parseWktBody(altMatch[1].toUpperCase(), altMatch[2].trim(), srid);
  }

  const rawType = typeMatch[1].toUpperCase();
  const body = typeMatch[3].trim();

  return parseWktBody(rawType, body, srid);
}

function parseCoordsPair(str: string): number[] {
  const parts = str.trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
  return parts.slice(0, 2); // [lng, lat]
}

function parseWktBody(type: string, body: string, srid?: number): GeoJsonGeometry | null {
  try {
    switch (type) {
      case "POINT": {
        const coords = parseCoordsPair(body);
        if (coords.length < 2) return null;
        return { type: "Point", coordinates: coords, srid };
      }
      case "LINESTRING": {
        const points = body.split(",").map((p) => parseCoordsPair(p));
        return { type: "LineString", coordinates: points, srid };
      }
      case "POLYGON": {
        // Matches rings like: ((x y, x y), (x y, x y))
        const rings: number[][][] = [];
        const ringMatches = body.match(/\([^\(\)]+\)/g);
        if (ringMatches) {
          for (const rm of ringMatches) {
            const rawRing = rm.replace(/[\(\)]/g, "").trim();
            const ringPts = rawRing.split(",").map((p) => parseCoordsPair(p));
            rings.push(ringPts);
          }
        } else {
          const rawRing = body.replace(/[\(\)]/g, "").trim();
          rings.push(rawRing.split(",").map((p) => parseCoordsPair(p)));
        }
        return { type: "Polygon", coordinates: rings, srid };
      }
      case "MULTIPOINT": {
        const clean = body.replace(/[\(\)]/g, " ");
        const points = clean.split(",").map((p) => parseCoordsPair(p));
        return { type: "MultiPoint", coordinates: points, srid };
      }
      case "MULTILINESTRING": {
        const lines: number[][][] = [];
        const lineMatches = body.match(/\([^\(\)]+\)/g);
        if (lineMatches) {
          for (const lm of lineMatches) {
            const raw = lm.replace(/[\(\)]/g, "").trim();
            lines.push(raw.split(",").map((p) => parseCoordsPair(p)));
          }
        }
        return { type: "MultiLineString", coordinates: lines, srid };
      }
      case "MULTIPOLYGON": {
        // MultiPolygon: (((x y, ...)), ((x y, ...)))
        const polys: number[][][][] = [];
        const polyMatches = body.match(/\(\([^\)]+\)\)/g);
        if (polyMatches) {
          for (const pm of polyMatches) {
            const rings: number[][][] = [];
            const ringMatches = pm.match(/\([^\(\)]+\)/g);
            if (ringMatches) {
              for (const rm of ringMatches) {
                const raw = rm.replace(/[\(\)]/g, "").trim();
                rings.push(raw.split(",").map((p) => parseCoordsPair(p)));
              }
            }
            polys.push(rings);
          }
        }
        return { type: "MultiPolygon", coordinates: polys, srid };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Decode WKB / EWKB Hex binary string to GeoJsonGeometry
 */
export function parseWkbHex(hex: string): GeoJsonGeometry | null {
  try {
    const raw = hex.trim();
    if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length < 18) return null;

    const buffer = new Uint8Array(raw.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    const view = new DataView(buffer.buffer);

    let offset = 0;
    const isLittleEndian = view.getUint8(offset) === 1;
    offset += 1;

    let typeCode = view.getUint32(offset, isLittleEndian);
    offset += 4;

    const hasSrid = (typeCode & 0x20000000) !== 0;
    let srid: number | undefined;
    if (hasSrid) {
      srid = view.getUint32(offset, isLittleEndian);
      offset += 4;
    }

    const baseType = typeCode & 0xff;

    if (baseType === 1) {
      // Point: 2 doubles (X, Y)
      const x = view.getFloat64(offset, isLittleEndian);
      offset += 8;
      const y = view.getFloat64(offset, isLittleEndian);
      return { type: "Point", coordinates: [x, y], srid };
    }

    if (baseType === 2) {
      // LineString: numPoints (uint32) + points
      const numPoints = view.getUint32(offset, isLittleEndian);
      offset += 4;
      const points: number[][] = [];
      for (let i = 0; i < numPoints && offset + 16 <= buffer.length; i++) {
        const x = view.getFloat64(offset, isLittleEndian);
        offset += 8;
        const y = view.getFloat64(offset, isLittleEndian);
        offset += 8;
        points.push([x, y]);
      }
      return { type: "LineString", coordinates: points, srid };
    }

    if (baseType === 3) {
      // Polygon: numRings (uint32) + rings
      const numRings = view.getUint32(offset, isLittleEndian);
      offset += 4;
      const rings: number[][][] = [];
      for (let r = 0; r < numRings; r++) {
        const numPoints = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const points: number[][] = [];
        for (let i = 0; i < numPoints && offset + 16 <= buffer.length; i++) {
          const x = view.getFloat64(offset, isLittleEndian);
          offset += 8;
          const y = view.getFloat64(offset, isLittleEndian);
          offset += 8;
          points.push([x, y]);
        }
        rings.push(points);
      }
      return { type: "Polygon", coordinates: rings, srid };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Universal GIS Parser: Converts WKT, GeoJSON, EWKB Hex or coordinate arrays to GeoJsonGeometry
 */
export function parseGisToGeoJson(val: unknown): GeoJsonGeometry | null {
  if (!val) return null;

  // 1. Direct object
  if (typeof val === "object") {
    const obj = val as any;
    if (obj.type && obj.coordinates) {
      return {
        type: obj.type as GisGeometryType,
        coordinates: obj.coordinates,
        srid: obj.srid || (obj.crs?.properties?.name?.includes("4326") ? 4326 : undefined),
      };
    }
    return null;
  }

  if (typeof val !== "string") return null;
  const s = val.trim();

  // 2. Try JSON parse
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const parsed = JSON.parse(s);
      if (parsed.type && parsed.coordinates) {
        return {
          type: parsed.type,
          coordinates: parsed.coordinates,
          srid: parsed.srid,
        };
      }
    } catch {
      // Ignore JSON parse error, try other formats
    }
  }

  // 3. Try WKT
  const wktResult = parseWkt(s);
  if (wktResult) return wktResult;

  // 4. Try WKB Hex
  if (/^[0-9a-fA-F]{16,}$/.test(s)) {
    const wkbResult = parseWkbHex(s);
    if (wkbResult) return wkbResult;
  }

  // 5. Try "lat, lng" or "lng, lat" simple pair
  const pairMatch = s.match(/^([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)$/);
  if (pairMatch) {
    const n1 = parseFloat(pairMatch[1]);
    const n2 = parseFloat(pairMatch[2]);
    // Determine which is lat (usually -90 to 90) and lng (-180 to 180)
    if (Math.abs(n1) <= 90 && Math.abs(n2) <= 180) {
      return { type: "Point", coordinates: [n2, n1] }; // [lng, lat]
    }
    return { type: "Point", coordinates: [n1, n2] };
  }

  return null;
}

/**
 * Convert GeoJsonGeometry back into standard WKT
 */
export function geoJsonToWkt(geom: GeoJsonGeometry): string {
  switch (geom.type) {
    case "Point":
      return `POINT (${geom.coordinates[0]} ${geom.coordinates[1]})`;
    case "LineString":
      return `LINESTRING (${geom.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(", ")})`;
    case "Polygon":
      return `POLYGON (${geom.coordinates
        .map((ring: number[][]) => `(${ring.map((c: number[]) => `${c[0]} ${c[1]}`).join(", ")})`)
        .join(", ")})`;
    case "MultiPoint":
      return `MULTIPOINT (${geom.coordinates.map((c: number[]) => `(${c[0]} ${c[1]})`).join(", ")})`;
    case "MultiLineString":
      return `MULTILINESTRING (${geom.coordinates
        .map((line: number[][]) => `(${line.map((c: number[]) => `${c[0]} ${c[1]}`).join(", ")})`)
        .join(", ")})`;
    case "MultiPolygon":
      return `MULTIPOLYGON (${geom.coordinates
        .map((poly: number[][][]) => `(${poly.map((ring: number[][]) => `(${ring.map((c: number[]) => `${c[0]} ${c[1]}`).join(", ")})`).join(", ")})`)
        .join(", ")})`;
    default:
      return JSON.stringify(geom);
  }
}

/**
 * Generate a short, informative summary for cell previews
 */
export function formatGisSummary(val: unknown): GisSummary | null {
  const geom = parseGisToGeoJson(val);
  if (!geom) return null;

  const type = geom.type;
  let coordsPreview = "";
  let pointCount = 0;

  if (type === "Point") {
    const lng = Number(geom.coordinates[0]).toFixed(4);
    const lat = Number(geom.coordinates[1]).toFixed(4);
    coordsPreview = `${lat}, ${lng}`;
    pointCount = 1;
  } else if (type === "LineString") {
    pointCount = geom.coordinates?.length || 0;
    coordsPreview = `${pointCount} pts`;
  } else if (type === "Polygon") {
    const exterior = geom.coordinates?.[0] || [];
    pointCount = exterior.length;
    coordsPreview = `${pointCount} vertices`;
  } else if (type === "MultiPolygon") {
    pointCount = geom.coordinates?.length || 0;
    coordsPreview = `${pointCount} polys`;
  } else {
    coordsPreview = type;
  }

  return {
    type,
    label: `${type} (${coordsPreview})`,
    coordsPreview,
    srid: geom.srid,
    pointCount,
  };
}

/**
 * Compute bounding box [ [minLng, minLat], [maxLng, maxLat] ]
 */
export function getGisBounds(geom: GeoJsonGeometry): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let hasCoords = false;

  function traverse(coords: any) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const lng = coords[0];
      const lat = coords[1];
      if (!isNaN(lng) && !isNaN(lat)) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        hasCoords = true;
      }
    } else {
      coords.forEach(traverse);
    }
  }

  traverse(geom.coordinates);

  if (!hasCoords) return null;

  // Pad slightly for point geometries so fitBounds doesn't glitch
  if (minLng === maxLng && minLat === maxLat) {
    minLng -= 0.005;
    maxLng += 0.005;
    minLat -= 0.005;
    maxLat += 0.005;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Compute center [lng, lat]
 */
export function getGisCenter(geom: GeoJsonGeometry): [number, number] {
  const bounds = getGisBounds(geom);
  if (!bounds) return [100.5018, 13.7563]; // Default Bangkok coordinates
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}
