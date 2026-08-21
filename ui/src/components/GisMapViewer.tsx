import React, { useEffect, useRef, useState, useId } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MapPin,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Copy,
  Check,
  Globe,
  Compass,
  X,
  Crosshair,
  Download,
  Info,
} from "lucide-react";
import {
  GeoJsonGeometry,
  parseGisToGeoJson,
  geoJsonToWkt,
  getGisBounds,
  getGisCenter,
  formatGisSummary,
} from "../utils/gisUtils";

export interface GisFeatureRecord {
  id: string | number;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
  label?: string;
  isCurrent?: boolean;
}

interface GisMapViewerProps {
  /** Single geometry or raw spatial data string to inspect */
  value?: unknown;
  /** Or multiple spatial records to show simultaneously */
  records?: GisFeatureRecord[];
  /** Title/label for modal header */
  title?: string;
  /** Subtitle or column name */
  subtitle?: string;
  /** Whether the viewer is in coordinate picker mode (click map to select point) */
  pickerMode?: boolean;
  /** Callback when coordinates are picked */
  onPickCoordinates?: (coords: { lng: number; lat: number; wkt: string }) => void;
  /** Modal close callback */
  onClose?: () => void;
  /** Inline mode (embedded inside a drawer/panel) vs Full Modal dialog */
  isInline?: boolean;
}

type BasemapStyle = "dark" | "light" | "osm" | "satellite";

const BASEMAP_TILES: Record<BasemapStyle, { name: string; tiles: string[]; maxzoom: number; attribution: string }> = {
  dark: {
    name: "Dark Matter",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    maxzoom: 19,
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
  },
  light: {
    name: "Light Positron",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    ],
    maxzoom: 19,
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
  },
  osm: {
    name: "OpenStreetMap",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    maxzoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
  },
  satellite: {
    name: "Esri Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 18,
    attribution: '&copy; Esri &mdash; Earthstar Geographics',
  },
};

export const GisMapViewer: React.FC<GisMapViewerProps> = ({
  value,
  records,
  title = "GIS Spatial Viewer",
  subtitle,
  pickerMode = false,
  onPickCoordinates,
  onClose,
  isInline = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pickerMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [basemap, setBasemap] = useState<BasemapStyle>("dark");
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [activeFeature, setActiveFeature] = useState<GisFeatureRecord | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [pickedCoords, setPickedCoords] = useState<{ lng: number; lat: number } | null>(null);

  // Normalize input into feature list
  const features: GisFeatureRecord[] = React.useMemo(() => {
    if (records && records.length > 0) {
      return records;
    }
    if (value) {
      const geom = parseGisToGeoJson(value);
      if (geom) {
        return [
          {
            id: "single",
            geometry: geom,
            label: title,
            isCurrent: true,
          },
        ];
      }
    }
    return [];
  }, [records, value, title]);

  const summary = React.useMemo(() => {
    if (features.length === 1) {
      return formatGisSummary(features[0].geometry);
    }
    return null;
  }, [features]);

  // Build MapLibre raster style JSON
  const getStyleForBasemap = (styleKey: BasemapStyle): maplibregl.StyleSpecification => {
    const bm = BASEMAP_TILES[styleKey];
    return {
      version: 8,
      sources: {
        "raster-tiles": {
          type: "raster",
          tiles: bm.tiles,
          tileSize: 256,
          attribution: bm.attribution,
          maxzoom: bm.maxzoom,
        },
      },
      layers: [
        {
          id: "simple-tiles",
          type: "raster",
          source: "raster-tiles",
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  };

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Determine initial center and zoom
    let center: [number, number] = [100.5018, 13.7563]; // Default Bangkok
    let zoom = 11;

    if (features.length > 0) {
      const firstBounds = getGisBounds(features[0].geometry);
      if (firstBounds) {
        center = getGisCenter(features[0].geometry);
        zoom = features[0].geometry.type === "Point" ? 14 : 11;
      }
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getStyleForBasemap(basemap),
      center,
      zoom,
      attributionControl: false,
    });

    mapInstanceRef.current = map;

    map.on("mousemove", (e) => {
      setCursorCoords({
        lng: Number(e.lngLat.lng.toFixed(6)),
        lat: Number(e.lngLat.lat.toFixed(6)),
      });
    });

    if (pickerMode) {
      map.on("click", (e) => {
        const lng = Number(e.lngLat.lng.toFixed(6));
        const lat = Number(e.lngLat.lat.toFixed(6));
        const wkt = `POINT (${lng} ${lat})`;

        setPickedCoords({ lng, lat });

        if (pickerMarkerRef.current) {
          pickerMarkerRef.current.setLngLat([lng, lat]);
        } else {
          const el = document.createElement("div");
          el.className = "gis-picker-pin";
          el.innerHTML = `
            <div style="background:#ef4444;width:18px;height:18px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(239,68,68,0.8);display:flex;align-items:center;justify-content:center;">
              <div style="width:6px;height:6px;background:white;border-radius:50%;"></div>
            </div>
          `;
          pickerMarkerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);
        }

        onPickCoordinates?.({ lng, lat, wkt });
      });
    }

    map.on("load", () => {
      renderGeoJsonLayers(map, features);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      pickerMarkerRef.current?.remove();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [pickerMode]);

  // Update basemap style
  const handleSwitchBasemap = (newStyle: BasemapStyle) => {
    setBasemap(newStyle);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setStyle(getStyleForBasemap(newStyle));
      mapInstanceRef.current.once("style.load", () => {
        if (mapInstanceRef.current) {
          renderGeoJsonLayers(mapInstanceRef.current, features);
        }
      });
    }
  };

  // Render vector shapes and point markers
  const renderGeoJsonLayers = (map: maplibregl.Map, featList: GisFeatureRecord[]) => {
    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Remove existing geojson sources/layers if any
    ["gis-polygons-fill", "gis-polygons-line", "gis-lines"].forEach((layerId) => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
    if (map.getSource("gis-features")) map.removeSource("gis-features");

    if (featList.length === 0) return;

    // Separate Points from Lines/Polygons for crisp styling
    const nonPointFeatures: any[] = [];
    const bounds = new maplibregl.LngLatBounds();
    let hasCoords = false;

    featList.forEach((feat, idx) => {
      const g = feat.geometry;
      const fBounds = getGisBounds(g);
      if (fBounds) {
        bounds.extend(fBounds[0]);
        bounds.extend(fBounds[1]);
        hasCoords = true;
      }

      if (g.type === "Point") {
        const coords = g.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const el = document.createElement("div");
          el.className = "gis-map-marker";
          el.style.cursor = "pointer";
          const color = feat.isCurrent ? "var(--accent-primary, #3b82f6)" : "#10b981";
          el.innerHTML = `
            <div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.5);transform:scale(1);transition:transform 0.15s ease;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>
            </div>
          `;

          el.addEventListener("mouseenter", () => {
            (el.firstElementChild as HTMLElement).style.transform = "scale(1.25)";
          });
          el.addEventListener("mouseleave", () => {
            (el.firstElementChild as HTMLElement).style.transform = "scale(1)";
          });

          const popupContent = document.createElement("div");
          popupContent.style.fontFamily = "var(--font-sans, system-ui)";
          popupContent.style.fontSize = "12px";
          popupContent.style.color = "#1e293b";
          popupContent.style.padding = "4px";
          popupContent.innerHTML = `
            <div style="font-weight:700;margin-bottom:4px;color:#0f172a;">${feat.label || `Record #${idx + 1}`}</div>
            <div style="font-family:monospace;font-size:11px;color:#475569;">${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</div>
          `;

          const popup = new maplibregl.Popup({ offset: 12 }).setDOMContent(popupContent);

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([coords[0], coords[1]])
            .setPopup(popup)
            .addTo(map);

          marker.getElement().addEventListener("click", () => {
            setActiveFeature(feat);
          });

          markersRef.current.push(marker);
        }
      } else {
        nonPointFeatures.push({
          type: "Feature",
          properties: {
            id: feat.id,
            label: feat.label || `Feature #${idx + 1}`,
          },
          geometry: g,
        });
      }
    });

    if (nonPointFeatures.length > 0) {
      map.addSource("gis-features", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: nonPointFeatures,
        },
      });

      // Polygon fill layer
      map.addLayer({
        id: "gis-polygons-fill",
        type: "fill",
        source: "gis-features",
        filter: ["==", "$type", "Polygon"],
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.25,
        },
      });

      // Polygon outline layer
      map.addLayer({
        id: "gis-polygons-line",
        type: "line",
        source: "gis-features",
        filter: ["==", "$type", "Polygon"],
        paint: {
          "line-color": "#60a5fa",
          "line-width": 2.5,
        },
      });

      // LineString layer
      map.addLayer({
        id: "gis-lines",
        type: "line",
        source: "gis-features",
        filter: ["==", "$type", "LineString"],
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3,
        },
      });
    }

    // Auto fit bounds
    if (hasCoords) {
      map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 16,
        duration: 800,
      });
    }
  };

  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();

  const handleFitBounds = () => {
    if (!mapInstanceRef.current || features.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let hasCoords = false;
    features.forEach((feat) => {
      const b = getGisBounds(feat.geometry);
      if (b) {
        bounds.extend(b[0]);
        bounds.extend(b[1]);
        hasCoords = true;
      }
    });
    if (hasCoords) {
      mapInstanceRef.current.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: 800 });
    }
  };

  const handleCopy = (text: string, format: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const handleExportGeoJson = () => {
    const geojson = {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        id: f.id,
        properties: f.properties || { label: f.label },
        geometry: f.geometry,
      })),
    };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dodb_gis_export_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentWkt = features.length === 1 ? geoJsonToWkt(features[0].geometry) : "";
  const currentGeoJsonStr = features.length === 1 ? JSON.stringify(features[0].geometry, null, 2) : "";

  const containerContent = (
    <div className={`gis-viewer-container ${isInline ? "inline-mode" : "modal-mode"}`}>
      {/* Map Header Toolbar */}
      <div className="gis-header-bar">
        <div className="gis-header-left">
          <div className="gis-icon-tag">
            <Globe size={15} />
          </div>
          <div>
            <div className="gis-title">{title}</div>
            {subtitle && <div className="gis-subtitle">{subtitle}</div>}
          </div>
        </div>

        <div className="gis-header-actions">
          {/* Basemap Switcher */}
          <div className="gis-basemap-selector">
            <Layers size={13} style={{ color: "var(--text-muted)" }} />
            <select
              className="gis-select"
              value={basemap}
              onChange={(e) => handleSwitchBasemap(e.target.value as BasemapStyle)}
              title="Select Basemap Layer"
            >
              <option value="dark">Dark Matter</option>
              <option value="light">Positron Light</option>
              <option value="osm">OpenStreetMap</option>
              <option value="satellite">Satellite Imagery</option>
            </select>
          </div>

          {/* Quick Copy WKT / GeoJSON for single record */}
          {features.length === 1 && (
            <div className="gis-copy-group">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleCopy(currentWkt, "wkt")}
                title="Copy WKT string"
              >
                {copiedFormat === "wkt" ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                <span>WKT</span>
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleCopy(currentGeoJsonStr, "geojson")}
                title="Copy GeoJSON JSON"
              >
                {copiedFormat === "geojson" ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                <span>GeoJSON</span>
              </button>
            </div>
          )}

          {/* Export Layer GeoJSON */}
          {features.length > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportGeoJson}
              title="Export all geometries to .geojson file"
            >
              <Download size={12} />
              <span>Export</span>
            </button>
          )}

          {onClose && (
            <button className="gis-close-btn" onClick={onClose} title="Close (Esc)">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Map Body */}
      <div className="gis-map-body">
        <div ref={mapContainerRef} className="gis-map-canvas" />

        {/* Floating Map Controls */}
        <div className="gis-map-controls">
          <button className="gis-ctrl-btn" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <button className="gis-ctrl-btn" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <button className="gis-ctrl-btn" onClick={handleFitBounds} title="Fit to Geometry Bounds">
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Picker Mode Instruction Banner */}
        {pickerMode && (
          <div className="gis-picker-banner">
            <Crosshair size={14} />
            <span>Click anywhere on the map to pick coordinates</span>
            {pickedCoords && (
              <span className="font-mono" style={{ color: "var(--accent-primary, #3b82f6)", fontWeight: 600 }}>
                ({pickedCoords.lat.toFixed(6)}, {pickedCoords.lng.toFixed(6)})
              </span>
            )}
          </div>
        )}

        {/* Bottom Coordinates & Stats HUD */}
        <div className="gis-hud-footer font-mono">
          <div className="gis-hud-item">
            <Compass size={11} />
            <span>{cursorCoords ? `${cursorCoords.lat.toFixed(5)}, ${cursorCoords.lng.toFixed(5)}` : "Move cursor on map"}</span>
          </div>

          <div className="gis-hud-item">
            <MapPin size={11} />
            <span>
              {features.length} {features.length === 1 ? "geometry" : "spatial records"}
            </span>
          </div>

          {summary?.srid && (
            <div className="gis-hud-item">
              <span>EPSG:{summary.srid}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isInline) {
    return containerContent;
  }

  return (
    <div className="gis-modal-overlay" onClick={onClose}>
      <div className="gis-modal-card" onClick={(e) => e.stopPropagation()}>
        {containerContent}
      </div>
    </div>
  );
};
