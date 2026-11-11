import { realApi, type Api } from "./client";

/** Set VITE_API_MOCK=1 to run against built-in mock data instead of the backend. */
export const USE_MOCK = import.meta.env.VITE_API_MOCK === "1";

/** Loads the mock module on first use, so it's never part of a production bundle. */
function lazyMock(): Api {
  let loaded: Promise<Api> | null = null;
  const load = () => (loaded ??= import("./mock").then((m) => m.mockApi));
  return new Proxy({} as Api, {
    get: (_t, key: string) =>
      (...args: unknown[]) =>
        load().then((api) => (api[key as keyof Api] as (...a: unknown[]) => Promise<unknown>)(...args)),
  });
}

// The condition is replaced at build time, so the mock branch (and its import) is dropped when unset.
export const api: Api = import.meta.env.VITE_API_MOCK === "1" ? lazyMock() : realApi;

export { ApiError, evidencePackUrl } from "./client";
export type { Api } from "./client";
