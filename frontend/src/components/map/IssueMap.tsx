import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
import { PRIORITY_RADIUS_EXPR, RASTER_FALLBACK, STATUS_COLOR_EXPR, VECTOR_STYLE } from "./mapStyle";
import { STATUS } from "@/utils/status";
import type { Status } from "@/types";

export type FC = { type: "FeatureCollection"; features: any[] };

interface Props {
  issues: FC;
  localities?: FC;
  center: [number, number]; // [lng, lat]
  zoom?: number;
  mode?: "markers" | "heatmap";
  showLocalities?: boolean;
  hotspots?: { lat: number; lng: number; total: number }[];
  onSelectIssue?: (trackingId: string) => void;
  onSelectLocality?: (id: string) => void;
  flyTo?: { lng: number; lat: number; zoom?: number } | null;
  interactive?: boolean;
  className?: string;
}

/**
 * MapLibre map with:
 *  - client-side clustering of issue points (cluster bubbles show counts; click to zoom in)
 *  - status-coloured markers sized by priority + community support
 *  - an optional density heatmap
 *  - optional locality polygons (click for statistics)
 *  - popovers with the issue title and status
 */
export function IssueMap({ issues, localities, center, zoom = 11.5, mode = "markers", showLocalities, hotspots,
  onSelectIssue, onSelectLocality, flyTo, interactive = true, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onSelectIssue, onSelectLocality });
  cb.current = { onSelectIssue, onSelectLocality };

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current, style: VECTOR_STYLE, center, zoom, interactive,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    let fellBack = false;
    map.on("error", () => {
      // If the vector style can't be fetched, switch once to raster OSM tiles.
      if (!fellBack && !map.isStyleLoaded()) {
        fellBack = true;
        map.setStyle(RASTER_FALLBACK);
      }
    });
    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "bottom-right");
    }
    const setup = () => {
      if (map.getSource("issues")) return;
      map.addSource("issues", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 });
      map.addSource("issues-raw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("localities", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({ id: "loc-fill", type: "fill", source: "localities", layout: { visibility: "none" },
        paint: { "fill-color": ["interpolate", ["linear"], ["get", "open"], 0, "#e4efe6", 6, "#f8e7ad", 14, "#f7d6d3"], "fill-opacity": 0.55 } });
      map.addLayer({ id: "loc-line", type: "line", source: "localities", layout: { visibility: "none" },
        paint: { "line-color": "#1d1d1b", "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      map.addLayer({ id: "loc-label", type: "symbol", source: "localities", layout: { visibility: "none", "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#1d1d1b", "text-halo-color": "#fbfaf7", "text-halo-width": 1.5 } });

      map.addLayer({ id: "heat", type: "heatmap", source: "issues-raw", layout: { visibility: "none" }, paint: {
        "heatmap-weight": ["match", ["get", "priority"], "critical", 1, "high", 0.8, "medium", 0.6, 0.4],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 15, 2.2],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 15, 34],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(167,204,176,0)", 0.2, "#a7ccb0", 0.45, "#f2c94c", 0.75, "#e07a7a", 1, "#a3312b"],
        "heatmap-opacity": 0.85 } });

      map.addLayer({ id: "hotspot-ring", type: "circle", source: "hotspots", paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "total"], 3, 26, 15, 46], "circle-color": "rgba(224,122,122,0.10)",
        "circle-stroke-color": "#1d1d1b", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 } });

      map.addLayer({ id: "clusters", type: "circle", source: "issues", filter: ["has", "point_count"], paint: {
        "circle-color": "#ffffff",
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24],
        "circle-stroke-width": 1.5, "circle-stroke-color": "#1d1d1b" } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "issues", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#1d1d1b" } });
      map.addLayer({ id: "points", type: "circle", source: "issues", filter: ["!", ["has", "point_count"]], paint: {
        "circle-color": STATUS_COLOR_EXPR, "circle-radius": PRIORITY_RADIUS_EXPR,
        "circle-stroke-width": 1.5, "circle-stroke-color": "#1d1d1b" } });

      map.on("click", "clusters", async (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource("issues") as GeoJSONSource;
        const z = await src.getClusterExpansionZoom((f.properties as any).cluster_id);
        map.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.3 });
      });
      const popup = new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: "280px" });
      map.on("mouseenter", "points", (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        const s = STATUS[p.status as Status];
        const esc = (t: string) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
        popup.setLngLat((e.features![0].geometry as any).coordinates).setHTML(
          `<div style="padding:12px 14px;max-width:260px"><div style="font:700 15px/21px var(--font-serif)">${esc(p.title)}</div>
           <div style="margin-top:6px;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border-radius:999px;font:500 12px/16px var(--font-sans);background:var(--${{reported:"yellow-200",reviewing:"stone-200","in-progress":"blue-200",resolved:"sage-200",closed:"stone-200",urgent:"rose-200"}[s.badge]})"><span aria-hidden="true">${s.glyph}</span>${esc(s.short)}</div>
           <div style="font:400 13px/20px var(--font-sans);color:var(--ink-muted);margin-top:6px">${esc(p.category)}${p.support > 0 ? ` · ${p.support} neighbours` : ""}</div></div>`,
        ).addTo(map);
      });
      map.on("mouseleave", "points", () => { map.getCanvas().style.cursor = ""; popup.remove(); });
      map.on("click", "points", (e: MapLayerMouseEvent) => {
        const tid = e.features?.[0]?.properties?.tracking_id;
        if (tid) cb.current.onSelectIssue?.(tid);
      });
      map.on("click", "loc-fill", (e: MapLayerMouseEvent) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["points", "clusters"] }).length) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) cb.current.onSelectLocality?.(id);
      });
      for (const l of ["clusters", "loc-fill"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
      setReady(true);
    };
    map.on("style.load", () => { if (map.getSource("issues")) return; setReady(false); setup(); });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("issues") as GeoJSONSource)?.setData(issues as any);
    (map.getSource("issues-raw") as GeoJSONSource)?.setData(issues as any);
  }, [issues, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (localities) (map.getSource("localities") as GeoJSONSource)?.setData(localities as any);
    const vis = showLocalities ? "visible" : "none";
    ["loc-fill", "loc-line", "loc-label"].forEach((l) => map.setLayoutProperty(l, "visibility", vis));
  }, [localities, showLocalities, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const heat = mode === "heatmap";
    map.setLayoutProperty("heat", "visibility", heat ? "visible" : "none");
    ["clusters", "cluster-count", "points"].forEach((l) => map.setLayoutProperty(l, "visibility", heat ? "none" : "visible"));
  }, [mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hotspots") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: (hotspots ?? []).map((h) => ({ type: "Feature", geometry: { type: "Point", coordinates: [h.lng, h.lat] }, properties: { total: h.total } })),
    } as any);
  }, [hotspots, ready]);

  useEffect(() => {
    if (flyTo && mapRef.current) mapRef.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? 15, speed: 1.4 });
  }, [flyTo]);

  return <div ref={el} className={className} role="region" aria-label="Map of reported issues" />;
}
