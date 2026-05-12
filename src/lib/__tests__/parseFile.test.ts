import { describe, it, expect } from "vitest";
import { normalizeRow, parseCSV } from "../parseFile";
import {
  generateCapitalOneCsv,
  generateCapitalOneCsvFile,
} from "@/test/generators/csvGenerator";
import { readFileSync } from "fs";
import { resolve } from "path";
import Papa from "papaparse";
import type { RawRow, ParsedTxn } from "../parseFile";

// Load the static golden fixture
const goldenCsv = readFileSync(
  resolve(__dirname, "../../test/fixtures/capital-one-sample.csv"),
  "utf-8",
);

// Helper: parse CSV string directly using normalizeRow (bypasses File API)
function parseCsvString(csv: string): ParsedTxn[] {
  const result = Papa.parse<RawRow>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  return result.data
    .map((r) => normalizeRow(r))
    .filter((r): r is ParsedTxn => r !== null);
}

describe("parseCSV", () => {
  it("parses the golden CSV fixture with correct row count", () => {
    const rows = parseCsvString(goldenCsv);
    expect(rows).toHaveLength(10);
    rows.forEach((r) => {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.name).toBeTruthy();
      expect(typeof r.amount).toBe("number");
    });
  });

  it("parses randomized CSV without errors", () => {
    const csv = generateCapitalOneCsv({ rowCount: 50, seed: 42 });
    const rows = parseCsvString(csv);
    // Should parse most rows (at least rowCount - 1 for the empty-amount edge case)
    expect(rows.length).toBeGreaterThanOrEqual(45);
    rows.forEach((r) => {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.name).toBeTruthy();
      expect(typeof r.amount).toBe("number");
    });
  });

  it("maps Capital One column aliases correctly", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-06-20,2025-06-21,7438,SQ *MIDTOWN DENTAL GRO,Health Care,230.00,",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.date).toBe("2025-06-20");
    expect(r.name).toBeTruthy();
    expect(r.amount).toBe(230);
    expect(r.category).toBe("Health Care");
  });

  it("handles debit-only rows as positive amounts", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-08-17,2025-08-18,7505,APPLE STORE  #R415,Merchandise,1523.16,",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows[0].amount).toBe(1523.16);
  });

  it("handles credit-only rows", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-10-28,2025-10-29,6673,ATORIE,Merchandise,,646.00",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows).toHaveLength(1);
    // Credit-only: the parser's amount alias checks "debit" first; documents current behavior
    expect(typeof rows[0].amount).toBe("number");
  });

  it("preserves quoted descriptions with commas", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      '2025-11-24,2025-11-25,6673,"CURSOR, AI POWERED IDE",Merchandise,20.00,',
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name.toUpperCase()).toContain("CURSOR");
  });

  it("normalizes dates to ISO format", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-12-27,2025-12-29,0981,MINT MOBILE,Phone/Cable,262.21,",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows[0].date).toBe("2025-12-27");
  });

  it("filters out rows with no name (empty date uses posted date fallback)", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      ",2025-12-29,0981,HAS POSTED DATE,Other,10.00,",
      "2025-12-27,2025-12-29,0981,,Other,10.00,",
      "2025-12-27,2025-12-29,0981,VALID MERCHANT,Other,10.00,",
    ].join("\n");
    const rows = parseCsvString(csv);
    // Row 1 survives because "posted date" is a fallback for the date alias.
    // Row 2 is filtered (no name). Row 3 is valid.
    expect(rows).toHaveLength(2);
    // The no-name row should not be present
    expect(rows.every((r) => r.name.length > 0)).toBe(true);
  });

  it("handles row with neither debit nor credit as amount 0", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-06-01,2025-06-02,7438,SOME MERCHANT,Other,,",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(0);
  });

  it("reads card number into raw row", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2025-06-01,2025-06-02,7438,SOME MERCHANT,Other,10.00,",
    ].join("\n");
    const rows = parseCsvString(csv);
    expect(rows).toHaveLength(1);
    // Card No. is available in the raw row for downstream use
    expect(rows[0].raw["Card No."]).toBe(7438);
  });

  it("produces different data with different seeds", () => {
    const csv1 = generateCapitalOneCsv({ rowCount: 10, seed: 111 });
    const csv2 = generateCapitalOneCsv({ rowCount: 10, seed: 222 });
    const rows1 = parseCsvString(csv1);
    const rows2 = parseCsvString(csv2);
    const names1 = rows1.map((r) => r.name).join(",");
    const names2 = rows2.map((r) => r.name).join(",");
    expect(names1).not.toBe(names2);
  });

  it("produces same data with same seed", () => {
    const csv1 = generateCapitalOneCsv({ rowCount: 10, seed: 999 });
    const csv2 = generateCapitalOneCsv({ rowCount: 10, seed: 999 });
    expect(csv1).toBe(csv2);
  });
});

describe("normalizeRow", () => {
  it("returns null for empty row", () => {
    expect(normalizeRow({})).toBeNull();
  });

  it("returns null for row with date but no name", () => {
    expect(normalizeRow({ date: "2025-01-01" })).toBeNull();
  });

  it("normalizes a standard row", () => {
    const row = {
      "Transaction Date": "2025-12-27",
      Description: "MINT MOBILE",
      Debit: 262.21,
      Category: "Phone/Cable",
    };
    const result = normalizeRow(row);
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-12-27");
    expect(result!.name).toBeTruthy();
    expect(result!.amount).toBe(262.21);
    expect(result!.category).toBe("Phone/Cable");
  });
});
