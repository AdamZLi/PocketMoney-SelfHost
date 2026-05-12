import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Receipt, Upload, Wallet, Tags, Sparkles, BarChart3, Inbox, ChevronsLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { recleanAllTransactions } from "@/lib/recleanTransactions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "Transactions", icon: Receipt },
  { to: "/trends", label: "Trends", icon: BarChart3 },
  { to: "/review", label: "Review", icon: Inbox },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/aliases", label: "Merchant Aliases", icon: Sparkles },
];

const COLLAPSE_KEY = "ledger.sidebarCollapsed";
const AUTO_COLLAPSE_THRESHOLD = 1280;
const EXPANDED_WIDTH = 200;
const COLLAPSED_WIDTH = 48;

type SidebarContextType = {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  snapshotAndCollapse: () => void;
  restoreSnapshot: () => void;
};

export const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
  setIsCollapsed: () => {},
  snapshotAndCollapse: () => {},
  restoreSnapshot: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

export const AppLayout = () => {
  const qc = useQueryClient();
  const manualPrefRef = useRef<boolean>(false);
  const snapshotRef = useRef<boolean | null>(null);

  const [isCollapsed, setIsCollapsedRaw] = useState<boolean>(() => {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    if (saved !== null) {
      manualPrefRef.current = true;
      return saved === "true";
    }
    return window.innerWidth < AUTO_COLLAPSE_THRESHOLD;
  });

  const setIsCollapsed = useCallback((collapsed: boolean) => {
    manualPrefRef.current = true;
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    setIsCollapsedRaw(collapsed);
  }, []);

  // Auto-collapse/expand based on viewport when no manual preference
  useEffect(() => {
    const onResize = () => {
      if (manualPrefRef.current) return;
      setIsCollapsedRaw(window.innerWidth < AUTO_COLLAPSE_THRESHOLD);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Snapshot sidebar state (for review panel auto-collapse)
  const snapshotAndCollapse = useCallback(() => {
    snapshotRef.current = isCollapsed;
    setIsCollapsedRaw(true);
  }, [isCollapsed]);

  const restoreSnapshot = useCallback(() => {
    if (snapshotRef.current !== null) {
      setIsCollapsedRaw(snapshotRef.current);
      snapshotRef.current = null;
    }
  }, []);

  useEffect(() => {
    const KEY = "ledger.lastReclean";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 5 * 60 * 1000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    recleanAllTransactions()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ["transactions"] }); })
      .catch(() => { /* silent */ });
  }, [qc]);

  const sidebarWidth = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  const sidebarCtx: SidebarContextType = {
    isCollapsed,
    setIsCollapsed,
    snapshotAndCollapse,
    restoreSnapshot,
  };

  return (
    <SidebarContext.Provider value={sidebarCtx}>
      <TooltipProvider delayDuration={300}>
        <div className="h-screen flex bg-background overflow-hidden">
          <aside
            style={{ width: sidebarWidth }}
            className="shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen sticky top-0 transition-[width] duration-200 ease-out motion-reduce:transition-none overflow-hidden"
          >
            {/* Header — always renders dot + text; text fades/collapses */}
            <div className="border-b border-sidebar-border flex items-center px-4 py-5 gap-2">
              <span className="text-sidebar-primary text-lg font-semibold shrink-0">●</span>
              <div className={cn(
                "min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 motion-reduce:transition-none",
                isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
              )}>
                <h1 className="text-lg font-semibold text-sidebar-primary-foreground whitespace-nowrap leading-tight">
                  Ledger
                </h1>
                <p className="text-xs text-sidebar-foreground/60 mt-0.5 whitespace-nowrap">Personal Finance · Phase 1</p>
              </div>
            </div>

            {/* Nav — always renders icon + label; label fades/collapses */}
            <nav className="flex-1 py-4 px-2 space-y-1 overflow-hidden">
              {nav.map(({ to, label, icon: Icon, end }) => {
                const link = (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    aria-label={label}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center h-9 px-2 gap-3 rounded-md text-sm transition-colors whitespace-nowrap",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-primary-foreground"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={cn(
                      "min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 motion-reduce:transition-none",
                      isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                    )}>
                      {label}
                    </span>
                  </NavLink>
                );

                return (
                  <Tooltip key={to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    {isCollapsed && (
                      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </nav>

            {/* Footer — always renders chevron + text; text fades/collapses */}
            <div className="border-t border-sidebar-border px-2 py-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    aria-expanded={!isCollapsed}
                    className="flex items-center h-9 px-2 gap-3 rounded-md text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors w-full whitespace-nowrap"
                  >
                    <ChevronsLeft className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                      isCollapsed && "rotate-180"
                    )} />
                    <span className={cn(
                      "min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 motion-reduce:transition-none",
                      isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                    )}>
                      Collapse
                    </span>
                  </button>
                </TooltipTrigger>
                {isCollapsed && (
                  <TooltipContent side="right" sideOffset={8}>Expand sidebar</TooltipContent>
                )}
              </Tooltip>
            </div>
          </aside>
          <main className="flex-1 overflow-auto h-screen min-w-0">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
};
