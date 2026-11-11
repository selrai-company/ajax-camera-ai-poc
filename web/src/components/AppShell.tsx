import clsx from "clsx";
import {
  Building2,
  Ellipsis,
  Footprints,
  LayoutGrid,
  Layers,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sunrise,
  Video,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useWall } from "../api/hooks";
import { USE_MOCK } from "../api";
import { useHotkeys, useMediaQuery } from "../lib/hooks";
import { useSite } from "../lib/site";
import { Kbd } from "./ui";
import { NightSelect } from "./NightSelect";
import { SiteSwitcher } from "./SiteSwitcher";

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: ComponentType<{ className?: string }>;
  guardedOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/wall", label: "Live wall", short: "Cameras", icon: LayoutGrid },
  { to: "/incidents", label: "Incidents", icon: ShieldAlert },
  { to: "/search", label: "Search", icon: Search },
  { to: "/brief", label: "Morning brief", short: "Brief", icon: Sunrise },
  { to: "/patrols", label: "Patrols", icon: Footprints, guardedOnly: true },
  { to: "/sites", label: "Sites & rules", icon: SlidersHorizontal },
];

const NIGHT_ROUTES = ["/wall", "/cameras", "/incidents", "/brief", "/patrols", "/sites", "/search"];

function useOpenCount() {
  const { site, night } = useSite();
  const wall = useWall(site?.id, night);
  return wall.data?.incidents.filter((i) => i.status === "open" && i.severity === "needs_look").length ?? 0;
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Camai home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-raised ring-1 ring-line-strong">
        <Video className="size-4 text-fg" aria-hidden />
      </span>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">Camai</span>}
    </Link>
  );
}

function Sidebar() {
  const { site } = useSite();
  const open = useOpenCount();
  const items = NAV.filter((n) => !n.guardedOnly || site?.guarded);
  return (
    <aside
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col border-r border-line bg-surface md:flex sb-full:w-[var(--sidebar-w)]"
    >
      <div className="flex h-[var(--topbar-h)] items-center px-5 sb-full:px-5">
        <span className="sb-full:hidden">
          <Logo compact />
        </span>
        <span className="hidden sb-full:block">
          <Logo />
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        <NavLink
          to="/portfolio"
          className={({ isActive }) =>
            clsx(
              "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors sb-mini:justify-center sb-mini:px-0",
              isActive ? "bg-raised font-semibold text-fg" : "text-muted hover:bg-raised/60 hover:text-fg",
            )
          }
          title="All sites"
        >
          <Layers className="size-[18px] shrink-0" aria-hidden />
          <span className="sb-mini:sr-only">All sites</span>
        </NavLink>

        <div className="my-3 hidden sb-full:block">
          <p className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-faint uppercase">Site</p>
          <SiteSwitcher />
        </div>
        <div className="my-2 h-px bg-line sb-full:hidden" aria-hidden />

        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              clsx(
                "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors sb-mini:justify-center sb-mini:px-0",
                isActive ? "bg-raised font-semibold text-fg" : "text-muted hover:bg-raised/60 hover:text-fg",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-fg" aria-hidden />}
                <item.icon className="size-[18px] shrink-0" aria-hidden />
                <span className="flex-1 sb-mini:sr-only">{item.label}</span>
                {item.to === "/incidents" && open > 0 && (
                  <span
                    className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-sev-red px-1.5 text-[11px] font-semibold text-white sb-mini:absolute sb-mini:top-0.5 sb-mini:right-1"
                    aria-label={`${open} open`}
                  >
                    {open}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="hidden border-t border-line px-5 py-4 text-xs text-faint sb-full:block">
        <p className="mb-2 font-medium text-muted">Shortcuts</p>
        <ul className="space-y-1.5">
          <li className="flex items-center justify-between">
            Search <Kbd>/</Kbd>
          </li>
          <li className="flex items-center justify-between">
            Focus camera <span className="flex gap-1"><Kbd>1</Kbd>–<Kbd>9</Kbd></span>
          </li>
          <li className="flex items-center justify-between">
            Back to wall <Kbd>Esc</Kbd>
          </li>
        </ul>
        {USE_MOCK && <p className="mt-3 text-[11px]">Sample data</p>}
      </div>
    </aside>
  );
}

function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const loc = useLocation();
  const [value, setValue] = useState(loc.pathname === "/search" ? (params.get("q") ?? "") : "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loc.pathname === "/search") setValue(params.get("q") ?? "");
  }, [loc.pathname, params]);

  useHotkeys(
    (e) => {
      if (e.key === "/") {
        e.preventDefault();
        ref.current?.focus();
      }
    },
    [],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form role="search" onSubmit={submit} className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask about last night, e.g. people near the container after 10pm"
        aria-label="Search recorded events in plain English"
        className="h-10 w-full rounded-lg border border-line bg-raised pr-10 pl-9 text-sm text-fg placeholder:text-faint hover:border-line-strong focus:border-line-strong focus:outline-none focus-visible:outline-2 focus-visible:outline-focus"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
        <Kbd>/</Kbd>
      </span>
    </form>
  );
}

function TopBar() {
  const loc = useLocation();
  const showNight = NIGHT_ROUTES.some((r) => loc.pathname.startsWith(r)) || loc.pathname === "/";
  return (
    <header className="sticky top-0 z-30 hidden h-[var(--topbar-h)] shrink-0 items-center gap-4 border-b border-line bg-canvas/90 px-6 backdrop-blur md:flex">
      <SiteSwitcher compact className="w-64 sb-full:hidden" />
      <GlobalSearch className="max-w-xl flex-1" />
      <div className="ml-auto flex items-center gap-2">{showNight && <NightSelect />}</div>
    </header>
  );
}

function MobileHeader() {
  const loc = useLocation();
  const onSearch = loc.pathname === "/search";
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur md:hidden">
      <SiteSwitcher compact className="min-w-0 flex-1" />
      {!onSearch && (
        <Link to="/search" aria-label="Search" className="flex size-11 items-center justify-center rounded-lg text-muted hover:text-fg">
          <Search className="size-5" aria-hidden />
        </Link>
      )}
    </header>
  );
}

function BottomTabs() {
  const { site } = useSite();
  const open = useOpenCount();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const tabs = [
    { to: "/brief", label: "Brief", icon: Sunrise },
    { to: "/wall", label: "Cameras", icon: LayoutGrid },
    { to: "/search", label: "Search", icon: Search },
    { to: "/incidents", label: "Incidents", icon: ShieldAlert },
  ];
  const moreActive = ["/patrols", "/sites", "/portfolio"].some((p) => loc.pathname.startsWith(p));
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid h-[var(--tabbar-h)] grid-cols-5">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  clsx(
                    "relative flex h-full flex-col items-center justify-center gap-1 text-[11px]",
                    isActive || (t.to === "/wall" && loc.pathname.startsWith("/cameras")) ? "font-semibold text-fg" : "text-faint",
                  )
                }
              >
                <span className="relative">
                  <t.icon className="size-[22px]" aria-hidden />
                  {t.to === "/incidents" && open > 0 && (
                    <span className="tnum absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sev-red px-1 text-[10px] font-semibold text-white">
                      {open}
                    </span>
                  )}
                </span>
                {t.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              aria-expanded={more}
              className={clsx("flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]", moreActive ? "font-semibold text-fg" : "text-faint")}
            >
              <Ellipsis className="size-[22px]" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button className="absolute inset-0 animate-fade-in bg-black/60" aria-label="Close menu" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 animate-slide-in rounded-t-2xl border-t border-line-strong bg-overlay p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-sm font-semibold">More</p>
              <button onClick={() => setMore(false)} aria-label="Close" className="flex size-10 items-center justify-center rounded-lg text-muted">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="space-y-1">
              {site?.guarded && <MoreLink to="/patrols" icon={Footprints} label="Patrols" hint="Guard checkpoint coverage" />}
              <MoreLink to="/sites" icon={SlidersHorizontal} label="Sites & rules" hint="Cameras, zones, rules, health" />
              <MoreLink to="/portfolio" icon={Building2} label="All sites" hint="Which site needs you first" />
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function MoreLink({ to, icon: Icon, label, hint }: { to: string; icon: ComponentType<{ className?: string }>; label: string; hint: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-raised">
        <span className="flex size-10 items-center justify-center rounded-lg bg-raised text-muted">
          <Icon className="size-5" />
        </span>
        <span>
          <span className="block text-[15px] text-fg">{label}</span>
          <span className="block text-xs text-faint">{hint}</span>
        </span>
      </Link>
    </li>
  );
}

export function AppShell() {
  const loc = useLocation();
  const wide = useMediaQuery("(min-width: 1280px)");
  const huge = useMediaQuery("(min-width: 1600px)");
  const onWall = loc.pathname === "/" || loc.pathname === "/wall" || loc.pathname.startsWith("/cameras/");
  // The wall gets the room: icon-only sidebar unless the screen is very wide.
  const mode = wide && (!onWall || huge) ? "full" : "mini";
  return (
    <div className="flex min-h-dvh" data-sidebar={mode}>
      <a
        href="#main"
        className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-lg bg-fg px-3 py-2 text-sm font-semibold text-canvas focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileHeader />
        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] outline-none md:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}

export { NAV };
