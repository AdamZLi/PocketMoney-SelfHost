import Papa from "papaparse";
import * as XLSX from "xlsx";
import { cleanMerchant } from "./cleanMerchant";

export type RawRow = Record<string, string | number | boolean | null | undefined>;

export type ParsedTxn = {
  date: string; // YYYY-MM-DD
  name: string;
  amount: number;
  status: "pending" | "posted";
  category?: string | null;
  parent_category?: string | null;
  excluded?: boolean;
  tags?: string[];
  type?: string | null;
  account_name?: string | null;
  account_mask?: string | null;
  note?: string | null;
  recurring?: string | null;
  raw: RawRow;
};

const aliases: Record<keyof Omit<ParsedTxn, "raw">, string[]> = {
  date: ["date", "transaction date", "posted date"],
  name: ["name", "merchant", "description", "payee"],
  amount: ["amount", "debit", "value"],
  status: ["status"],
  category: ["category"],
  parent_category: ["parent category", "parent_category"],
  excluded: ["excluded"],
  tags: ["tags"],
  type: ["type"],
  account_name: ["account"],
  account_mask: ["account mask", "account_mask", "mask"],
  note: ["note", "notes", "memo"],
  recurring: ["recurring"],
};

function pick(row: RawRow, keys: string[]): any {
  const norm: Record<string, any> = {};
  for (const k of Object.keys(row)) norm[k.trim().toLowerCase()] = row[k];
  for (const k of keys) {
    const v = norm[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toISODate(v: any): string {
  if (!v) return "";
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function toNumber(v: any): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  return Number(String(v).replace(/[^0-9.\-]/g, "")) || 0;
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  return /^(true|1|yes)$/i.test(String(v ?? ""));
}

function toTags(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

export function normalizeRow(row: RawRow): ParsedTxn | null {
  const date = toISODate(pick(row, aliases.date));
  const rawName = String(pick(row, aliases.name) ?? "").trim();
  const name = cleanMerchant(rawName);
  const amount = toNumber(pick(row, aliases.amount));
  if (!date || !name) return null;
  const statusRaw = String(pick(row, aliases.status) ?? "posted").toLowerCase();
  return {
    date,
    name,
    amount,
    status: statusRaw === "pending" ? "pending" : "posted",
    category: (pick(row, aliases.category) as string) || null,
    parent_category: (pick(row, aliases.parent_category) as string) || null,
    excluded: toBool(pick(row, aliases.excluded)),
    tags: toTags(pick(row, aliases.tags)),
    type: (pick(row, aliases.type) as string) || null,
    account_name: (pick(row, aliases.account_name) as string) || null,
    account_mask: pick(row, aliases.account_mask) ? String(pick(row, aliases.account_mask)) : null,
    note: (pick(row, aliases.note) as string) || null,
    recurring: (pick(row, aliases.recurring) as string) || null,
    raw: row,
  };
}

export async function parseCSV(file: File): Promise<ParsedTxn[]> {
  const text = await file.text();
  const result = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
  return result.data.map(normalizeRow).filter((r): r is ParsedTxn => r !== null);
}

export async function parseXLSX(file: File): Promise<ParsedTxn[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null });
  return json.map(normalizeRow).filter((r): r is ParsedTxn => r !== null);
}

export async function parseFile(file: File): Promise<ParsedTxn[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return parseCSV(file);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXLSX(file);
  throw new Error("PDF parsing not yet implemented in Phase 1 client. Use CSV or XLSX for now.");
}
