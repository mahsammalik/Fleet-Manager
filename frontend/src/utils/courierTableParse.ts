import { formatRonAmountLabel } from "./currency";

export interface CourierTableRow {
  date: string;
  gross: string;
  net: string;
  fee: string;
  match: string;
  driver: string;
}

/** Dual commission row: Commission1 (Total Venituri de transferat), Commission2 (Plata zilnica cu cash). */
export interface DualCommissionCourierRow {
  date: string;
  gross: string;
  net: string;
  commission1: string;
  commission2: string;
  totalCommission: string;
  match: string;
  driver: string;
}

const AJUSTARI = /ajustari\s+totale/i;

/** ISO date only — do not merge with next RON chunk. */
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/**
 * Split CSV line where EU amounts use: thousands `.` and decimal `,` before ` RON`
 * (e.g. `2.432,30 RON` → one field).
 */
export function splitCourierCsvLine(line: string): string[] {
  const parts = line.split(",").map((s) => s.trim());
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (isIsoDate(p)) {
      out.push(p);
      i += 1;
      continue;
    }
    if (
      i + 1 < parts.length &&
      !/\sRON$/i.test(p) &&
      /^[-+]?\d/.test(p) &&
      /\s*RON\s*$/i.test(parts[i + 1])
    ) {
      out.push(`${p},${parts[i + 1]}`);
      i += 2;
      continue;
    }
    out.push(p);
    i += 1;
  }
  return out;
}

export function shouldSkipCourierLine(line: string): boolean {
  return AJUSTARI.test(line.trim());
}

export function parseCourierTableRow(line: string): { ok: true; row: CourierTableRow } | { ok: false; error: string } {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, error: "Empty row" };
  if (shouldSkipCourierLine(trimmed)) return { ok: false, error: "Skipped: Ajustari Totale" };

  let fields = splitCourierCsvLine(trimmed);
  if (fields.length < 6) {
    return { ok: false, error: `Expected 6 columns, got ${fields.length}: ${trimmed.slice(0, 80)}…` };
  }
  if (fields.length > 6) {
    fields = [...fields.slice(0, 5), fields.slice(5).join(",")];
  }

  const [date, gross, net, fee, match, driver] = fields;
  return {
    ok: true,
    row: { date, gross, net, fee, match, driver },
  };
}

export function parseCourierRawData(rawLines: string[]): {
  rows: CourierTableRow[];
  errors: string[];
} {
  const rows: CourierTableRow[] = [];
  const errors: string[] = [];

  rawLines.forEach((line, idx) => {
    const r = parseCourierTableRow(line);
    if (r.ok) rows.push(r.row);
    else if (!r.error.startsWith("Skipped:")) errors.push(`Line ${idx + 1}: ${r.error}`);
  });

  return { rows, errors };
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** RO amounts: optional thousands `.`, optional `,` as decimal separator. */
export function parseRoNumberCell(s: string): number | null {
  let t = s.trim().replace(/\s/g, "");
  if (!t || t === "-") return null;
  const comma = t.indexOf(",");
  const dot = t.indexOf(".");
  if (comma !== -1 && comma > dot) {
    t = `${t.slice(0, comma).replace(/\./g, "")}.${t.slice(comma + 1)}`;
  } else if (comma !== -1 && dot === -1) {
    t = t.replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const COLON_RON = /:\s*(.+?)\s*RON\s*$/i;
const PLAIN_RON = /^([-+]?[\d.\s]+(?:,\d+)?)\s*RON\s*$/i;

/**
 * Extract numeric amount from "Label: 50 RON" or plain "50 RON".
 * `labelNormSnippet` is lowercased ASCII (e.g. "total venituri de transferat").
 */
export function extractCommissionFromCell(raw: string, labelNormSnippet: string): { display: string; amount: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { display: "—", amount: null };

  const norm = stripDiacritics(trimmed);
  const hasLabel = norm.includes(labelNormSnippet);

  let amountStr: string | null = null;
  const colon = COLON_RON.exec(trimmed);
  // Prefer "Label: N RON" only when the cell actually contains the expected label (TVT / cash).
  if (colon && hasLabel) amountStr = colon[1].trim();
  else if (PLAIN_RON.test(trimmed)) {
    const plain = PLAIN_RON.exec(trimmed);
    if (plain) amountStr = plain[1].trim();
  }

  if (amountStr !== null) {
    const n = parseRoNumberCell(amountStr);
    if (n !== null) return { display: formatRonAmountLabel(n), amount: n };
  }

  return { display: trimmed, amount: null };
}

const LABEL_TVT = "total venituri de transferat";
const LABEL_CASH = "plata zilnica cu cash";

function buildDualRow(
  date: string,
  gross: string,
  net: string,
  rawC1: string,
  rawC2: string,
  match: string,
  driver: string,
): DualCommissionCourierRow {
  const c1 = extractCommissionFromCell(rawC1, LABEL_TVT);
  const c2 = extractCommissionFromCell(rawC2, LABEL_CASH);
  const n1 = c1.amount;
  const n2 = c2.amount;

  const commission1 = c1.display;
  const commission2 = c2.display;

  let totalCommission: string;
  if (n1 === null && n2 === null) {
    totalCommission = "—";
  } else {
    const sum = (n1 ?? 0) + (n2 ?? 0);
    totalCommission = formatRonAmountLabel(sum);
  }

  return {
    date,
    gross,
    net,
    commission1,
    commission2,
    totalCommission,
    match,
    driver,
  };
}

export function parseCourierDualCommissionRow(
  line: string,
): { ok: true; row: DualCommissionCourierRow } | { ok: false; error: string } {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, error: "Empty row" };
  if (shouldSkipCourierLine(trimmed)) return { ok: false, error: "Skipped: Ajustari Totale" };

  let fields = splitCourierCsvLine(trimmed);

  if (fields.length >= 7) {
    if (fields.length > 7) {
      fields = [...fields.slice(0, 6), fields.slice(6).join(",")];
    }
    const [date, gross, net, rawC1, rawC2, match, driver] = fields;
    return { ok: true, row: buildDualRow(date, gross, net, rawC1, rawC2, match, driver) };
  }

  if (fields.length === 6) {
    const [date, gross, net, legacyFee, match, driver] = fields;
    const c2 = extractCommissionFromCell(legacyFee, LABEL_CASH);
    const n2 = c2.amount;
    let totalCommission: string;
    if (n2 === null) totalCommission = "—";
    else totalCommission = formatRonAmountLabel(n2);

    return {
      ok: true,
      row: {
        date,
        gross,
        net,
        commission1: "—",
        commission2: c2.display,
        totalCommission,
        match,
        driver,
      },
    };
  }

  return {
    ok: false,
    error: `Expected 6 or 7 columns, got ${fields.length}: ${trimmed.slice(0, 80)}…`,
  };
}

export function parseCourierDualRawData(rawLines: string[]): {
  rows: DualCommissionCourierRow[];
  errors: string[];
} {
  const rows: DualCommissionCourierRow[] = [];
  const errors: string[] = [];

  rawLines.forEach((line, idx) => {
    const r = parseCourierDualCommissionRow(line);
    if (r.ok) rows.push(r.row);
    else if (!r.error.startsWith("Skipped:")) errors.push(`Line ${idx + 1}: ${r.error}`);
  });

  return { rows, errors };
}
