// Cleans raw merchant/description strings into a friendly display name.
// Examples:
//   "WALGREENS #13078"           -> "Walgreens"
//   "LinkedIn P730740576"        -> "LinkedIn"
//   "OPENAI *CHATGPT SUBSCR"     -> "OpenAI ChatGPT Subscr"
//   "TST* MAMA'S PIZZA 123"      -> "Mama's Pizza"
//   "SQ *BLUE BOTTLE COFFEE"     -> "Blue Bottle Coffee"
//   "AMZN Mktp US*A12B3"         -> "Amazon Marketplace"
//   "UBER   EATS  HELP.UBER.COM" -> "Uber Eats"

const KNOWN: Array<[RegExp, string]> = [
  [/\bAMZN\s*MKTP(\s*US)?\b/i, "Amazon Marketplace"],
  [/\bAMAZON\s*MKTPL?\b/i, "Amazon Marketplace"],
  [/\bAMAZON\.COM\b/i, "Amazon"],
  [/\bAMZN\b/i, "Amazon"],
  [/\bOPENAI\b/i, "OpenAI"],
  [/\bCHATGPT\b/i, "ChatGPT"],
  [/\bLINKEDIN\b/i, "LinkedIn"],
  [/\bWALGREENS\b/i, "Walgreens"],
  [/\bUBER\s*EATS\b/i, "Uber Eats"],
  [/\bUBER\b/i, "Uber"],
  [/\bLYFT\b/i, "Lyft"],
  [/\bDOORDASH\b/i, "DoorDash"],
  [/\bGRUBHUB\b/i, "Grubhub"],
  [/\bNETFLIX\b/i, "Netflix"],
  [/\bSPOTIFY\b/i, "Spotify"],
  [/\bAPPLE\.COM\/BILL\b/i, "Apple"],
  [/\bGOOGLE\s*\*?\s*(YOUTUBE|YT)\b/i, "YouTube"],
  [/\bSTARBUCKS\b/i, "Starbucks"],
  [/\bTRADER JOE'?S?\b/i, "Trader Joe's"],
  [/\bWHOLEFDS\b|\bWHOLE FOODS\b/i, "Whole Foods"],
  [/\bCOSTCO\b/i, "Costco"],
  [/\bTARGET\b/i, "Target"],
  [/\bWALMART\b/i, "Walmart"],
  [/\bMINT MOBILE\b/i, "Mint Mobile"],
  [/\bCOPILOT MONEY\b/i, "Copilot Money"],
  [/\bUNIQLO\b/i, "Uniqlo"],
  [/\bNETFLIX\.COM\b/i, "Netflix"],
];

// Common payment-processor / channel prefixes to strip
const PREFIXES = [
  /^TST\*\s*/i,
  /^SQ\s*\*\s*/i,        // Square
  /^SP\s*\*\s*/i,        // Shopify
  /^PAYPAL\s*\*\s*/i,
  /^PP\s*\*\s*/i,
  /^IN\s*\*\s*/i,        // Intuit
  /^POS\s+/i,
  /^DEBIT\s+/i,
  /^CREDIT\s+/i,
  /^PURCHASE\s+/i,
  /^CHECKCARD\s+/i,
  /^RECURRING\s+/i,
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/'S\b/g, "'s");
}

export function cleanMerchant(raw: string): string {
  if (!raw) return raw;
  let s = String(raw).trim();

  // Try known brand match first (anywhere in string)
  for (const [re, brand] of KNOWN) {
    if (re.test(s)) return brand;
  }

  // Strip processor/channel prefixes
  for (const re of PREFIXES) s = s.replace(re, "");

  // Drop URLs/domains
  s = s.replace(/\b[\w.-]+\.(com|net|org|io|co|us)(\/\S*)?/gi, "");

  // Drop store numbers, reference IDs, "#1234", "P730740576", trailing alnum codes
  s = s.replace(/#\s*\d+/g, "");
  s = s.replace(/\*[A-Z0-9]{4,}\b/gi, "");
  s = s.replace(/\b[A-Z]\d{6,}\b/g, "");          // e.g. P730740576
  s = s.replace(/\b\d{4,}\b/g, "");               // long numeric codes
  s = s.replace(/\b[A-Z0-9]{8,}\b/g, "");         // long alnum tokens
  s = s.replace(/\b(LLC|INC|CO|CORP|LTD)\b\.?/gi, "");

  // City/state tail: "MAMA'S PIZZA SAN FRANCISCO CA" -> drop trailing 2-letter state and city tokens
  s = s.replace(/\s[A-Z]{2}\s*$/, "");

  // Collapse separators and whitespace
  s = s.replace(/[*_]+/g, " ").replace(/\s+/g, " ").trim();

  if (!s) return raw.trim();

  // Preserve already mixed-case strings (e.g., "LinkedIn"), title-case all-caps
  const isAllCaps = s === s.toUpperCase();
  return isAllCaps ? titleCase(s) : s;
}
