import { useEffect, useRef, useState, useCallback } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Receipt, Upload, Wallet, Tags, Sparkles, BarChart3, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { recleanAllTransactions } from "@/lib/recleanTransactions";

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

const SIDEBAR_WIDTH_KEY = "ledger.sidebarWidth";
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

export const AppLayout = () => {
  const qc = useQueryClient();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const draggingRef = useRef(false);

  useEffect(() => {
    const KEY = "ledger.lastReclean";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 5 * 60 * 1000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    recleanAllTransactions()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ["transactions"] }); })
      .catch(() => { /* silent */ });
  }, [qc]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);

  const onDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_WIDTH);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH));
  }, []);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside
        style={{ width: sidebarWidth }}
        className="shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen sticky top-0"
      >
        <div className="px-6 py-5 border-b border-sidebar-border">
          <h1 className="text-lg font-semibold text-sidebar-primary-foreground">
            <span className="text-sidebar-primary">●</span> Ledger
          </h1>
          <p className="text-xs text-sidebar-foreground/60 mt-1">Personal Finance · Phase 1</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-primary-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 text-[11px] text-sidebar-foreground/50 border-t border-sidebar-border">
          Single-user mode. Auth & bank sync coming in Phase 1.5.
        </div>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        title="Drag to resize · double-click to reset"
        className="w-1 cursor-col-resize bg-transparent hover:bg-sidebar-border active:bg-sidebar-primary/40 transition-colors"
      />
      <main className="flex-1 overflow-auto h-screen min-w-0">
        <Outlet />
      </main>
    </div>
  );
};
