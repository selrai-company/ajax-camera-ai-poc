import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Skeleton } from "./components/ui";
import { PHONE_QUERY } from "./lib/hooks";
import WallPage from "./pages/WallPage";

const CameraPage = lazy(() => import("./pages/CameraPage"));
const IncidentsPage = lazy(() => import("./pages/IncidentsPage"));
const IncidentPage = lazy(() => import("./pages/IncidentPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const BriefPage = lazy(() => import("./pages/BriefPage"));
const PatrolsPage = lazy(() => import("./pages/PatrolsPage"));
const SitesPage = lazy(() => import("./pages/SitesPage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

/** `/`: the wall on desktop, the morning brief on phones. Keeps ?site= etc. */
function Home() {
  const phone = window.matchMedia(PHONE_QUERY).matches;
  return phone ? <Navigate to={{ pathname: "/brief", search: window.location.search }} replace /> : <WallPage />;
}

function PageFallback() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="wall" element={<WallPage />} />
        <Route
          path="*"
          element={
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="cameras/:cameraId" element={<CameraPage />} />
                <Route path="incidents" element={<IncidentsPage />} />
                <Route path="incidents/:id" element={<IncidentPage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="brief" element={<BriefPage />} />
                <Route path="patrols" element={<PatrolsPage />} />
                <Route path="sites" element={<SitesPage />} />
                <Route path="sites/all" element={<Navigate to="/portfolio" replace />} />
                <Route path="portfolio" element={<PortfolioPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
