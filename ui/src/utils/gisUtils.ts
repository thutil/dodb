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

export interface CoordinatePair {
  latColumn: string;
  lngColumn: string;
  prefix: string;
  label: string;
}

export interface GisFeatureRecord {
  id: string | number;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
  label?: string;
  isCurrent?: boolean;
}

/**
 * Validate latitude and longitude numbers
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const LAT_PATTERNS = [
  /^(.*?)(?:_|\b)(?:latitude|latitube|lat_deg|latval|lat|y)$/i,
  /^(.*?)(?:Latitude|Latitube|LatDeg|LatVal|Lat|Y)$/,
];

const LNG_PATTERNS = [
  /^(.*?)(?:_|\b)(?:longitude|longitube|lon_deg|lng_deg|lngval|lonval|long|lng|lon|x)$/i,
  /^(.*?)(?:Longitude|Longitube|LonDeg|LngDeg|LngVal|LonVal|Long|Lng|Lon|X)$/,
];

function extractLatPrefix(colName: string): string | null {
  const clean = colName.trim();
  for (const pat of LAT_PATTERNS) {
    const m = clean.match(pat);
    if (m) {
      const suffix = clean.slice(m[1].length).toLowerCase();
      if (/^(?:_|\b)?(?:latitude|latitube|lat_deg|latval|lat|y)$/i.test(suffix)) {
        return m[1].replace(/[_.\s-]+$/, "").toLowerCase();
      }
    }
  }
  return null;
}

function extractLngPrefix(colName: string): string | null {
  const clean = colName.trim();
  for (const pat of LNG_PATTERNS) {
    const m = clean.match(pat);
    if (m) {
      const suffix = clean.slice(m[1].length).toLowerCase();
      if (/^(?:_|\b)?(?:longitude|longitube|lon_deg|lng_deg|lngval|lonval|long|lng|lon|x)$/i.test(suffix)) {
        return m[1].replace(/[_.\s-]+$/, "").toLowerCase();
      }
    }
  }
  return null;
}

/**
 * Smart detection of coordinate pairs (e.g. lat + lng, latitude + longitude, pickup_lat + pickup_lng)
 */
export function detectCoordinatePairs(columns: Array<{ name: string; type?: string }>): CoordinatePair[] {
  if (!columns || columns.length < 2) return [];

  const latCols: Array<{ name: string; prefix: string }> = [];
  const lngCols: Array<{ name: string; prefix: string }> = [];

  columns.forEach((col) => {
    const latPrefix = extractLatPrefix(col.name);
    if (latPrefix !== null) {
      latCols.push({ name: col.name, prefix: latPrefix });
    }
    const lngPrefix = extractLngPrefix(col.name);
    if (lngPrefix !== null) {
      lngCols.push({ name: col.name, prefix: lngPrefix });
    }
  });

  const pairs: CoordinatePair[] = [];
  const usedLng = new Set<string>();

  // 1. Exact prefix match (e.g. pickup_lat + pickup_lng)
  latCols.forEach((lat) => {
    const matchingLng = lngCols.find((lng) => !usedLng.has(lng.name) && lng.prefix === lat.prefix);
    if (matchingLng) {
      usedLng.add(matchingLng.name);
      const prefixLabel = lat.prefix ? `${lat.prefix.replace(/_/g, " ")} ` : "";
      pairs.push({
        latColumn: lat.name,
        lngColumn: matchingLng.name,
        prefix: lat.prefix,
        label: `${prefixLabel}(${lat.name}, ${matchingLng.name})`.trim(),
      });
    }
  });

  // 2. If there's 1 unmatched lat and 1 unmatched lng in the entire table, pair them
  const remainingLat = latCols.filter((l) => !pairs.some((p) => p.latColumn === l.name));
  const remainingLng = lngCols.filter((l) => !usedLng.has(l.name));
  if (remainingLat.length === 1 && remainingLng.length === 1) {
    pairs.push({
      latColumn: remainingLat[0].name,
      lngColumn: remainingLng[0].name,
      prefix: "",
      label: `(${remainingLat[0].name}, ${remainingLng[0].name})`,
    });
  }

  return pairs;
}

/**
 * Check whether a database column is a GIS / Geometry / Spatial column or coordinate column
 */
export function isGeometryColumn(colType?: string, colName?: string): boolean {
  const t = (colType || "").toLowerCase();
  const n = (colName || "").toLowerCase();

  const isTypeMatch = /(geometry|geography|geom|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|spatial)/.test(t);
  const isNameMatch = /(^geom$|^geometry$|^shape$|^the_geom$|^location$|^coordinates$|^coord$|^lat_lng$|^latlng$|^wkt$|^geojson$|.*geom.*|.*spatial.*|.*polygon.*|.*coord.*)/.test(n);

  return isTypeMatch || isNameMatch;
}

/**
 * Check whether a column name indicates coordinate/location data
 */
export function isCoordinateColumn(colName?: string, colType?: string): boolean {
  if (isGeometryColumn(colType, colName)) return true;
  const n = (colName || "").toLowerCase();
  return /(?:^|[_.-\s])(lat|latitude|latitube|lng|lon|long|longitude|longitube|coord|coords|coordinates|location|position|gps|geom|geometry|point)(?:$|[_.-\s])/i.test(n);
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

    // Check WKB / EWKB Hex string (starts with 00/01 and typical type bytes, or 16+ hex characters)
    if (/^[0-9a-fA-F]{16,}$/.test(s)) {
      return true;
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

function extractParenGroups(text: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0 && start !== -1) {
        groups.push(text.slice(start + 1, i).trim());
        start = -1;
      }
    }
  }
  return groups;
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
        const points = body.split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
        return { type: "LineString", coordinates: points, srid };
      }
      case "POLYGON": {
        // Matches rings like: ((x y, x y), (x y, x y)) or (x y, x y)
        const rings: number[][][] = [];
        const ringGroups = extractParenGroups(body);
        if (ringGroups.length > 0) {
          for (const rg of ringGroups) {
            const pts = rg.split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
            if (pts.length > 0) rings.push(pts);
          }
        } else {
          const pts = body.replace(/[\(\)]/g, "").split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
          if (pts.length > 0) rings.push(pts);
        }
        return { type: "Polygon", coordinates: rings, srid };
      }
      case "MULTIPOINT": {
        const clean = body.replace(/[\(\)]/g, " ");
        const points = clean.split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
        return { type: "MultiPoint", coordinates: points, srid };
      }
      case "MULTILINESTRING": {
        const lines: number[][][] = [];
        const lineGroups = extractParenGroups(body);
        if (lineGroups.length > 0) {
          for (const lg of lineGroups) {
            const pts = lg.split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
            if (pts.length > 0) lines.push(pts);
          }
        } else {
          const pts = body.replace(/[\(\)]/g, "").split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
          if (pts.length > 0) lines.push(pts);
        }
        return { type: "MultiLineString", coordinates: lines, srid };
      }
      case "MULTIPOLYGON": {
        // MultiPolygon body: ((ring1), (ring2)), ((ring1))
        const polys: number[][][][] = [];
        const polyGroups = extractParenGroups(body);
        if (polyGroups.length > 0) {
          for (const pg of polyGroups) {
            const rings: number[][][] = [];
            const ringGroups = extractParenGroups(pg);
            if (ringGroups.length > 0) {
              for (const rg of ringGroups) {
                const pts = rg.split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
                if (pts.length > 0) rings.push(pts);
              }
            } else {
              const pts = pg.replace(/[\(\)]/g, "").split(",").map((p) => parseCoordsPair(p)).filter((c) => c.length >= 2);
              if (pts.length > 0) rings.push(pts);
            }
            if (rings.length > 0) polys.push(rings);
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
    let raw = hex.trim();
    if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length < 10) return null;

    // Some databases (e.g. MySQL) prefix 4-byte SRID before standard WKB
    let sridPrefix: number | undefined;
    if (raw.length >= 18 && (raw.startsWith("0000") || raw.startsWith("E610") || raw.startsWith("e610"))) {
      const firstByte = parseInt(raw.slice(8, 10), 16);
      if (firstByte === 0 || firstByte === 1) {
        const sridBytes = raw.slice(0, 8).match(/.{1,2}/g)!.map((b) => parseInt(b, 16));
        const view = new DataView(new Uint8Array(sridBytes).buffer);
        sridPrefix = view.getUint32(0, true);
        if (sridPrefix > 1000000) {
          sridPrefix = view.getUint32(0, false);
        }
        raw = raw.slice(8);
      }
    }

    const buffer = new Uint8Array(raw.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    const view = new DataView(buffer.buffer);

    let offset = 0;
    let globalSrid = sridPrefix;

    function readGeometry(): GeoJsonGeometry | null {
      if (offset >= buffer.length) return null;
      const isLittleEndian = view.getUint8(offset) === 1;
      offset += 1;

      let typeCode = view.getUint32(offset, isLittleEndian);
      offset += 4;

      const hasSrid = (typeCode & 0x20000000) !== 0;
      let srid = globalSrid;
      if (hasSrid) {
        srid = view.getUint32(offset, isLittleEndian);
        globalSrid = srid;
        offset += 4;
      }

      // Check dimensions (Z/M flags)
      const hasZ = (typeCode & 0x80000000) !== 0 || (typeCode >= 1000 && typeCode < 2000) || (typeCode >= 3000 && typeCode < 4000);
      const hasM = (typeCode & 0x40000000) !== 0 || (typeCode >= 2000 && typeCode < 3000) || (typeCode >= 3000 && typeCode < 4000);
      const coordDim = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

      // Base geometry type
      let baseType = typeCode & 0xffff;
      if (baseType >= 1000 && baseType < 4000) {
        baseType = baseType % 1000;
      }
      baseType = baseType & 0xff;

      function readPointCoords(): [number, number] {
        const x = view.getFloat64(offset, isLittleEndian);
        const y = view.getFloat64(offset + 8, isLittleEndian);
        offset += coordDim * 8;
        return [x, y];
      }

      if (baseType === 1) {
        // Point
        const coords = readPointCoords();
        return { type: "Point", coordinates: coords, srid };
      }

      if (baseType === 2) {
        // LineString
        const numPoints = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const points: number[][] = [];
        for (let i = 0; i < numPoints && offset + 16 <= buffer.length; i++) {
          points.push(readPointCoords());
        }
        return { type: "LineString", coordinates: points, srid };
      }

      if (baseType === 3) {
        // Polygon
        const numRings = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const rings: number[][][] = [];
        for (let r = 0; r < numRings; r++) {
          const numPoints = view.getUint32(offset, isLittleEndian);
          offset += 4;
          const points: number[][] = [];
          for (let i = 0; i < numPoints && offset + 16 <= buffer.length; i++) {
            points.push(readPointCoords());
          }
          rings.push(points);
        }
        return { type: "Polygon", coordinates: rings, srid };
      }

      if (baseType === 4) {
        // MultiPoint
        const numPoints = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const points: number[][] = [];
        for (let i = 0; i < numPoints; i++) {
          if (offset >= buffer.length) break;
          const nextByte = view.getUint8(offset);
          if (nextByte === 0 || nextByte === 1) {
            const ptGeom = readGeometry();
            if (ptGeom && ptGeom.coordinates) points.push(ptGeom.coordinates);
          } else {
            points.push(readPointCoords());
          }
        }
        return { type: "MultiPoint", coordinates: points, srid };
      }

      if (baseType === 5) {
        // MultiLineString
        const numLines = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const lines: number[][][] = [];
        for (let i = 0; i < numLines; i++) {
          if (offset >= buffer.length) break;
          const lineGeom = readGeometry();
          if (lineGeom && lineGeom.coordinates) lines.push(lineGeom.coordinates);
        }
        return { type: "MultiLineString", coordinates: lines, srid };
      }

      if (baseType === 6) {
        // MultiPolygon
        const numPolys = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const polys: number[][][][] = [];
        for (let i = 0; i < numPolys; i++) {
          if (offset >= buffer.length) break;
          const polyGeom = readGeometry();
          if (polyGeom && polyGeom.coordinates) polys.push(polyGeom.coordinates);
        }
        return { type: "MultiPolygon", coordinates: polys, srid };
      }

      if (baseType === 7) {
        // GeometryCollection
        const numGeoms = view.getUint32(offset, isLittleEndian);
        offset += 4;
        const geoms: GeoJsonGeometry[] = [];
        for (let i = 0; i < numGeoms; i++) {
          if (offset >= buffer.length) break;
          const g = readGeometry();
          if (g) geoms.push(g);
        }
        return { type: "GeometryCollection", coordinates: [], geometries: geoms, srid };
      }

      return null;
    }

    return readGeometry();
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
      if (parsed.type && (parsed.coordinates || parsed.geometries)) {
        return {
          type: parsed.type,
          coordinates: parsed.coordinates,
          geometries: parsed.geometries,
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

  // 4. Try WKB / EWKB Hex
  if (/^[0-9a-fA-F]{16,}$/.test(s)) {
    const wkbResult = parseWkbHex(s);
    if (wkbResult) return wkbResult;
  }

  // 5. Try "lat, lng" or "lng, lat" simple pair
  const pairMatch = s.match(/^([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)$/);
  if (pairMatch) {
    const n1 = parseFloat(pairMatch[1]);
    const n2 = parseFloat(pairMatch[2]);
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
  } else if (type === "MultiPoint") {
    pointCount = geom.coordinates?.length || 0;
    coordsPreview = `${pointCount} pts`;
  } else if (type === "MultiLineString") {
    pointCount = geom.coordinates?.length || 0;
    coordsPreview = `${pointCount} lines`;
  } else if (type === "MultiPolygon") {
    pointCount = geom.coordinates?.length || 0;
    coordsPreview = `${pointCount} poly${pointCount === 1 ? "" : "s"}`;
  } else if (type === "GeometryCollection") {
    pointCount = geom.geometries?.length || 0;
    coordsPreview = `${pointCount} items`;
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

/**
 * Extract point coordinates from a single cell or row coordinate pairs
 */
export function extractPointFromRow(
  row: Record<string, unknown>,
  columns: Array<{ name: string; type?: string }>,
  coordinatePairs: CoordinatePair[] = []
): Array<{ label: string; coordinates: [number, number]; colName: string }> {
  if (!row) return [];
  const points: Array<{ label: string; coordinates: [number, number]; colName: string }> = [];

  // 1. Check Coordinate Pairs
  for (const pair of coordinatePairs) {
    const rawLat = row[pair.latColumn];
    const rawLng = row[pair.lngColumn];
    if (rawLat != null && rawLng != null) {
      const latVal = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat));
      const lngVal = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng));
      if (isValidCoordinate(latVal, lngVal)) {
        points.push({
          label: pair.label || `${pair.latColumn}, ${pair.lngColumn}`,
          coordinates: [lngVal, latVal],
          colName: pair.latColumn,
        });
      }
    }
  }

  // 2. Check Geometry / String / JSON Columns
  for (const col of columns) {
    // If column is already part of a paired coordinate, skip
    if (coordinatePairs.some((p) => p.latColumn === col.name || p.lngColumn === col.name)) {
      continue;
    }
    const val = row[col.name];
    if (val == null || val === "") continue;

    // Check GIS data (WKT, WKB, GeoJSON)
    const geom = parseGisToGeoJson(val);
    if (geom && geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      const lng = Number(geom.coordinates[0]);
      const lat = Number(geom.coordinates[1]);
      if (isValidCoordinate(lat, lng)) {
        points.push({
          label: col.name,
          coordinates: [lng, lat],
          colName: col.name,
        });
      }
    }
  }

  return points;
}

/**
 * Extract all spatial features (Geometry shapes + Coordinate points) from entire dataset for Map View
 */
export function getAllSpatialFeaturesFromRows(
  rows: Record<string, unknown>[],
  columns: Array<{ name: string; type?: string }>
): GisFeatureRecord[] {
  if (!rows || rows.length === 0 || !columns || columns.length === 0) return [];

  const pairs = detectCoordinatePairs(columns);
  const features: GisFeatureRecord[] = [];

  rows.forEach((row, rowIdx) => {
    // 1. Check Geometry columns (Polygons, LineStrings, Points, etc.)
    columns.forEach((col) => {
      const val = row[col.name];
      if (val != null && val !== "") {
        if (isGeometryColumn(col.type, col.name) || isGisData(val)) {
          const geom = parseGisToGeoJson(val);
          if (geom) {
            features.push({
              id: `geom-${rowIdx}-${col.name}`,
              geometry: geom,
              properties: { ...row },
              label: `Row #${rowIdx + 1} (${col.name})`,
            });
          }
        }
      }
    });

    // 2. Check coordinate pairs and single coordinate points
    const points = extractPointFromRow(row, columns, pairs);
    points.forEach((pt, ptIdx) => {
      // Avoid duplicate if already added by geometry column above
      const isAlreadyAdded = features.some((f) => f.id === `geom-${rowIdx}-${pt.colName}`);
      if (!isAlreadyAdded) {
        features.push({
          id: `pt-${rowIdx}-${pt.colName || ptIdx}`,
          geometry: {
            type: "Point",
            coordinates: pt.coordinates,
          },
          properties: { ...row },
          label: `Row #${rowIdx + 1}: ${pt.label}`,
        });
      }
    });
  });

  return features;
}
