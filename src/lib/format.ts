export const fmtCurrency = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

export const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const fmtMonthYear = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
