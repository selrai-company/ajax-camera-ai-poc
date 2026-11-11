import type {
  Brief,
  CameraEvent,
  HealthItem,
  Incident,
  IncidentDetail,
  Patrols,
  PortfolioSite,
  Rule,
  RulePreview,
  SearchResponse,
  Site,
  Wall,
} from "./contract";

/** Every backend call the app makes. The real client and the mock both implement this. */
export interface Api {
  getSites(): Promise<Site[]>;
  getPortfolio(night: string | null): Promise<PortfolioSite[]>;
  getWall(siteId: string, night: string): Promise<Wall>;
  getBrief(siteId: string, night: string): Promise<Brief>;
  getIncidents(siteId: string, night: string, status?: Incident["status"]): Promise<Incident[]>;
  getIncident(id: number): Promise<IncidentDetail>;
  setIncidentStatus(id: number, status: "handled" | "open"): Promise<Incident>;
  dismissEvent(id: number): Promise<CameraEvent>;
  getRulePreview(eventId: number): Promise<RulePreview>;
  createRule(eventId: number): Promise<Rule>;
  getRules(siteId: string): Promise<Rule[]>;
  deleteRule(id: number): Promise<{ ok: true }>;
  search(body: { site_id: string; night: string | null; q: string }): Promise<SearchResponse>;
  getPatrols(siteId: string, night: string): Promise<Patrols>;
  getHealth(siteId: string, night: string): Promise<HealthItem[]>;
}

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  // The backend rejects mutations without this header (blocks cross-site requests).
  if (method === "POST" || method === "DELETE") headers.set("X-Camai", "1");

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...init, method, headers });
  } catch {
    throw new ApiError(0, "Can't reach the camera service. Check your connection.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const q = (params: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
};
const enc = encodeURIComponent;

export const realApi: Api = {
  getSites: () => request("/sites"),
  getPortfolio: (night) => request(`/portfolio${q({ night })}`),
  getWall: (site, night) => request(`/sites/${enc(site)}/wall${q({ night })}`),
  getBrief: (site, night) => request(`/sites/${enc(site)}/brief${q({ night })}`),
  getIncidents: (site, night, status) => request(`/sites/${enc(site)}/incidents${q({ night, status })}`),
  getIncident: (id) => request(`/incidents/${id}`),
  setIncidentStatus: (id, status) =>
    request(`/incidents/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  dismissEvent: (id) => request(`/events/${id}/dismiss`, { method: "POST" }),
  getRulePreview: (eventId) => request(`/events/${eventId}/rule-preview`),
  createRule: (eventId) => request(`/rules`, { method: "POST", body: JSON.stringify({ event_id: eventId }) }),
  getRules: (site) => request(`/sites/${enc(site)}/rules`),
  deleteRule: (id) => request(`/rules/${id}`, { method: "DELETE" }),
  search: (body) => request(`/search`, { method: "POST", body: JSON.stringify(body) }),
  getPatrols: (site, night) => request(`/sites/${enc(site)}/patrols${q({ night })}`),
  getHealth: (site, night) => request(`/sites/${enc(site)}/health${q({ night })}`),
};

export const evidencePackUrl = (incidentId: number) => `${API_BASE}/incidents/${incidentId}/evidence.pdf`;
