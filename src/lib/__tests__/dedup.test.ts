import { describe, it, expect } from "vitest";
import { findDuplicateGroups, dedupDateRange, type DedupEntry } from "../dedup";

function entry(overrides: Partial<DedupEntry> & { id: string }): DedupEntry {
  return {
    name: "Target",
    amount: 5.64,
    date: "2026-04-30",
    account_id: "acct-1",
    ...overrides,
  };
}

describe("findDuplicateGroups", () => {
  it("detects same-account exact duplicates", () => {
    const candidates = [entry({ id: "c1", account_id: "acct-1" })];
    const existing = [entry({ id: "e1", account_id: "acct-1" })];
    const groups = findDuplicateGroups(candidates, existing);
    expect(groups).toHaveLength(1);
    expect(groups[0].crossAccount).toBeFalsy();
    expect(groups[0].action).toBe("keep_both");
    expect(groups[0].members).toHaveLength(2);
  });

  it("detects cross-account duplicates (same name, different account)", () => {
    const candidates = [entry({ id: "c1", account_id: "acct-1" })];
    const existing = [entry({ id: "e1", account_id: "acct-2" })];
    const groups = findDuplicateGroups(candidates, existing);
    expect(groups).toHaveLength(1);
    expect(groups[0].crossAccount).toBe(true);
    expect(groups[0].action).toBe("flag");
  });

  it("does not group different amounts", () => {
    const candidates = [entry({ id: "c1", amount: 5.64 })];
    const existing = [entry({ id: "e1", amount: 10.00 })];
    const groups = findDuplicateGroups(candidates, existing);
    expect(groups).toHaveLength(0);
  });

  it("does not group different names", () => {
    const candidates = [entry({ id: "c1", name: "Target" })];
    const existing = [entry({ id: "e1", name: "Walmart" })];
    const groups = findDuplicateGroups(candidates, existing);
    expect(groups).toHaveLength(0);
  });

  it("does not group different dates with dateWindow=0", () => {
    const candidates = [entry({ id: "c1", date: "2026-04-30" })];
    const existing = [entry({ id: "e1", date: "2026-05-01", account_id: "acct-2" })];
    const groups = findDuplicateGroups(candidates, existing, { dateWindow: 0 });
    expect(groups).toHaveLength(0);
  });

  it("detects cross-account duplicates within dateWindow=1", () => {
    const candidates = [entry({ id: "c1", date: "2026-04-30", account_id: "acct-1" })];
    const existing = [entry({ id: "e1", date: "2026-05-01", account_id: "acct-2" })];
    const groups = findDuplicateGroups(candidates, existing, { dateWindow: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].crossAccount).toBe(true);
  });

  it("does not duplicate-detect beyond dateWindow", () => {
    const candidates = [entry({ id: "c1", date: "2026-04-28", account_id: "acct-1" })];
    const existing = [entry({ id: "e1", date: "2026-04-30", account_id: "acct-2" })];
    const groups = findDuplicateGroups(candidates, existing, { dateWindow: 1 });
    expect(groups).toHaveLength(0);
  });

  it("same-account match takes priority over cross-account", () => {
    // c1 matches e1 on same account — should be in same-account group, not cross-account
    const candidates = [entry({ id: "c1", account_id: "acct-1" })];
    const existing = [
      entry({ id: "e1", account_id: "acct-1" }),
      entry({ id: "e2", account_id: "acct-2" }),
    ];
    const groups = findDuplicateGroups(candidates, existing);
    // c1 is in same-account group with e1; e2 has no candidate to pair with
    const sameAcct = groups.filter(g => !g.crossAccount);
    const crossAcct = groups.filter(g => g.crossAccount);
    expect(sameAcct).toHaveLength(1);
    expect(crossAcct).toHaveLength(0); // c1 already matched, no more candidates
  });

  it("returns empty for no candidates", () => {
    const groups = findDuplicateGroups([], [entry({ id: "e1" })]);
    expect(groups).toHaveLength(0);
  });

  it("groups multiple candidates together", () => {
    const candidates = [
      entry({ id: "c1", account_id: "acct-1" }),
      entry({ id: "c2", account_id: "acct-1" }),
    ];
    const groups = findDuplicateGroups(candidates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it("handles case-insensitive name matching", () => {
    const candidates = [entry({ id: "c1", name: "TARGET", account_id: "acct-1" })];
    const existing = [entry({ id: "e1", name: "target", account_id: "acct-1" })];
    const groups = findDuplicateGroups(candidates, existing);
    expect(groups).toHaveLength(1);
  });
});

describe("dedupDateRange", () => {
  it("returns exact min/max for dateWindow=0", () => {
    const [min, max] = dedupDateRange(["2026-04-15", "2026-04-30", "2026-04-20"]);
    expect(min).toBe("2026-04-15");
    expect(max).toBe("2026-04-30");
  });

  it("expands range with dateWindow", () => {
    const [min, max] = dedupDateRange(["2026-04-15", "2026-04-30"], 1);
    expect(min).toBe("2026-04-14");
    expect(max).toBe("2026-05-01");
  });

  it("handles single date", () => {
    const [min, max] = dedupDateRange(["2026-05-01"], 2);
    expect(min).toBe("2026-04-29");
    expect(max).toBe("2026-05-03");
  });
});
