/**
 * Generates randomized Capital One-format CSV strings for testing.
 * Uses real merchant patterns from production data but randomizes
 * amounts, dates, card numbers, and row composition on each call.
 *
 * Deterministic when given a seed; random by default.
 */

// Seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type GeneratorOptions = {
  rowCount?: number;
  seed?: number;
  /** Force-include specific edge case rows beyond the guaranteed set */
  extraEdgeCases?: Partial<RawCsvRow>[];
};

type RawCsvRow = {
  transactionDate: string;
  postedDate: string;
  cardNo: string;
  description: string;
  category: string;
  debit: string;
  credit: string;
};

const MERCHANT_PATTERNS = [
  // Subscriptions & SaaS
  { desc: "OPENAI *CHATGPT SUBSCR", cat: "Merchandise", amtRange: [10, 30] },
  { desc: "CLASSPASS* MONTHLY", cat: "Entertainment", amtRange: [59, 99] },
  { desc: '"CURSOR, AI POWERED IDE"', cat: "Merchandise", amtRange: [20, 20] },
  { desc: "MINT MOBILE", cat: "Phone/Cable", amtRange: [25, 265] },
  { desc: "GOOGLE*YOUTUBEPREMIUM", cat: "Internet", amtRange: [15, 20] },
  { desc: "APPLE.COM/BILL", cat: "Entertainment", amtRange: [3, 25] },
  { desc: "COPILOT MONEY", cat: "Merchandise", amtRange: [50, 110] },
  { desc: "ASTOUND POWERED BY RCN", cat: "Phone/Cable", amtRange: [75, 210] },
  // Dining
  { desc: "GOOD BROTHERS BBQ", cat: "Dining", amtRange: [15, 60] },
  { desc: "STREET GRILL", cat: "Dining", amtRange: [30, 120] },
  { desc: "TANING LEMON TEA", cat: "Dining", amtRange: [5, 20] },
  { desc: "NAIBROTHER LIC", cat: "Dining", amtRange: [10, 40] },
  // Shopping / Retail
  { desc: "COSTCO WHOLESALE W524", cat: "Merchandise", amtRange: [2, 460] },
  { desc: "BEST BUY      00010280", cat: "Merchandise", amtRange: [15, 800] },
  { desc: "BARNES & NOBLE #2234", cat: "Merchandise", amtRange: [8, 50] },
  { desc: "Muji - Fifth Ave", cat: "Merchandise", amtRange: [10, 100] },
  { desc: "Uniqlo Canada POS_CA_T", cat: "Merchandise", amtRange: [30, 200] },
  { desc: "COS", cat: "Merchandise", amtRange: [50, 530] },
  { desc: "APPLE STORE  #R415", cat: "Merchandise", amtRange: [50, 1600] },
  { desc: "BLUE MOUNTAIN RETAIL", cat: "Merchandise", amtRange: [20, 100] },
  // Travel
  { desc: "AIRBNB * HMTQ8WKKEN", cat: "Other Travel", amtRange: [50, 550] },
  { desc: "JETBLUE   27972846169995", cat: "Airfare", amtRange: [100, 400] },
  { desc: "UBER   *TRIP", cat: "Other Travel", amtRange: [8, 50] },
  { desc: "LYFT   *1 RIDE 04-30", cat: "Other Travel", amtRange: [10, 45] },
  { desc: "EXPEDIA 73079275629487", cat: "Other Travel", amtRange: [15, 200] },
  { desc: "PIECE OF CAKE MOVING", cat: "Other Travel", amtRange: [50, 450] },
  { desc: "NIAGARA AIR BUS", cat: "Other Travel", amtRange: [40, 100] },
  { desc: "MTA*NYCT PAYGO", cat: "Other Travel", amtRange: [2, 10] },
  // Services
  { desc: "HAIR PHILOSOPHY NY", cat: "Other Services", amtRange: [50, 100] },
  { desc: "LinkedIn P730740576", cat: "Other Services", amtRange: [15, 25] },
  { desc: "NEW YORK STATE DMV", cat: "Other Services", amtRange: [10, 50] },
  { desc: "HOMEAGLOW 2HR VOUCHER", cat: "Other Services", amtRange: [5, 15] },
  // Health & Utilities
  { desc: "SQ *MIDTOWN DENTAL GRO", cat: "Health Care", amtRange: [50, 500] },
  { desc: "WALGREENS #13078", cat: "Health Care", amtRange: [5, 50] },
  { desc: "FSI*CONED BILL PAYMENT", cat: "Utilities", amtRange: [50, 270] },
  // Auto / Gas
  { desc: "AVIS RENT-A-CAR", cat: "Car Rental", amtRange: [100, 500] },
  { desc: "MARATHON PETRO35329", cat: "Gas/Automotive", amtRange: [15, 60] },
  { desc: "EXXON NYST #444", cat: "Gas/Automotive", amtRange: [15, 50] },
  // Opaque / unknown
  { desc: "SQ *4F8K2 LLC", cat: "Merchandise", amtRange: [10, 100] },
  { desc: "FH* FURY ADVENTURES", cat: "Entertainment", amtRange: [20, 350] },
  { desc: "NCOURT *NYTULLYTOWN", cat: "Other", amtRange: [50, 220] },
];

const CARD_NUMBERS = ["7438", "7505", "6673", "0981"];

// Credit-type rows (payments, refunds, adjustments)
const CREDIT_PATTERNS = [
  { desc: "CAPITAL ONE AUTOPAY PYMT", cat: "Payment/Credit", amtRange: [500, 2500] },
  { desc: "CREDIT-CASH BACK REWARD", cat: "Payment/Credit", amtRange: [50, 250] },
  { desc: "PURCHASE ADJUSTMENT", cat: "Other Travel", amtRange: [10, 50] },
  { desc: "ATORIE", cat: "Merchandise", amtRange: [100, 650] },
  { desc: "COS", cat: "Merchandise", amtRange: [100, 300] },
];

function randomDate(rand: () => number, startYear = 2025): { txn: string; posted: string } {
  const month = Math.floor(rand() * 12) + 1;
  const day = Math.floor(rand() * 28) + 1;
  const txnDate = `${startYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Posted date is 0-3 days after transaction date
  const offset = Math.floor(rand() * 4);
  const d = new Date(`${txnDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  const postedDate = d.toISOString().slice(0, 10);

  return { txn: txnDate, posted: postedDate };
}

function randomAmount(rand: () => number, min: number, max: number): string {
  const val = min + rand() * (max - min);
  return val.toFixed(2);
}

function escapeField(s: string): string {
  // Already quoted from merchant patterns
  if (s.startsWith('"')) return s;
  // Quote if contains commas
  if (s.includes(",")) return `"${s}"`;
  return s;
}

function buildRow(rand: () => number, isCredit: boolean): RawCsvRow {
  const pool = isCredit ? CREDIT_PATTERNS : MERCHANT_PATTERNS;
  const pattern = pool[Math.floor(rand() * pool.length)];
  const { txn, posted } = randomDate(rand);
  const card = CARD_NUMBERS[Math.floor(rand() * CARD_NUMBERS.length)];
  const amt = randomAmount(rand, pattern.amtRange[0], pattern.amtRange[1]);

  return {
    transactionDate: txn,
    postedDate: posted,
    cardNo: card,
    description: pattern.desc,
    category: pattern.cat,
    debit: isCredit ? "" : amt,
    credit: isCredit ? amt : "",
  };
}

const HEADER = "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit";

function rowToCsv(r: RawCsvRow): string {
  return [
    r.transactionDate,
    r.postedDate,
    r.cardNo,
    escapeField(r.description),
    r.category,
    r.debit,
    r.credit,
  ].join(",");
}

export function generateCapitalOneCsv(options: GeneratorOptions = {}): string {
  const { rowCount = 30, seed = Date.now(), extraEdgeCases = [] } = options;
  const rand = mulberry32(seed);

  const rows: RawCsvRow[] = [];

  // Guaranteed edge cases (always present)
  // 1. Quoted description with comma
  rows.push({
    ...buildRow(rand, false),
    description: '"CURSOR, AI POWERED IDE"',
  });
  // 2. Credit-only row
  rows.push(buildRow(rand, true));
  // 3. Row with both debit and credit empty
  rows.push({
    ...buildRow(rand, false),
    debit: "",
    credit: "",
  });
  // 4. Opaque SQ* merchant
  rows.push({
    ...buildRow(rand, false),
    description: `SQ *${String(Math.floor(rand() * 90000 + 10000))}`,
    category: "Merchandise",
  });

  // Extra edge cases from caller
  for (const ec of extraEdgeCases) {
    const base = buildRow(rand, false);
    rows.push({ ...base, ...ec });
  }

  // Fill remaining with random mix (~80% debit, ~20% credit)
  const remaining = Math.max(0, rowCount - rows.length);
  for (let i = 0; i < remaining; i++) {
    const isCredit = rand() < 0.2;
    rows.push(buildRow(rand, isCredit));
  }

  // Shuffle rows
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  return [HEADER, ...rows.map(rowToCsv), ""].join("\n");
}

/**
 * Returns the same CSV content as a File object (for parseFile/parseCSV).
 */
export function generateCapitalOneCsvFile(
  options: GeneratorOptions & { filename?: string } = {},
): File {
  const csv = generateCapitalOneCsv(options);
  const { filename = "test-transactions.csv" } = options;
  return new File([csv], filename, { type: "text/csv" });
}

export { MERCHANT_PATTERNS, CREDIT_PATTERNS, CARD_NUMBERS };
export type { GeneratorOptions, RawCsvRow };
