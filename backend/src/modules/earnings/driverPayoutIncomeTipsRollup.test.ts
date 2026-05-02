import { describe, expect, it } from "vitest";

/**
 * Mirrors per-driver accumulation in earningsCommit: income from row gross,
 * tips from row tips; DB exposes total_gross_earnings as GENERATED (income + tips).
 */
function rollupDriverPayoutComponents(rows: { gross: number | null; tips: number | null }[]): {
  income: number;
  tips: number;
  totalGross: number;
} {
  let income = 0;
  let tips = 0;
  for (const r of rows) {
    income += r.gross ?? 0;
    tips += r.tips ?? 0;
  }
  return { income, tips, totalGross: income + tips };
}

describe("driver_payout income / tips rollup", () => {
  it("sums income and tips; total gross equals income + tips", () => {
    const r = rollupDriverPayoutComponents([
      { gross: 100, tips: 5 },
      { gross: 20, tips: null },
      { gross: null, tips: 3 },
    ]);
    expect(r.income).toBe(120);
    expect(r.tips).toBe(8);
    expect(r.totalGross).toBe(128);
    expect(r.totalGross).toBe(r.income + r.tips);
  });

  it("handles empty input", () => {
    expect(rollupDriverPayoutComponents([])).toEqual({ income: 0, tips: 0, totalGross: 0 });
  });
});
