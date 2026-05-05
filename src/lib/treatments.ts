// Single source of truth for how a transaction contributes to monthly trends.
// Used by Trends + Dashboard. Keep all rules here.

export type Treatment = "normal" | "excluded" | "refundable" | "reimbursable" | "amortized" | "split";

export type SplitPart = {
  id?: string;
  label?: string;
  amount: number; // absolute, in same units as txn amount
  treatment: Exclude<Treatment, "split">;
  meta?: TreatmentMeta;
};

export type TreatmentMeta = {
  // refundable
  expected_refund_date?: string | null;
  refund_status?: "pending" | "received";
  // reimbursable
  your_share?: number;
  owed_by?: string;
  reimbursement_status?: "pending" | "settled";
  // amortized
  months?: number;
  start_date?: string;
  amort_mode?: "calendar_year" | "custom";
  // excluded
  reason?: string;
  // refund pair (set on the original charge when linked)
  refunded_by_txn_id?: string | null;
  // split into multiple sub-parts (each with its own treatment)
  parts?: SplitPart[];
};

export type TxnLike = {
  date: string;
  amount: number;
  treatment?: Treatment | null;
  treatment_meta?: TreatmentMeta | null;
  linked_txn_id?: string | null;
  excluded?: boolean;
};

const monthKey = (d: string) => d.slice(0, 7);

function addMonths(iso: string, n: number) {
  const d = new Date(iso + (iso.length === 7 ? "-01" : ""));
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns the effective expense contribution this transaction makes to a given
 * month. Positive numbers mean money going out.
 */
export function effectiveMonthlyContribution(t: TxnLike, monthIso: string): number {
  const treatment = t.treatment ?? (t.excluded ? "excluded" : "normal");
  const meta = t.treatment_meta ?? {};
  const amt = Math.abs(Number(t.amount) || 0);

  switch (treatment) {
    case "excluded":
    case "refundable":
      return 0;
    case "reimbursable": {
      const share = typeof meta.your_share === "number" ? meta.your_share : amt;
      return monthKey(t.date) === monthIso ? Math.abs(share) : 0;
    }
    case "amortized": {
      return amortizedContribution(amt, meta, t.date, monthIso);
    }
    case "split": {
      const parts = meta.parts ?? [];
      let sum = 0;
      for (const part of parts) {
        sum += partContribution(part, t.date, monthIso);
      }
      return sum;
    }
    case "normal":
    default:
      // Linked refunds (the one marked as the refund) net to zero.
      if (t.linked_txn_id && Number(t.amount) > 0) return 0;
      return monthKey(t.date) === monthIso ? Number(t.amount) : 0;
  }
}

function amortizedContribution(amt: number, meta: TreatmentMeta, txnDate: string, monthIso: string): number {
  const mode = meta.amort_mode ?? "calendar_year";
  if (mode === "calendar_year") {
    const year = txnDate.slice(0, 4);
    if (monthIso.slice(0, 4) !== year) return 0;
    return amt / 12;
  }
  const months = Math.max(1, Math.floor(meta.months ?? 12));
  const start = (meta.start_date ?? txnDate).slice(0, 7);
  const idx = monthsBetween(start, monthIso);
  if (idx < 0 || idx >= months) return 0;
  return amt / months;
}

function partContribution(part: SplitPart, txnDate: string, monthIso: string): number {
  const amt = Math.abs(part.amount || 0);
  const meta = part.meta ?? {};
  switch (part.treatment) {
    case "excluded":
    case "refundable":
      return 0;
    case "reimbursable": {
      const share = typeof meta.your_share === "number" ? meta.your_share : amt;
      return monthKey(txnDate) === monthIso ? Math.abs(share) : 0;
    }
    case "amortized":
      return amortizedContribution(amt, meta, txnDate, monthIso);
    case "normal":
    default:
      return monthKey(txnDate) === monthIso ? amt : 0;
  }
}

export function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Should this transaction count as a follow-up item? */
export function followUpKind(t: TxnLike): "refund_pending" | "reimbursement_pending" | null {
  const treatment = t.treatment ?? "normal";
  const meta = t.treatment_meta ?? {};
  if (treatment === "refundable" && (meta.refund_status ?? "pending") === "pending") return "refund_pending";
  if (treatment === "reimbursable" && (meta.reimbursement_status ?? "pending") === "pending") return "reimbursement_pending";
  return null;
}

/** Iterate every "logical" item in a transaction (the txn itself, or its split parts). */
export function expandFollowUps(t: TxnLike & { id: string; name: string }): Array<{
  id: string;
  partIndex?: number;
  partLabel?: string;
  date: string;
  name: string;
  amount: number;
  treatment: Treatment;
  treatment_meta: TreatmentMeta;
}> {
  const treatment = t.treatment ?? "normal";
  if (treatment !== "split") {
    return [{
      id: t.id,
      date: t.date,
      name: t.name,
      amount: t.amount,
      treatment,
      treatment_meta: t.treatment_meta ?? {},
    }];
  }
  const parts = t.treatment_meta?.parts ?? [];
  return parts.map((p, i) => ({
    id: t.id,
    partIndex: i,
    partLabel: p.label,
    date: t.date,
    name: t.name,
    amount: p.amount,
    treatment: p.treatment,
    treatment_meta: p.meta ?? {},
  }));
}

export function treatmentLabel(t: TxnLike): string | null {
  const treatment = t.treatment ?? "normal";
  const meta = t.treatment_meta ?? {};
  switch (treatment) {
    case "excluded":
      return meta.reason ? `Excluded · ${meta.reason}` : "Excluded";
    case "refundable":
      return (meta.refund_status ?? "pending") === "received" ? "Refunded" : "Refundable · pending";
    case "reimbursable": {
      const share = typeof meta.your_share === "number" ? meta.your_share : Math.abs(Number(t.amount) || 0);
      return `Split · ${formatMoney(share)} of ${formatMoney(Math.abs(Number(t.amount) || 0))}`;
    }
    case "amortized": {
      if ((meta.amort_mode ?? "calendar_year") === "calendar_year") {
        return `Amortized · ${t.date.slice(0, 4)} (Jan–Dec)`;
      }
      return `Amortized · ${meta.months ?? 12} mo`;
    }
    case "split": {
      const n = (meta.parts ?? []).length;
      return `Split into ${n} part${n === 1 ? "" : "s"}`;
    }
    default:
      return null;
  }
}

function formatMoney(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

export function previewAmortization(amount: number, months: number, startMonth: string) {
  const m = Math.max(1, Math.floor(months));
  const per = Math.abs(amount) / m;
  const end = addMonths(startMonth, m - 1);
  return { per, start: startMonth, end };
}
