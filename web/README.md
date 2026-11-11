# Web app

React reference app for the camera AI layer (Vite, React 19, TypeScript, Tailwind v4, TanStack Query).
The API contract is `src/api/types.ts` (plus v1.1 fields in `src/api/contract.ts`).

```bash
npm install
npm run dev                 # proxies /api and /media to the camai service on :8000
VITE_API_MOCK=1 npm run dev # mock data, no backend needed
npm run build               # typecheck, then build into ../src/camai/static/app (served by camai serve)
```
