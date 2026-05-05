import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Repeat, AlertCircle, CalendarClock, Users, EyeOff, Check, Split, Plus, Trash2 } from "lucide-react";
import { Treatment, TreatmentMeta, SplitPart, previewAmortization, treatmentLabel } from "@/lib/treatments";
import { OwedByCombobox } from "@/components/OwedByCombobox";
import { cn } from "@/lib/utils";

type Props = {
  treatment: Treatment;
  meta: TreatmentMeta;
  amount: number;
  date: string;
  onSave: (treatment: Treatment, meta: TreatmentMeta) => void | Promise<void>;
  className?: string;
  size?: "sm" | "xs";
};

const OPTIONS: { value: Treatment; label: string; desc: string; icon: any }[] = [
  { value: "normal", label: "Normal", desc: "Counts in trends as usual", icon: Check },
  { value: "excluded", label: "Excluded", desc: "Hide from trends entirely", icon: EyeOff },
  { value: "refundable", label: "Refundable", desc: "Money you expect back", icon: AlertCircle },
  { value: "reimbursable", label: "Split / reimbursable", desc: "Someone owes you part", icon: Users },
  { value: "amortized", label: "Amortize", desc: "Spread across months", icon: CalendarClock },
  { value: "split", label: "Split into parts", desc: "Mix multiple treatments on one charge", icon: Split },
];

function defaultPart(amount: number): SplitPart {
  return { amount: Math.abs(amount), treatment: "normal", meta: {} };
}

export function TreatmentPicker({ treatment, meta, amount, date, onSave, className, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Treatment>(treatment);
  const [draftMeta, setDraftMeta] = useState<TreatmentMeta>(meta ?? {});

  useEffect(() => {
    if (open) {
      setDraft(treatment);
      setDraftMeta(meta ?? {});
    }
  }, [open, treatment, meta]);

  const label = treatmentLabel({ treatment, treatment_meta: meta, amount, date }) ?? "Normal";
  const isNormal = treatment === "normal";

  async function handleSave() {
    const cleanMeta: TreatmentMeta = {};
    if (draft === "refundable") {
      cleanMeta.expected_refund_date = draftMeta.expected_refund_date || null;
      cleanMeta.refund_status = draftMeta.refund_status ?? "pending";
    } else if (draft === "reimbursable") {
      cleanMeta.your_share =
        typeof draftMeta.your_share === "number" && !isNaN(draftMeta.your_share)
          ? draftMeta.your_share
          : Math.abs(amount) / 2;
      cleanMeta.owed_by = draftMeta.owed_by || "";
      cleanMeta.reimbursement_status = draftMeta.reimbursement_status ?? "pending";
    } else if (draft === "amortized") {
      const mode = draftMeta.amort_mode ?? "calendar_year";
      cleanMeta.amort_mode = mode;
      if (mode === "calendar_year") {
        cleanMeta.months = 12;
        cleanMeta.start_date = `${date.slice(0, 4)}-01`;
      } else {
        cleanMeta.months = Math.max(1, Math.floor(draftMeta.months ?? 12));
        cleanMeta.start_date = (draftMeta.start_date || date).slice(0, 7);
      }
    } else if (draft === "excluded") {
      if (draftMeta.reason) cleanMeta.reason = draftMeta.reason;
    } else if (draft === "split") {
      const total = Math.abs(amount);
      const rawParts = (draftMeta.parts ?? []).filter((p) => Number(p.amount) > 0);
      const parts: SplitPart[] = rawParts.map((p) => {
        const partMeta: TreatmentMeta = {};
        const m = p.meta ?? {};
        if (p.treatment === "refundable") {
          partMeta.expected_refund_date = m.expected_refund_date || null;
          partMeta.refund_status = m.refund_status ?? "pending";
        } else if (p.treatment === "reimbursable") {
          partMeta.your_share =
            typeof m.your_share === "number" && !isNaN(m.your_share)
              ? m.your_share
              : Math.abs(p.amount) / 2;
          partMeta.owed_by = m.owed_by || "";
          partMeta.reimbursement_status = m.reimbursement_status ?? "pending";
        } else if (p.treatment === "amortized") {
          const mode = m.amort_mode ?? "calendar_year";
          partMeta.amort_mode = mode;
          if (mode === "calendar_year") {
            partMeta.months = 12;
            partMeta.start_date = `${date.slice(0, 4)}-01`;
          } else {
            partMeta.months = Math.max(1, Math.floor(m.months ?? 12));
            partMeta.start_date = (m.start_date || date).slice(0, 7);
          }
        } else if (p.treatment === "excluded") {
          if (m.reason) partMeta.reason = m.reason;
        }
        return { label: p.label?.trim() || undefined, amount: Math.abs(p.amount), treatment: p.treatment, meta: partMeta };
      });
      if (parts.length < 2) {
        // Need at least 2 parts; fall back to normal
        await onSave("normal", {});
        setOpen(false);
        return;
      }
      cleanMeta.parts = parts;
    }
    await onSave(draft, cleanMeta);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            isNormal
              ? "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            size === "xs" ? "h-5" : "h-6",
            className,
          )}
        >
          <span className="truncate max-w-[140px]">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col overflow-hidden p-0"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <div className="space-y-1.5 mb-3">
            {OPTIONS.map((o) => {
              const Icon = o.icon;
              const active = draft === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setDraft(o.value)}
                  className={cn(
                    "w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent" : "hover:bg-muted/60",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{o.label}</div>
                    <div className="text-[11px] text-muted-foreground">{o.desc}</div>
                  </div>
                  {active && <Check className="h-3.5 w-3.5 mt-1 text-foreground" />}
                </button>
              );
            })}
          </div>

        {draft === "refundable" && (
          <div className="space-y-2 border-t pt-3">
            <div>
              <Label className="text-xs text-muted-foreground">Expected refund date (optional)</Label>
              <Input
                type="date"
                value={draftMeta.expected_refund_date ?? ""}
                onChange={(e) => setDraftMeta({ ...draftMeta, expected_refund_date: e.target.value })}
                className="h-8 mt-1"
              />
            </div>
          </div>
        )}

        {draft === "reimbursable" && (
          <div className="space-y-2 border-t pt-3">
            <div>
              <Label className="text-xs text-muted-foreground">Your share</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  step="0.01"
                  value={
                    typeof draftMeta.your_share === "number"
                      ? draftMeta.your_share
                      : Math.abs(amount) / 2
                  }
                  onChange={(e) =>
                    setDraftMeta({ ...draftMeta, your_share: parseFloat(e.target.value) })
                  }
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDraftMeta({ ...draftMeta, your_share: Math.abs(amount) / 2 })}
                >
                  Half
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Total {Math.abs(amount).toFixed(2)} · Others owe{" "}
                {Math.max(0, Math.abs(amount) - (draftMeta.your_share ?? Math.abs(amount) / 2)).toFixed(2)}
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Owed by (name)</Label>
              <div className="mt-1">
                <OwedByCombobox
                  value={draftMeta.owed_by ?? ""}
                  onChange={(v) => setDraftMeta({ ...draftMeta, owed_by: v })}
                />
              </div>
            </div>
          </div>
        )}

        {draft === "amortized" && (() => {
          const mode = draftMeta.amort_mode ?? "calendar_year";
          const year = date.slice(0, 4);
          return (
            <div className="space-y-2 border-t pt-3">
              <div className="flex gap-1 rounded-md bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setDraftMeta({ ...draftMeta, amort_mode: "calendar_year" })}
                  className={cn(
                    "flex-1 text-xs py-1 rounded",
                    mode === "calendar_year" ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  Calendar year ({year})
                </button>
                <button
                  type="button"
                  onClick={() => setDraftMeta({ ...draftMeta, amort_mode: "custom" })}
                  className={cn(
                    "flex-1 text-xs py-1 rounded",
                    mode === "custom" ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  Custom
                </button>
              </div>

              {mode === "calendar_year" ? (
                <p className="text-[11px] text-muted-foreground">
                  Spreads ${Math.abs(amount).toFixed(2)} evenly across Jan–Dec {year}
                  {" "}(≈ ${(Math.abs(amount) / 12).toFixed(2)}/mo, both backward and forward).
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Months</Label>
                      <Input
                        type="number"
                        min={1}
                        value={draftMeta.months ?? 12}
                        onChange={(e) => setDraftMeta({ ...draftMeta, months: parseInt(e.target.value) || 12 })}
                        className="h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Start month</Label>
                      <Input
                        type="month"
                        value={(draftMeta.start_date ?? date).slice(0, 7)}
                        onChange={(e) => setDraftMeta({ ...draftMeta, start_date: e.target.value })}
                        className="h-8 mt-1"
                      />
                    </div>
                  </div>
                  {(() => {
                    const p = previewAmortization(
                      amount,
                      draftMeta.months ?? 12,
                      (draftMeta.start_date ?? date).slice(0, 7),
                    );
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        ≈ ${p.per.toFixed(2)}/mo · {p.start} → {p.end}
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })()}

        {draft === "excluded" && (
          <div className="space-y-2 border-t pt-3">
            <div>
              <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
              <Input
                value={draftMeta.reason ?? ""}
                onChange={(e) => setDraftMeta({ ...draftMeta, reason: e.target.value })}
                placeholder="Wedding gift, moving fee, etc."
                className="h-8 mt-1"
              />
            </div>
          </div>
        )}

        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t bg-popover p-3">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-8" onClick={handleSave}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
