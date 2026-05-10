// Shared duplicate-detection utilities used by both the Import page
// (staged-vs-DB) and the AI scan & review flow (DB-vs-DB).

/** A transaction-like record with the fields needed for dedup matching. */
export interface DedupEntry {
  id: string;
  name: string;
  amount: number;
  date: string; // YYYY-MM-DD
  account_id: string | null;
}

export type DupMember =
  | { kind: "candidate"; id: string }
  | { kind: "existing"; id: string; date: string; name: string; amount: number };

export interface DupGroup {
  key: string;
  members: DupMember[];
  /** Index of the member to keep when action === "merge". */
  keepIndex: number;
  action: "merge" | "keep_both" | "flag";
  crossAccount?: boolean;
}

export interface DedupOptions {
  /** How many days of date drift to allow (0 = exact date only). Default 0. */
  dateWindow?: number;
}

function dateOffsets(date: string, window: number): string[] {
  if (window <= 0) return [date];
  const dates: string[] = [];
  for (let offset = -window; offset <= window; offset++) {
    const dt = new Date(date + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + offset);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Find duplicate groups between `candidates` and `existing` entries.
 *
 * - **Same-account pass**: groups by account_id + name + amount + exact date.
 * - **Cross-account pass**: groups by name + amount + date (±dateWindow).
 *
 * `candidates` are the "new" side (staged rows during import, or the scanned
 * transactions during review). `existing` are the reference set (DB rows).
 * A group must contain at least one candidate to be returned.
 */
export function findDuplicateGroups(
  candidates: DedupEntry[],
  existing: DedupEntry[],
  options: DedupOptions = {},
): DupGroup[] {
  const dateWindow = options.dateWindow ?? 0;

  // --- Pass 1: same-account exact match (always exact date) ---
  const sameAcctGroups = new Map<string, DupMember[]>();
  const sameAcctKey = (acct: string | null, name: string, amount: number, date: string) =>
    `${acct ?? ""}|${name.trim().toLowerCase()}|${Number(amount).toFixed(2)}|${date}`;

  for (const c of candidates) {
    const k = sameAcctKey(c.account_id, c.name, c.amount, c.date);
    if (!sameAcctGroups.has(k)) sameAcctGroups.set(k, []);
    sameAcctGroups.get(k)!.push({ kind: "candidate", id: c.id });
  }
  for (const e of existing) {
    const k = sameAcctKey(e.account_id, e.name, e.amount, e.date);
    if (sameAcctGroups.has(k)) {
      sameAcctGroups.get(k)!.push({ kind: "existing", id: e.id, date: e.date, name: e.name, amount: e.amount });
    }
  }

  const result: DupGroup[] = [];
  const matchedCandidateIds = new Set<string>();

  for (const [k, members] of sameAcctGroups) {
    const candidateCount = members.filter(m => m.kind === "candidate").length;
    if (members.length >= 2 && candidateCount >= 1) {
      const keepIndex = members.findIndex(m => m.kind === "candidate");
      result.push({ key: k, members, keepIndex: keepIndex >= 0 ? keepIndex : 0, action: "keep_both" });
      for (const m of members) {
        if (m.kind === "candidate") matchedCandidateIds.add(m.id);
      }
    }
  }

  // --- Pass 2: cross-account (ignore account_id, allow date window) ---
  const xGroups = new Map<string, DupMember[]>();
  const xKey = (name: string, amount: number, date: string) =>
    `${name.trim().toLowerCase()}|${Number(amount).toFixed(2)}|${date}`;

  for (const c of candidates) {
    if (matchedCandidateIds.has(c.id)) continue;
    // For each date in the window, add to the bucket
    for (const d of dateOffsets(c.date, dateWindow)) {
      const k = xKey(c.name, c.amount, d);
      if (!xGroups.has(k)) xGroups.set(k, []);
      const bucket = xGroups.get(k)!;
      // Avoid adding the same candidate multiple times to the same bucket
      if (!bucket.some(m => m.kind === "candidate" && m.id === c.id)) {
        bucket.push({ kind: "candidate", id: c.id });
      }
    }
  }
  for (const e of existing) {
    // Existing entries only match on their exact date (candidates expand the window)
    const k = xKey(e.name, e.amount, e.date);
    if (xGroups.has(k)) {
      const bucket = xGroups.get(k)!;
      if (!bucket.some(m => m.kind === "existing" && m.id === e.id)) {
        bucket.push({ kind: "existing", id: e.id, date: e.date, name: e.name, amount: e.amount });
      }
    }
  }

  // Deduplicate cross-account groups: a candidate may appear in multiple date
  // buckets. We pick the group with the most members and skip the rest.
  const xCandidateSeen = new Set<string>();
  const sortedXGroups = [...xGroups.entries()]
    .filter(([, members]) => {
      const candidateCount = members.filter(m => m.kind === "candidate").length;
      return members.length >= 2 && candidateCount >= 1;
    })
    .sort((a, b) => b[1].length - a[1].length);

  for (const [k, members] of sortedXGroups) {
    const candidateIds = members.filter(m => m.kind === "candidate").map(m => m.id);
    if (candidateIds.every(id => xCandidateSeen.has(id))) continue;
    for (const id of candidateIds) xCandidateSeen.add(id);
    const keepIndex = members.findIndex(m => m.kind === "candidate");
    result.push({ key: `x|${k}`, members, keepIndex: keepIndex >= 0 ? keepIndex : 0, action: "flag", crossAccount: true });
  }

  return result;
}

/**
 * Compute the date range needed for a dedup query, given a set of dates
 * and a dateWindow. Returns [min, max] as YYYY-MM-DD strings.
 */
export function dedupDateRange(dates: string[], dateWindow: number = 0): [string, string] {
  const sorted = [...dates].sort();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (dateWindow <= 0) return [min, max];
  const minDt = new Date(min + "T00:00:00Z");
  minDt.setUTCDate(minDt.getUTCDate() - dateWindow);
  const maxDt = new Date(max + "T00:00:00Z");
  maxDt.setUTCDate(maxDt.getUTCDate() + dateWindow);
  return [minDt.toISOString().slice(0, 10), maxDt.toISOString().slice(0, 10)];
}
