import { normalizeHeaderKey } from "./romanHeaderMap";

export type EarningsPlatform = "uber" | "bolt" | "glovo" | "bolt_courier" | "wolt_courier";

export const EARNINGS_PLATFORMS: EarningsPlatform[] = [
  "uber",
  "bolt",
  "glovo",
  "bolt_courier",
  "wolt_courier",
];

export function isEarningsPlatform(s: string): s is EarningsPlatform {
  return EARNINGS_PLATFORMS.includes(s as EarningsPlatform);
}

function zeroScores(): Record<EarningsPlatform, number> {
  return {
    uber: 0,
    bolt: 0,
    glovo: 0,
    bolt_courier: 0,
    wolt_courier: 0,
  };
}

/**
 * Share of total detection score attributed to the winning platform (0–1).
 * Tie or diffuse scores yield values below 1.
 */
export function detectionConfidence(
  scores: Record<EarningsPlatform, number>,
  platform: EarningsPlatform,
): number {
  const best = scores[platform] ?? 0;
  const sum = EARNINGS_PLATFORMS.reduce((a, k) => a + (scores[k] ?? 0), 0);
  if (sum <= 0) return 0.5;
  return Math.min(1, Math.max(0, best / sum));
}

/**
 * Glovo Romania courier weekly export: exact normalized column names (Tier A).
 * Uses equality for the header `venituri` so total-transfer columns do not count as the Venituri column.
 * Total column may be spelled `transferat` (legacy) or `transfera` (V2 export).
 */
export function isGlovoRomaniaCourierExport(norm: string[]): boolean {
  const idCurier = norm.some((h) => h === "id curier");
  const hasVenituriHeader = norm.some((h) => h === "venituri");
  const totalTransfer = norm.some(
    (h) => h === "total venituri de transferat" || h === "total venituri de transfera",
  );
  return idCurier && hasVenituriHeader && totalTransfer;
}

function scoreFilename(name: string): Partial<Record<EarningsPlatform, number>> {
  const n = name.toLowerCase();
  const s: Partial<Record<EarningsPlatform, number>> = {};
  if (n.includes("uber")) s.uber = (s.uber ?? 0) + 3;
  if (n.includes("taxify") || /\bbolt\b/.test(n) || n.includes("bolt driver")) {
    if (n.includes("courier") || n.includes("food") || n.includes("liv")) s.bolt_courier = (s.bolt_courier ?? 0) + 3;
    else s.bolt = (s.bolt ?? 0) + 3;
  }
  if (n.includes("glovo")) s.glovo = (s.glovo ?? 0) + 3;
  if (n.includes("wolt")) s.wolt_courier = (s.wolt_courier ?? 0) + 3;
  return s;
}

function scoreHeaders(norm: string[]): Partial<Record<EarningsPlatform, number>> {
  const joined = norm.join(" ");
  const s: Partial<Record<EarningsPlatform, number>> = {};
  if (joined.includes("uber") || joined.includes("uuid")) s.uber = (s.uber ?? 0) + 1;
  if (joined.includes("bolt") || joined.includes("taxify")) s.bolt = (s.bolt ?? 0) + 1;
  if (joined.includes("glovo")) s.glovo = (s.glovo ?? 0) + 2;
  if (joined.includes("wolt")) s.wolt_courier = (s.wolt_courier ?? 0) + 2;
  if (joined.includes("courier") && joined.includes("delivery")) s.bolt_courier = (s.bolt_courier ?? 0) + 1;
  return s;
}

export function detectPlatformWithMeta(
  fileName: string,
  headers: string[],
): { platform: EarningsPlatform; scores: Record<EarningsPlatform, number>; confidence: number } {
  const norm = headers.map((h) => normalizeHeaderKey(String(h)));
  if (isGlovoRomaniaCourierExport(norm)) {
    const scores = zeroScores();
    scores.glovo = 1000;
    return { platform: "glovo", scores, confidence: 1 };
  }

  const f = scoreFilename(fileName);
  const h = scoreHeaders(norm);
  const scores = zeroScores();
  EARNINGS_PLATFORMS.forEach((k) => {
    scores[k] = (f[k] ?? 0) + (h[k] ?? 0);
  });

  let best: EarningsPlatform = "uber";
  let max = -1;
  EARNINGS_PLATFORMS.forEach((k) => {
    if (scores[k] > max) {
      max = scores[k];
      best = k;
    }
  });

  if (max <= 0) {
    const n = fileName.toLowerCase();
    if (n.includes("glovo")) {
      scores.glovo += 10;
      best = "glovo";
    } else if (n.includes("wolt")) {
      scores.wolt_courier += 10;
      best = "wolt_courier";
    } else if (n.includes("bolt")) {
      scores.bolt += 10;
      best = "bolt";
    } else {
      scores.uber += 1;
      best = "uber";
    }
  }

  const confidence = detectionConfidence(scores, best);
  return { platform: best, scores, confidence };
}

export function detectPlatform(fileName: string, headers: string[]): EarningsPlatform {
  return detectPlatformWithMeta(fileName, headers).platform;
}
