import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { Site } from "../api/contract";
import { useSites } from "../api/hooks";
import { useStoredState } from "./hooks";

interface SiteCtx {
  sites: Site[];
  site: Site | undefined;
  night: string | undefined;
  setSite: (id: string) => void;
  setNight: (night: string) => void;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const Ctx = createContext<SiteCtx | null>(null);

/** Current site and night. Taken from ?site= / ?night= when present, else the last choice (localStorage). */
export function SiteProvider({ children }: { children: ReactNode }) {
  const q = useSites();
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = useStoredState<string | null>("camai.site", null);
  const urlSite = params.get("site");
  const urlNight = params.get("night");
  const [siteId, setSiteId] = useState<string | null>(urlSite ?? stored);
  const [nightSel, setNightSel] = useState<string | null>(urlNight);

  useEffect(() => {
    if (urlSite && urlSite !== siteId) {
      setSiteId(urlSite);
      setStored(urlSite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSite]);
  useEffect(() => {
    if (urlNight && urlNight !== nightSel) setNightSel(urlNight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlNight]);

  const sites = useMemo(() => q.data ?? [], [q.data]);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const night = site ? (nightSel && site.nights.includes(nightSel) ? nightSel : site.default_night) : undefined;

  const setSite = useCallback(
    (id: string) => {
      setSiteId(id);
      setStored(id);
      setNightSel(null);
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (n.has("site")) n.set("site", id);
          n.delete("night");
          return n;
        },
        { replace: true },
      );
    },
    [setParams, setStored],
  );

  const setNight = useCallback(
    (n: string) => {
      setNightSel(n);
      setParams(
        (p) => {
          const x = new URLSearchParams(p);
          if (x.has("night")) x.set("night", n);
          return x;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const value = useMemo<SiteCtx>(
    () => ({ sites, site, night, setSite, setNight, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() }),
    [sites, site, night, setSite, setNight, q],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSite() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSite outside SiteProvider");
  return c;
}
