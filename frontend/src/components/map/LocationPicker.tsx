import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, Marker, MapMouseEvent } from "maplibre-gl";
import { Crosshair, Search } from "lucide-react";
import { RASTER_FALLBACK, VECTOR_STYLE } from "./mapStyle";
import { Button, Input } from "@/components/ui";

/**
 * Map for confirming exactly where a problem is. Citizens can drag the pin, tap the map,
 * use their GPS position, or search for a place (OpenStreetMap Nominatim).
 */
export function LocationPicker({ value, onChange, center }: {
  value: { lat: number; lng: number } | null;
  onChange: (v: { lat: number; lng: number; label?: string }) => void;
  center: { lat: number; lng: number };
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const start = value ?? center;
    const m = new maplibregl.Map({ container: el.current, style: VECTOR_STYLE, center: [start.lng, start.lat], zoom: value ? 16 : 12 });
    let fell = false;
    m.on("error", () => { if (!fell && !m.isStyleLoaded()) { fell = true; m.setStyle(RASTER_FALLBACK); } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const pin = document.createElement("div");
    pin.innerHTML = `<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8 1 16.6 1 28 17 43 17 43s16-15 16-26.4C33 8 25.8 1 17 1z" fill="#2f6b41" stroke="#1d1d1b" stroke-width="1.5"/><circle cx="17" cy="16.5" r="6" fill="#fff"/></svg>`;
    marker.current = new maplibregl.Marker({ element: pin, draggable: true, anchor: "bottom" }).setLngLat([start.lng, start.lat]).addTo(m);
    marker.current!.on("dragend", () => { const p = marker.current!.getLngLat(); cb.current({ lat: p.lat, lng: p.lng }); });
    m.on("click", (e: MapMouseEvent) => { marker.current!.setLngLat(e.lngLat); cb.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    map.current = m;
    if (!value) cb.current({ lat: start.lat, lng: start.lng });
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (lat: number, lng: number, label?: string) => {
    marker.current?.setLngLat([lng, lat]);
    map.current?.flyTo({ center: [lng, lat], zoom: 16.5 });
    onChange({ lat, lng, label });
  };

  const useGps = () => {
    if (!navigator.geolocation) { setGeoError("Your browser doesn't share location. Drag the pin instead."); return; }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); moveTo(pos.coords.latitude, pos.coords.longitude); },
      () => { setLocating(false); setGeoError("Location permission was denied. Drag the pin or search instead."); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 3) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}&viewbox=${center.lng - 0.4},${center.lat + 0.4},${center.lng + 0.4},${center.lat - 0.4}&bounded=1`);
      setResults(await r.json());
    } catch { setResults([]); }
  };

  return (
    <div className="overflow-hidden  border border-line-2">
      <div className="flex flex-wrap gap-2 border-b border-line bg-paper/60 p-2">
        <form onSubmit={search} className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a street or landmark" className="h-9 pl-9" aria-label="Search location" />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface ">
              {results.map((r) => (
                <li key={r.lat + r.lon}>
                  <button type="button" className="w-full px-3 py-2 text-left t-body-sm hover:bg-paper"
                    onClick={() => { moveTo(+r.lat, +r.lon, r.display_name); setResults([]); setQ(r.display_name.split(",")[0]); }}>
                    {r.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <Button type="button" variant="secondary" size="sm" className="h-9" onClick={useGps} loading={locating} icon={<Crosshair className="size-4" />}>Use my location</Button>
      </div>
      <div ref={el} className="h-72 w-full sm:h-80" />
      {geoError && <p className="border-t border-line bg-raised px-3 py-2 t-body-sm text-amber">{geoError}</p>}
    </div>
  );
}
