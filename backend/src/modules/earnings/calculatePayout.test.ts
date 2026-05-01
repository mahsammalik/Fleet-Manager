import { describe, expect, it } from "vitest";
import {
  calculatePayout,
  netIncomeFromGrossAndTaxa,
  resolveTransferCommissionBase,
} from "./calculatePayout";
import type { DriverCommissionRow } from "./commission";

const driverPct10: DriverCommissionRow = {
  commission_type: "percentage",
  commission_rate: "10",
  fixed_commission_amount: null,
  minimum_commission: null,
};

describe("netIncomeFromGrossAndTaxa", () => {
  it("matches business examples for positive and negative Taxa aplicatie", () => {
    const gross = 670.88;
    expect(netIncomeFromGrossAndTaxa(gross, 8.99)).toBeCloseTo(661.89, 5);
    expect(netIncomeFromGrossAndTaxa(gross, -8.99)).toBeCloseTo(661.89, 5);
  });

  it("treats null taxa as zero", () => {
    expect(netIncomeFromGrossAndTaxa(100, null)).toBe(100);
    expect(netIncomeFromGrossAndTaxa(100, undefined)).toBe(100);
  });
});

describe("calculatePayout", () => {
  it("preserves legacy net_income transfer chain and dual-leg payout", () => {
    const r = calculatePayout({
      venituri: 100,
      tips: 5,
      taxa_aplicatie: 3,
      plata_zilnica_cash: 20,
      transferTotal: null,
      resolvedPlatformNet: 102,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(r.gross_income).toBe(105);
    expect(r.net_income).toBe(102);
    expect(r.commission_base).toBe(102);
    expect(r.transfer_commission).toBeCloseTo(10.2, 5);
    expect(r.cash_commission).toBeCloseTo(2, 5);
    expect(r.driver_payout).toBeCloseTo(89.8, 5);
    expect(r.commission_rate).toBeCloseTo(0.1, 5);
  });

  it("uses gross_income (venituri + tips) as transfer commission base when set", () => {
    const r = calculatePayout({
      venituri: 100,
      tips: 5,
      taxa_aplicatie: 3,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: 102,
      driver: driverPct10,
      commission_base_type: "gross_income",
    });
    expect(r.commission_base).toBe(105);
    expect(r.driver_payout).toBeCloseTo(94.5, 5);
  });

  it("prefers TVT over CSV net for net_income base", () => {
    const b = resolveTransferCommissionBase({
      venituri: 10,
      tips: 1,
      taxa_aplicatie: 1,
      plata_zilnica_cash: 0,
      transferTotal: 999,
      resolvedPlatformNet: 50,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(b).toBe(999);
  });

  it("handles negative TVT (signed transfer commission)", () => {
    const r = calculatePayout({
      venituri: 100,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: 0,
      transferTotal: -50,
      resolvedPlatformNet: 100,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(r.commission_base).toBe(-50);
    expect(r.transfer_commission).toBeCloseTo(-5, 5);
    expect(r.driver_payout).toBeCloseTo(-45, 5);
  });

  it("net_income uses sign rule when Taxa aplicatie is negative", () => {
    const r = calculatePayout({
      venituri: 670.88,
      tips: 0,
      taxa_aplicatie: -8.99,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: 650,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(r.gross_income).toBeCloseTo(670.88, 5);
    expect(r.net_income).toBeCloseTo(661.89, 5);
  });

  it("net_income_no_bonuses base uses sign rule for negative taxa (not gross - taxa)", () => {
    const base = resolveTransferCommissionBase({
      venituri: 670.88,
      tips: 0,
      taxa_aplicatie: -8.99,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: null,
      driver: driverPct10,
      commission_base_type: "net_income_no_bonuses",
    });
    expect(base).toBeCloseTo(661.89, 5);
  });

  it("net_income_no_tips base applies taxa to venituri only with sign rule", () => {
    const base = resolveTransferCommissionBase({
      venituri: 100,
      tips: 50,
      taxa_aplicatie: -10,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: null,
      driver: driverPct10,
      commission_base_type: "net_income_no_tips",
    });
    expect(base).toBe(90);
  });

  it("fixed_amount commission ignores percentage legs in stored components", () => {
    const driverFixed: DriverCommissionRow = {
      commission_type: "fixed_amount",
      commission_rate: "10",
      fixed_commission_amount: "25",
      minimum_commission: null,
    };
    const r = calculatePayout({
      venituri: 100,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: 0,
      transferTotal: 100,
      resolvedPlatformNet: null,
      driver: driverFixed,
    });
    expect(r.company_commission).toBe(25);
    expect(r.driver_payout).toBe(100);
  });
});
