import { MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Area } from "../lib/types";

export interface AreaPick {
  locality?: string;
  pincode?: string;
}

let areasCache: Promise<Area[]> | null = null;
export const loadAreas = (fresh = false) => {
  if (fresh || !areasCache) areasCache = api<Area[]>("/api/issues/areas").catch(() => []);
  return areasCache;
};

/** One box for "pincode or locality". Suggests areas that already have reports. */
export function AreaSearch({
  value, onPick, size = "md", placeholder = "Pincode or locality",
}: {
  value: AreaPick;
  onPick: (a: AreaPick) => void;
  size?: "md" | "lg";
  placeholder?: string;
}) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => void loadAreas().then(setAreas), []);
  useEffect(() => {
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    const list = t
      ? areas.filter((a) => a.pincode.startsWith(t) || a.locality.toLowerCase().includes(t))
      : areas;
    return list.slice(0, 7);
  }, [areas, text]);

  const current = value.locality || value.pincode ? [value.locality, value.pincode].filter(Boolean).join(", ") : "";

  function pick(a: AreaPick) {
    onPick(a);
    setText("");
    setOpen(false);
  }

  function submitFree() {
    const t = text.trim();
    if (!t) return;
    if (matches[hi] && open) return pick({ locality: matches[hi].locality, pincode: matches[hi].pincode });
    pick(/^\d{3,6}$/.test(t) ? { pincode: t } : { locality: t });
  }

  const big = size === "lg";
  return (
    <div ref={boxRef} className="relative w-full">
      {current ? (
        <div className={`flex items-center gap-2 rounded-full border border-ink bg-white pl-4 pr-1.5 ${big ? "h-14" : "h-11"}`}>
          <MapPin size={18} className="text-civic shrink-0" />
          <span className="font-semibold truncate">{current}</span>
          <button
            type="button"
            onClick={() => pick({})}
            className="ml-auto inline-flex size-8 items-center justify-center rounded-full hover:bg-chalk"
            aria-label="Clear area"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitFree();
          }}
          className={`flex items-center gap-2 rounded-full border border-line-2 bg-white pl-4 pr-1.5 focus-within:border-civic focus-within:ring-4 focus-within:ring-civic/15 ${big ? "h-14" : "h-11"}`}
        >
          <Search size={18} className="text-ink-3 shrink-0" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setHi(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, matches.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3 ${big ? "text-[17px]" : "text-[15px]"}`}
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-label="Search by pincode or locality"
            inputMode="search"
          />
          {big && (
            <button type="submit" className="btn-ink h-11 max-sm:hidden">
              Show reports
            </button>
          )}
        </form>
      )}

      {open && !current && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[1200] mt-2 w-full overflow-hidden rounded-2xl border border-line bg-white py-1.5 shadow-[var(--shadow-lift)]"
        >
          {matches.map((a, idx) => (
            <li key={a.locality + a.pincode} role="option" aria-selected={idx === hi}>
              <button
                type="button"
                onMouseEnter={() => setHi(idx)}
                onClick={() => pick({ locality: a.locality, pincode: a.pincode })}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${idx === hi ? "bg-chalk" : ""}`}
              >
                <MapPin size={16} className="text-ink-3" />
                <span className="font-medium">{a.locality || "Unnamed area"}</span>
                <span className="text-ink-3 tabular-nums">{a.pincode}</span>
                <span className="ml-auto text-sm text-ink-3">{a.active} active</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
