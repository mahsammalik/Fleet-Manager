/** Labels for `earnings_records.platform` / `earnings_imports.platform` (DB CHECK). */
const EARNINGS_PLATFORM_LABELS: Record<string, string> = {
  uber: "Uber",
  bolt: "Bolt",
  glovo: "Glovo Courier",
  bolt_courier: "Bolt Courier",
  wolt_courier: "Wolt Courier",
};

export function earningsPlatformLabel(code: string | null | undefined): string {
  if (code == null || String(code).trim() === "") return "—";
  const c = String(code).trim();
  return EARNINGS_PLATFORM_LABELS[c] ?? c;
}
