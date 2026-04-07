export interface CourierTableRow {
  date: string;
  gross: string;
  net: string;
  fee: string;
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
      /^\d/.test(p) &&
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
