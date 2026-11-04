import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

export const fmtDate = (s?: string | null) => (s ? dateFmt.format(new Date(s)) : "—");
export const fmtDateTime = (s?: string | null) => (s ? dateTimeFmt.format(new Date(s)) : "—");
export const fmtTime = (s?: string | null) => (s ? timeFmt.format(new Date(s)) : "");

export function ago(s?: string | null): string {
  if (!s) return "—";
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return fmtDate(s);
}

export function duration(hours?: number | null): string {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  const d = hours / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

export function countdown(seconds: number): string {
  const abs = Math.abs(seconds);
  const d = Math.floor(abs / 86400), h = Math.floor((abs % 86400) / 3600), m = Math.floor((abs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const pct = (v?: number | null) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const money = (v?: number | null) => (v === null || v === undefined ? "Not recorded" : inr.format(v));

export const metres = (m?: number) => (m === undefined ? "" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
