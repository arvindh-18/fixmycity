import { useCallback, useState } from "react";
import { useAuth } from "./auth";
import type { AppConfig } from "./types";

const REAL_GPS_KEY = "fmc_demo_real_gps";

/** Demo builds pretend you're standing at the demo location, unless you switch to real GPS. */
export function demoLocation(config: AppConfig | null): MyLocation | null {
  if (!config?.demo) return null;
  try {
    if (localStorage.getItem(REAL_GPS_KEY) === "1") return null;
  } catch {
    /* ignore */
  }
  return { lat: config.demo.location.lat, lng: config.demo.location.lng, accuracy: 40 };
}

export function setDemoRealGps(on: boolean) {
  try {
    if (on) localStorage.setItem(REAL_GPS_KEY, "1");
    else localStorage.removeItem(REAL_GPS_KEY);
  } catch {
    /* ignore */
  }
}

export type MyLocation = { lat: number; lng: number; accuracy: number };

/** Asks the browser for the device location and explains every way it can fail. */
export function useMyLocation() {
  const { config } = useAuth();
  const [loc, setLoc] = useState<MyLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const locate = useCallback(() => {
    setError("");
    const fake = demoLocation(config);
    if (fake) {
      setLocating(true);
      setTimeout(() => (setLoc(fake), setLocating(false)), 350);
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("This browser can't share your location. Search for your area instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setLocating(false);
      },
      (e) => {
        setLocating(false);
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Location is blocked. Allow it in your browser's address bar, then try again."
            : e.code === e.TIMEOUT
              ? "Finding your location took too long. Try again, ideally near a window or outdoors."
              : "Couldn't find your location. Showing the city centre instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [config]);

  return { loc, locating, error, locate, clear: () => setLoc(null) };
}

export function formatDistance(m?: number) {
  if (m == null) return "";
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}
