import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { Incident } from "./contract";

export const keys = {
  sites: ["sites"] as const,
  portfolio: (night: string | null) => ["portfolio", night] as const,
  wall: (site: string, night: string) => ["wall", site, night] as const,
  brief: (site: string, night: string) => ["brief", site, night] as const,
  incidents: (site: string, night: string, status?: string) => ["incidents", site, night, status ?? "all"] as const,
  incident: (id: number) => ["incident", id] as const,
  rulePreview: (eventId: number) => ["rule-preview", eventId] as const,
  rules: (site: string) => ["rules", site] as const,
  search: (site: string, night: string | null, q: string) => ["search", site, night, q] as const,
  patrols: (site: string, night: string) => ["patrols", site, night] as const,
  health: (site: string, night: string) => ["health", site, night] as const,
};

const ready = (...v: (string | null | undefined)[]) => v.every(Boolean);

export const useSites = () => useQuery({ queryKey: keys.sites, queryFn: api.getSites, staleTime: 5 * 60_000 });

export const usePortfolio = (night: string | null) =>
  useQuery({ queryKey: keys.portfolio(night), queryFn: () => api.getPortfolio(night) });

export const useWall = (site?: string, night?: string) =>
  useQuery({
    queryKey: keys.wall(site ?? "", night ?? ""),
    queryFn: () => api.getWall(site!, night!),
    enabled: ready(site, night),
    placeholderData: keepPreviousData,
  });

export const useBrief = (site?: string, night?: string) =>
  useQuery({ queryKey: keys.brief(site ?? "", night ?? ""), queryFn: () => api.getBrief(site!, night!), enabled: ready(site, night) });

export const useIncidents = (site?: string, night?: string, status?: Incident["status"]) =>
  useQuery({
    queryKey: keys.incidents(site ?? "", night ?? "", status),
    queryFn: () => api.getIncidents(site!, night!, status),
    enabled: ready(site, night),
  });

export const useIncident = (id: number) =>
  useQuery({ queryKey: keys.incident(id), queryFn: () => api.getIncident(id), enabled: Number.isFinite(id) });

export const useRulePreview = (eventId: number | null) =>
  useQuery({
    queryKey: keys.rulePreview(eventId ?? -1),
    queryFn: () => api.getRulePreview(eventId!),
    enabled: eventId != null,
    staleTime: 0,
  });

export const useRules = (site?: string) =>
  useQuery({ queryKey: keys.rules(site ?? ""), queryFn: () => api.getRules(site!), enabled: ready(site) });

export const useSearch = (site: string | undefined, night: string | null, q: string) =>
  useQuery({
    queryKey: keys.search(site ?? "", night, q),
    queryFn: () => api.search({ site_id: site!, night, q }),
    enabled: ready(site) && q.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });

export const usePatrols = (site?: string, night?: string, enabled = true) =>
  useQuery({
    queryKey: keys.patrols(site ?? "", night ?? ""),
    queryFn: () => api.getPatrols(site!, night!),
    enabled: enabled && ready(site, night),
  });

export const useHealth = (site?: string, night?: string) =>
  useQuery({ queryKey: keys.health(site ?? "", night ?? ""), queryFn: () => api.getHealth(site!, night!), enabled: ready(site, night) });

/** After any change, refresh everything derived from events and incidents. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["wall", "brief", "incidents", "incident", "rules", "rule-preview", "portfolio", "search", "patrols"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export function useSetIncidentStatus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "handled" | "open" }) => api.setIncidentStatus(id, status),
    onSuccess: invalidate,
  });
}

export function useDismissEvents() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (ids: number[]) => Promise.all(ids.map((id) => api.dismissEvent(id))),
    onSuccess: invalidate,
  });
}

export function useCreateRule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (eventId: number) => api.createRule(eventId), onSuccess: invalidate });
}

export function useDeleteRule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: number) => api.deleteRule(id), onSuccess: invalidate });
}
