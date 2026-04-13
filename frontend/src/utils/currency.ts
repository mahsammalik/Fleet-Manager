export const formatCurrency = (amount: number, currency: string = "RON"): string => {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatCurrencyWithoutSymbol = (amount: number): string => {
  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/** e.g. 50 → "50 RON", 80.5 → "80,5 RON" (ro-RO, 0–2 decimals). */
export const formatRonAmountLabel = (amount: number): string => {
  return `${new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)} RON`;
};

export const parseCurrency = (value: string): number => {
  return parseFloat(value.replace(/[^0-9.-]+/g, ""));
};

export const getCurrencySymbol = (): string => {
  return "RON";
};

export const getCurrencyCode = (): string => {
  return "RON";
};

export const getCurrencyLocale = (): string => {
  return "ro-RO";
};

