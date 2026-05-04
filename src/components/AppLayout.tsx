import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Receipt, Upload, Wallet, Tags, Sparkles, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { recleanAllTransactions } from "@/lib/recleanTransactions";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "Transactions", icon: Receipt },
  { to: "/trends", label: "Trends", icon: BarChart3 },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/aliases", label: "Merchant Aliases", icon: Sparkles },
];

export const AppLayout = () => {
  const qc = useQueryClient();
  useEffect(() => {
    // Auto-clean any existing transactions whose name doesn't yet match the current
    // alias rules. Runs once per session so newly added rules / pre-alias imports
    // get refreshed without requiring a manual re-import.
    const KEY = "ledger.lastReclean";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 5 * 60 * 1000) return; // throttle to 5 min/session
    sessionStorage.setItem(KEY, String(Date.now()));
    recleanAllTransactions()
      .then(n => { if (n > 0) qc.invalidateQueries({ queryKey: ["transactions"] }); })
      .catch(() => { /* silent */ });
  }, [qc]);
  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen sticky top-0">
        <div className="px-6 py-5 border-b border-sidebar-border">
          <h1 className="text-lg font-semibold text-sidebar-primary-foreground">
            <span className="text-sidebar-primary">●</span> Ledger
          </h1>
          <p className="text-xs text-sidebar-foreground/60 mt-1">Personal Finance · Phase 1</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-primary-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 text-[11px] text-sidebar-foreground/50 border-t border-sidebar-border">
          Single-user mode. Auth & bank sync coming in Phase 1.5.
        </div>
      </aside>
      <main className="flex-1 overflow-auto h-screen">
        <Outlet />
      </main>
    </div>
  );
};
