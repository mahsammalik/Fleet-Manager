/** Extract first plausible date from filename for default trip_date fallback. */
export function extractDateFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/i, "");
  const patterns: RegExp[] = [
    /(20\d{2})[-_](\d{2})[-_](\d{2})/,
    /(\d{2})[-_](\d{2})[-_](20\d{2})/,
    /(20\d{2})(\d{2})(\d{2})/,
  ];
  for (const re of patterns) {
    const m = base.match(re);
    if (!m) continue;
    let y: number;
    let mo: number;
    let d: number;
    if (re === patterns[1]) {
      d = parseInt(m[1], 10);
      mo = parseInt(m[2], 10);
      y = parseInt(m[3], 10);
    } else if (re === patterns[2]) {
      y = parseInt(m[1], 10);
      mo = parseInt(m[2], 10);
      d = parseInt(m[3], 10);
    } else {
      y = parseInt(m[1], 10);
      mo = parseInt(m[2], 10);
      d = parseInt(m[3], 10);
    }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

function startOfWeekUtc(d: Date): Date {
  const c = new Date(d);
  const day = c.getUTCDay();
  const diff = (day + 6) % 7;
  c.setUTCDate(c.getUTCDate() - diff);
  return c;
}

function endOfWeekUtc(d: Date): Date {
  const s = startOfWeekUtc(d);
  const e = new Date(s);
  e.setUTCDate(s.getUTCDate() + 6);
  return e;
}

/** Monday of the week of the earliest date through Sunday of the week of the latest date. */
export function weekBoundsFromDates(dates: string[]): { weekStart: string; weekEnd: string } {
  const valid = dates.filter(Boolean).sort();
  if (valid.length === 0) {
    const d = new Date().toISOString().slice(0, 10);
    return { weekStart: d, weekEnd: d };
  }
  const min = new Date(`${valid[0]}T12:00:00Z`);
  const max = new Date(`${valid[valid.length - 1]}T12:00:00Z`);
  const ws = startOfWeekUtc(min);
  const we = endOfWeekUtc(max);
  return {
    weekStart: ws.toISOString().slice(0, 10),
    weekEnd: we.toISOString().slice(0, 10),
  };
}
