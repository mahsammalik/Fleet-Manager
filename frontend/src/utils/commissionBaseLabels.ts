/** Human-readable labels for `driver_payouts.commission_base_type` / org Glovo setting. */
export function commissionBaseTypeLabel(raw: string | null | undefined): string {
  switch (raw?.trim()) {
    case "net_income":
      return "Net income (after platform fee)";
    case "gross_income":
      return "Gross income (income + tips)";
    case "net_income_no_tips":
      return "Net income without tips";
    case "gross_income_no_tips":
      return "Base income without tips";
    case "net_income_no_bonuses":
      return "Net income (no bonuses)";
    case "gross_income_no_bonuses":
      return "Gross income (no bonuses)";
    default:
      return raw && raw.trim() ? raw : "Net income (after platform fee)";
  }
}
