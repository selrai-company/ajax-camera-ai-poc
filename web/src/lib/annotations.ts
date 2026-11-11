import { useSyncExternalStore } from "react";

/** Shared on/off switch for on-video annotations (motion boxes + labels). Persisted. */
const KEY = "camai.annotations";
let value = (() => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
})();
const subs = new Set<() => void>();

export function setAnnotations(v: boolean) {
  value = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export function useAnnotations(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => value,
    () => true,
  );
  return [v, setAnnotations];
}
