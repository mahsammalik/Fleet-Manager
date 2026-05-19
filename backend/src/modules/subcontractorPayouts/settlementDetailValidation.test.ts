import { describe, expect, it } from "vitest";
import { validateSettlementDetail } from "./settlementDetailValidation";

describe("validateSettlementDetail", () => {
  const parent = {
    gross_incl_tips: 1000,
    tips: 100,
    commission: 50,
    vehicle_rent: 200,
    account_opening_fee: 10,
    platform_fees: 50,
    daily_cash: 20,
    payable: 670,
  };

  it("matches when driver sums equal parent totals", () => {
    const drivers = [
      {
        gross: 600,
        tips: 60,
        commission: 30,
        vehicle_rent: 120,
        account_opening_fee: 6,
        platform_fees: 30,
        daily_cash: 12,
        net: 402,
      },
      {
        gross: 400,
        tips: 40,
        commission: 20,
        vehicle_rent: 80,
        account_opening_fee: 4,
        platform_fees: 20,
        daily_cash: 8,
        net: 268,
      },
    ];
    const v = validateSettlementDetail(drivers, parent);
    expect(v.matched).toBe(true);
    expect(v.totals_matched).toBe(true);
    expect(Math.abs(v.difference)).toBeLessThanOrEqual(0.01);
  });

  it("flags net mismatch beyond tolerance", () => {
    const drivers = [
      {
        gross: 1000,
        tips: 100,
        commission: 50,
        vehicle_rent: 200,
        account_opening_fee: 10,
        platform_fees: 50,
        daily_cash: 20,
        net: 600,
      },
    ];
    const v = validateSettlementDetail(drivers, parent);
    expect(v.matched).toBe(false);
    expect(v.difference).toBe(-70);
  });

  it("flags column totals mismatch", () => {
    const drivers = [
      {
        gross: 500,
        tips: 100,
        commission: 50,
        vehicle_rent: 200,
        account_opening_fee: 10,
        platform_fees: 50,
        daily_cash: 20,
        net: 670,
      },
    ];
    const v = validateSettlementDetail(drivers, parent);
    expect(v.matched).toBe(true);
    expect(v.totals_matched).toBe(false);
    expect(v.totals_difference).toBeGreaterThan(0.01);
  });
});
