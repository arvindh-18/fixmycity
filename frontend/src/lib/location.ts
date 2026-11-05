import { useCallback, useState } from "react";

export type MyLocation = { lat: number; lng: number; accuracy: number };

/** Asks the browser for the device location and explains every way it can fail. */
export function useMyLocation() {
  const [loc, setLoc] = useState<MyLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const locate = useCallback(() => {
    setError("");
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
  }, []);

  return { loc, locating, error, locate, clear: () => setLoc(null) };
}

export function formatDistance(m?: number) {
  if (m == null) return "";
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}
