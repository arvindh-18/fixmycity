import L from "leaflet";
import { useEffect, useMemo } from "react";
import { AttributionControl, Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import type { Issue } from "../lib/types";
import { STATUS } from "./ui";

export const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const iconCache = new Map<string, L.DivIcon>();
export function statusIcon(status: Issue["status"], active = false) {
  const key = status + active;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: "",
        html: `<div class="pin ${active ? "is-active" : ""}" style="background:${STATUS[status].color}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
      }),
    );
  }
  return iconCache.get(key)!;
}

export type Here = { lat: number; lng: number; accuracy: number };

const hereIcon = L.divIcon({ className: "", html: '<div class="here-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function FitTo({ issues, fallback, here }: { issues: Issue[]; fallback: [number, number]; here?: Here | null }) {
  const map = useMap();
  const key = issues.map((i) => i.id).join(",") + (here ? `@${here.lat},${here.lng}` : "");
  useEffect(() => {
    const pts: [number, number][] = issues.map((i) => [i.lat, i.lng]);
    if (here) pts.push([here.lat, here.lng]);
    if (!pts.length) return void map.setView(fallback, 12);
    if (pts.length === 1) return void map.setView(pts[0], 15);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** Pans to the highlighted marker when it's picked from a list. */
function PanTo({ issue }: { issue?: Issue }) {
  const map = useMap();
  useEffect(() => {
    if (issue && !map.getBounds().contains([issue.lat, issue.lng])) map.panTo([issue.lat, issue.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id]);
  return null;
}

function Resize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function IssueMap({
  issues, center, activeId, onHover, onSelect, here, className = "",
}: {
  issues: Issue[];
  center: [number, number];
  activeId?: number | null;
  onHover?: (id: number | null) => void;
  onSelect?: (id: number) => void;
  here?: Here | null;
  className?: string;
}) {
  const markers = useMemo(() => issues.filter((i) => i.lat && i.lng), [issues]);
  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom attributionControl={false} className={`map-soft h-full w-full ${className}`}>
      <AttributionControl prefix={false} />
      <TileLayer url={OSM_TILES} attribution={OSM_ATTR} maxZoom={19} />
      <FitTo issues={markers} fallback={center} here={here} />
      <PanTo issue={markers.find((i) => i.id === activeId)} />
      <Resize />
      {here && (
        <>
          <Circle center={[here.lat, here.lng]} radius={Math.min(here.accuracy, 500)}
            pathOptions={{ color: "#2B5BA8", weight: 1, fillOpacity: 0.08 }} />
          <Marker position={[here.lat, here.lng]} icon={hereIcon} zIndexOffset={3000} title="You are here" />
        </>
      )}
      {markers.map((i) => (
        <Marker
          key={i.id}
          position={[i.lat, i.lng]}
          icon={statusIcon(i.status, activeId === i.id)}
          zIndexOffset={activeId === i.id ? 1000 : 0}
          eventHandlers={{
            mouseover: () => onHover?.(i.id),
            mouseout: () => onHover?.(null),
            click: () => onSelect?.(i.id),
          }}
        >
          <Popup>
            <Link to={`/issues/${i.id}`} className="block min-w-44 !text-ink no-underline">
              <span className="block font-semibold leading-snug">{i.title}</span>
              <span className="block text-xs text-ink-3 mt-0.5">
                {STATUS[i.status].label} · {i.locality || i.pincode}
              </span>
            </Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/* ---- A single draggable pin for the report form ---------------------------- */
const pickIcon = L.divIcon({
  className: "",
  html: `<svg width="34" height="44" viewBox="0 0 34 44" style="filter:drop-shadow(0 3px 4px rgb(0 0 0 / .3))"><path d="M17 1C8.2 1 1 7.9 1 16.6 1 28.4 17 43 17 43s16-14.6 16-26.4C33 7.9 25.8 1 17 1z" fill="#2B5BA8" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="6" fill="#F2C230"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
});

function ClickToMove({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyTo({ pos }: { pos: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (map.distance(map.getCenter(), pos) > 60) map.flyTo(pos, Math.max(map.getZoom(), 16), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos[0], pos[1]]);
  return null;
}

export function PinPicker({
  pos, onChange, nearby = [],
}: {
  pos: [number, number];
  onChange: (lat: number, lng: number) => void;
  nearby?: Issue[];
}) {
  return (
    <MapContainer center={pos} zoom={16} scrollWheelZoom attributionControl={false} className="map-soft h-full w-full">
      <AttributionControl prefix={false} />
      <TileLayer url={OSM_TILES} attribution={OSM_ATTR} maxZoom={19} />
      <ClickToMove onPick={onChange} />
      <FlyTo pos={pos} />
      <Resize />
      {nearby.map((i) => (
        <Marker key={i.id} position={[i.lat, i.lng]} icon={statusIcon(i.status)} />
      ))}
      <Marker
        position={pos}
        icon={pickIcon}
        draggable
        zIndexOffset={2000}
        eventHandlers={{
          dragend: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            onChange(ll.lat, ll.lng);
          },
        }}
      />
    </MapContainer>
  );
}
