import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Receipt, Upload, Wallet, Tags, Sparkles, BarChart3, Inbox, ChevronsLeft, ChevronsRight } from "lucide-react";
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
const EXPANDED_WIDTH = 160;
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
            {/* Header */}
            <div className={cn("border-b border-sidebar-border", isCollapsed ? "px-2 py-5" : "px-6 py-5")}>
              {isCollapsed ? (
                <span className="text-sidebar-primary text-lg font-semibold block text-center">●</span>
              ) : (
                <>
                  <h1 className="text-lg font-semibold text-sidebar-primary-foreground whitespace-nowrap">
                    <span className="text-sidebar-primary">●</span> Ledger
                  </h1>
                  <p className="text-xs text-sidebar-foreground/60 mt-1 whitespace-nowrap">Personal Finance · Phase 1</p>
                </>
              )}
            </div>

            {/* Nav */}
            <nav className={cn("flex-1 py-4 space-y-1 overflow-y-auto", isCollapsed ? "px-1" : "px-3")}>
              {nav.map(({ to, label, icon: Icon, end }) => {
                const link = (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    aria-label={label}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-md text-sm transition-colors whitespace-nowrap",
                        isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-primary-foreground"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!isCollapsed && <span>{label}</span>}
                  </NavLink>
                );

                if (isCollapsed) {
                  return (
                    <Tooltip key={to}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
                    </Tooltip>
                  );
                }
                return link;
              })}
            </nav>

            {/* Footer with collapse toggle */}
            <div className={cn("border-t border-sidebar-border", isCollapsed ? "px-1 py-3" : "px-3 py-3")}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      "flex items-center rounded-md text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors w-full",
                      isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"
                    )}
                  >
                    {isCollapsed ? (
                      <ChevronsRight className="h-4 w-4 shrink-0" />
                    ) : (
                      <>
                        <ChevronsLeft className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">Collapse</span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                </TooltipContent>
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
