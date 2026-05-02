import type { CanonicalField } from "./normalizeRow";

/** Normalize header for alias lookup (Romanian diacritics, spacing). */
export function normalizeHeaderKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const ALIAS_TO_CANONICAL: Record<string, CanonicalField> = {};

function reg(aliases: string[], field: CanonicalField) {
  for (const a of aliases) {
    ALIAS_TO_CANONICAL[normalizeHeaderKey(a)] = field;
  }
}

reg(
  [
    "numar inmatriculare",
    "nr inmatriculare",
    "nr inmatricularii",
    "inmatriculare",
    "license plate",
    "plate",
    "registration",
    "numar auto",
    "nr auto",
    "vehicle plate",
    "car plate",
  ],
  "plate",
);

reg(
  [
    "telefon",
    "telefon mobil",
    "nr telefon",
    "numar telefon",
    "phone",
    "mobile",
    "driver phone",
    "telephone",
    "email",
  ],
  "phone",
);

reg(
  [
    "id curier",
    "courier id",
    "driver id",
    "driver uuid",
    "uuid",
    "uber uuid",
    "bolt id",
    "id sofer",
    "identificator curier",
    "external id",
    "partner id",
  ],
  "courier_id",
);

reg(
  [
    "data",
    "data cursei",
    "data curse",
    "trip date",
    "date",
    "zi",
    "work date",
    "delivery date",
    "order date",
    "completed at",
    "completed on",
  ],
  "trip_date",
);

reg(
  [
    "venit brut",
    "total brut",
    "gross",
    "gross earnings",
    "fare",
    "total fare",
    "suma brut",
    "incasari brute",
    "pret total",
    "order value",
    "venituri",
  ],
  "gross",
);

reg(
  [
    "comision platforma",
    "taxa aplicatie",
    "taxa de aplicatie",
    "taxa platforma",
    "platform fee",
    "service fee",
    "booking fee",
    "platform commission",
    "fee",
    "comision",
    "taxa serviciu",
  ],
  "platform_fee",
);

reg(
  [
    "venit net",
    "net",
    "net earnings",
    "driver earnings",
    "payout",
    "suma neta",
    "incasari nete",
    "amount net",
    "net amount",
  ],
  "net",
);

reg(
  [
    "total venituri de transfera",
    "total venituri de transferat",
    "total venituri transferat",
  ],
  "transfer_total",
);

reg(
  [
    "plata zilnica cu cash",
    "plata zilnica cu cash com",
    "plata zilnica cash",
    "plata cash",
    "cash zilnic",
    "cash daily",
    "daily cash",
  ],
  "daily_cash",
);

reg(
  [
    "taxa deschidere cont",
    "taxa deschidere de cont",
    "comision deschidere cont",
    "account opening fee",
  ],
  "account_opening_fee",
);

reg(
  [
    "numar curse",
    "nr curse",
    "trips",
    "rides",
    "trip count",
    "deliveries",
    "orders",
    "numar comenzi",
    "bonus numar de comenzi",
  ],
  "trips",
);

reg(
  [
    "tips",
    "tips glovo",
    "bacsi",
    "bacsis",
    "propina",
    "courier tips",
    "driver tips",
  ],
  "tips",
);

/** Map each column index to canonical field (first wins per field). */
export function buildColumnMap(headers: string[]): Map<number, CanonicalField> {
  const map = new Map<number, CanonicalField>();
  const used = new Set<CanonicalField>();
  const norm = headers.map((h) => normalizeHeaderKey(String(h ?? "")));
  // Match "Taxa aplicatie", "Taxa aplicatie Glovo", "Taxa de aplicatie", etc.
  const taxaIdx = norm.findIndex(
    (k) => k.includes("taxa aplicatie") || k.includes("taxa de aplicatie"),
  );
  if (taxaIdx >= 0) {
    map.set(taxaIdx, "platform_fee");
    used.add("platform_fee");
  }
  headers.forEach((h, idx) => {
    const key = norm[idx];
    if (!key) return;
    const canon = ALIAS_TO_CANONICAL[key];
    if (canon && !used.has(canon)) {
      map.set(idx, canon);
      used.add(canon);
    }
  });
  return map;
}

export function resolveHeaderAlias(raw: string): CanonicalField | null {
  const key = normalizeHeaderKey(raw);
  return ALIAS_TO_CANONICAL[key] ?? null;
}
