export type CanonicalField =
  | "plate"
  | "phone"
  | "courier_id"
  | "trip_date"
  | "gross"
  | "platform_fee"
  | "net"
  | "transfer_total"
  | "daily_cash"
  | "account_opening_fee"
  | "trips";

export interface RowHints {
  courierId?: string;
  phone?: string;
  plate?: string;
}

export interface NormalizedAmounts {
  gross: number | null;
  net: number | null;
  platformFee: number | null;
  /** Total Venituri de transferat (TVT); commission transfer base when present. */
  transferTotal: number | null;
  dailyCash: number | null;
  /** Magnitude only; CSV may show negative (e.g. -71.44). */
  accountOpeningFee: number | null;
  tripCount: number | null;
}

export interface NormalizedEarningsRow {
  tripDateIso: string | null;
  hints: RowHints;
  amounts: NormalizedAmounts;
  rawSample: Record<string, string>;
}

/** Persisted in earnings_import_staging.payload */
export interface EarningsStagingPayload {
  tripDateIso: string | null;
  hints: RowHints;
  amounts: NormalizedAmounts;
  rawSample: Record<string, string>;
}

function parseRoNumber(s: string): number | null {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseRoDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(t);
  if (iso) return iso[0];
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(t);
  if (dmy) {
    let d = parseInt(dmy[1], 10);
    let m = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) {
      const tmp = d;
      d = m;
      m = tmp;
    }
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function cleanHint(s: string): string | undefined {
  const v = s.trim();
  return v.length ? v : undefined;
}

export interface RowNormalizeOptions {
  /**
   * When set (e.g. Glovo), do not set platformFee from |gross - net|.
   * That difference is often the “Ajustări” bucket, not Taxa aplicatie.
   */
  skipInferredPlatformFee?: boolean;
}

export function rowCellsToNormalized(
  cells: string[],
  colMap: Map<number, CanonicalField>,
  fallbackTripDate: string | null,
  opts?: RowNormalizeOptions,
): NormalizedEarningsRow {
  const hints: RowHints = {};
  let tripDateIso: string | null = null;
  const amounts: NormalizedAmounts = {
    gross: null,
    net: null,
    platformFee: null,
    transferTotal: null,
    dailyCash: null,
    accountOpeningFee: null,
    tripCount: null,
  };
  const rawSample: Record<string, string> = {};

  colMap.forEach((field, idx) => {
    const raw = String(cells[idx] ?? "").trim();
    if (raw) rawSample[field] = raw;
    switch (field) {
      case "plate":
        hints.plate = cleanHint(raw);
        break;
      case "phone":
        hints.phone = cleanHint(raw);
        break;
      case "courier_id":
        hints.courierId = cleanHint(raw);
        break;
      case "trip_date":
        tripDateIso = parseRoDate(raw) ?? tripDateIso;
        break;
      case "gross":
        amounts.gross = parseRoNumber(raw);
        break;
      case "net":
        amounts.net = parseRoNumber(raw);
        break;
      case "transfer_total": {
        const v = parseRoNumber(raw);
        amounts.transferTotal = v === null ? null : Math.abs(v);
        break;
      }
      case "platform_fee": {
        const v = parseRoNumber(raw);
        // Exports may show platform fee as negative; store magnitude as positive.
        amounts.platformFee = v === null ? null : Math.abs(v);
        break;
      }
      case "daily_cash":
        amounts.dailyCash = parseRoNumber(raw);
        break;
      case "account_opening_fee": {
        const v = parseRoNumber(raw);
        amounts.accountOpeningFee = v === null ? null : Math.abs(v);
        break;
      }
      case "trips":
        amounts.tripCount = parseRoNumber(raw);
        if (amounts.tripCount !== null) amounts.tripCount = Math.round(amounts.tripCount);
        break;
      default:
        break;
    }
  });

  if (!tripDateIso && fallbackTripDate) tripDateIso = fallbackTripDate;

  if (amounts.gross === null && amounts.net !== null && amounts.platformFee !== null) {
    amounts.gross = amounts.net + amounts.platformFee;
  }
  if (amounts.net === null && amounts.gross !== null && amounts.platformFee !== null) {
    amounts.net = amounts.gross - amounts.platformFee;
  }
  if (
    !opts?.skipInferredPlatformFee &&
    amounts.platformFee === null &&
    amounts.gross !== null &&
    amounts.net !== null
  ) {
    amounts.platformFee = Math.abs(amounts.gross - amounts.net);
  }

  if (amounts.platformFee !== null && amounts.platformFee < 0) {
    amounts.platformFee = Math.abs(amounts.platformFee);
  }

  return { tripDateIso, hints, amounts, rawSample };
}
