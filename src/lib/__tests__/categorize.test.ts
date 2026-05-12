import { describe, it, expect } from "vitest";
import { applyRules, type Rule } from "../categorize";

const makeRule = (overrides: Partial<Rule> & { pattern: string }): Rule => ({
  id: "rule-" + Math.random().toString(36).slice(2),
  category_id: "cat-default",
  match_type: "contains",
  priority: 100,
  ...overrides,
});

describe("applyRules", () => {
  it("contains match: matches substring", () => {
    const rules = [
      makeRule({
        pattern: "CLASSPASS",
        match_type: "contains",
        category_id: "cat-fitness",
      }),
    ];
    expect(applyRules("CLASSPASS* MONTHLY", rules)).toBe("cat-fitness");
  });

  it("contains match: case insensitive", () => {
    const rules = [
      makeRule({
        pattern: "classpass",
        match_type: "contains",
        category_id: "cat-fitness",
      }),
    ];
    expect(applyRules("CLASSPASS* MONTHLY", rules)).toBe("cat-fitness");
  });

  it("equals match: matches exact string only", () => {
    const rules = [
      makeRule({
        pattern: "COS",
        match_type: "equals",
        category_id: "cat-clothing",
      }),
    ];
    expect(applyRules("COS", rules)).toBe("cat-clothing");
  });

  it("equals match: does NOT match substring", () => {
    const rules = [
      makeRule({
        pattern: "COS",
        match_type: "equals",
        category_id: "cat-clothing",
      }),
    ];
    expect(applyRules("COSTCO WHOLESALE", rules)).toBeNull();
  });

  it("equals match: case insensitive", () => {
    const rules = [
      makeRule({
        pattern: "cos",
        match_type: "equals",
        category_id: "cat-clothing",
      }),
    ];
    expect(applyRules("COS", rules)).toBe("cat-clothing");
  });

  it("regex match: matches pattern", () => {
    const rules = [
      makeRule({
        pattern: "^GOOGLE.*YOUTUBE",
        match_type: "regex",
        category_id: "cat-streaming",
      }),
    ];
    expect(applyRules("GOOGLE*YOUTUBEPREMIUM", rules)).toBe("cat-streaming");
  });

  it("regex match: case insensitive", () => {
    const rules = [
      makeRule({
        pattern: "^google.*youtube",
        match_type: "regex",
        category_id: "cat-streaming",
      }),
    ];
    expect(applyRules("GOOGLE *YouTubePremium", rules)).toBe("cat-streaming");
  });

  it("priority: lower number wins", () => {
    const rules = [
      makeRule({
        pattern: "APPLE",
        match_type: "contains",
        category_id: "cat-tech",
        priority: 50,
      }),
      makeRule({
        pattern: "APPLE",
        match_type: "contains",
        category_id: "cat-groceries",
        priority: 10,
      }),
    ];
    // Priority 10 (lower) should win
    expect(applyRules("APPLE STORE", rules)).toBe("cat-groceries");
  });

  it("returns null when no rule matches", () => {
    const rules = [
      makeRule({
        pattern: "NETFLIX",
        match_type: "contains",
        category_id: "cat-streaming",
      }),
    ];
    expect(applyRules("COSTCO WHOLESALE", rules)).toBeNull();
  });

  it("returns null for empty rules array", () => {
    expect(applyRules("ANYTHING", [])).toBeNull();
  });

  it("skips bad regex without throwing", () => {
    const rules = [
      makeRule({
        pattern: "[invalid(regex",
        match_type: "regex",
        category_id: "cat-bad",
      }),
      makeRule({
        pattern: "COSTCO",
        match_type: "contains",
        category_id: "cat-shopping",
      }),
    ];
    // Should not throw, should fall through to the contains rule
    expect(applyRules("COSTCO WHOLESALE", rules)).toBe("cat-shopping");
  });

  it("multiple match types: first by priority wins", () => {
    const rules = [
      makeRule({
        pattern: "UBER",
        match_type: "contains",
        category_id: "cat-transport",
        priority: 20,
      }),
      makeRule({
        pattern: "^UBER.*TRIP",
        match_type: "regex",
        category_id: "cat-rideshare",
        priority: 10,
      }),
    ];
    // Regex rule has lower priority (10), so it wins
    expect(applyRules("UBER   *TRIP", rules)).toBe("cat-rideshare");
  });
});
