import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// jsdom lacks these browser APIs used by components.
if (!window.matchMedia) {
  window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as any;
}
if (!("ResizeObserver" in window)) {
  (window as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!("IntersectionObserver" in window)) {
  (window as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
}
URL.createObjectURL = URL.createObjectURL ?? (() => "blob:preview");
URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {});
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
