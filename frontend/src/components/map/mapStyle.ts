import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// Point MapLibre at its worker file explicitly so it works the same in dev and production builds.
setWorkerUrl(workerUrl);

/**
 * Vector basemap from OpenFreeMap (OpenStreetMap data, no API key). If it can't load, we fall back
 * to the standard OpenStreetMap raster tiles. Override with VITE_MAP_STYLE_URL.
 */
export const VECTOR_STYLE: string = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ?? "https://tiles.openfreemap.org/styles/positron";

export const RASTER_FALLBACK: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#f2efe9" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.6, "raster-opacity": 0.85 } },
  ],
};

// Marker fills use the Commons illustration accents; every marker has an ink outline (stroke-frame),
// and the legend always names the status, so colour is never the only signal.
export const STATUS_COLOR_EXPR: any = [
  "match", ["get", "status"],
  ["submitted", "pending_verification", "reopened"], "#f2c94c",
  ["verified", "assigned", "in_progress", "on_hold", "escalated"], "#5b9bd5",
  "awaiting_verification", "#a7ccb0",
  "resolved", "#2f6b41",
  "#b9b8b1",
];

export const PRIORITY_RADIUS_EXPR: any = [
  "+",
  ["match", ["get", "priority"], "critical", 9, "high", 7.5, "medium", 6.5, "low", 5.5, 5.5],
  ["min", 5, ["*", 0.8, ["get", "support"]]],
];
