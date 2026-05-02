import { describe, expect, it } from "vitest";
import {
  calculatePayout,
  netIncomeFromGrossAndTaxa,
  resolveFleetCommissionBase,
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

describe("resolveFleetCommissionBase", () => {
  it("uses platform net for net_income (ignores TVT)", () => {
    const b = resolveFleetCommissionBase({
      income: 100,
      tips: 5,
      taxa_aplicatie: 3,
      plata_zilnica_cash: 0,
      transferTotal: 999,
      resolvedPlatformNet: 50,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(b).toBe(102);
  });

  it("uses gross for gross_income", () => {
    const b = resolveFleetCommissionBase({
      income: 100,
      tips: 5,
      taxa_aplicatie: 3,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: null,
      driver: driverPct10,
      commission_base_type: "gross_income",
    });
    expect(b).toBe(105);
  });
});

describe("calculatePayout", () => {
  it("uses net_income for commission and subtracts daily cash", () => {
    const r = calculatePayout({
      income: 100,
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
    expect(r.company_commission).toBeCloseTo(10.2, 5);
    expect(r.driver_payout).toBeCloseTo(71.8, 5);
    expect(r.commission_rate).toBeCloseTo(0.1, 5);
  });

  it("commission ignores TVT ladder for percentage (uses gross+tips and taxa only)", () => {
    const r = calculatePayout({
      income: 100,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: 0,
      transferTotal: -50,
      resolvedPlatformNet: 100,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(r.net_income).toBe(100);
    expect(r.company_commission).toBeCloseTo(10, 5);
    expect(r.driver_payout).toBeCloseTo(90, 5);
  });

  it("gross_income base charges on gross while payout uses platform net", () => {
    const r = calculatePayout({
      income: 100,
      tips: 5,
      taxa_aplicatie: 3,
      plata_zilnica_cash: 0,
      transferTotal: null,
      resolvedPlatformNet: 102,
      driver: driverPct10,
      commission_base_type: "gross_income",
    });
    expect(r.net_income).toBe(102);
    expect(r.commission_base).toBe(105);
    expect(r.company_commission).toBeCloseTo(10.5, 5);
    expect(r.driver_payout).toBeCloseTo(91.5, 5);
  });

  it("treats negative daily cash same as positive deduction (ABS)", () => {
    const r = calculatePayout({
      income: 100,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: -200,
      transferTotal: null,
      resolvedPlatformNet: 100,
      driver: driverPct10,
      commission_base_type: "net_income",
    });
    expect(r.company_commission).toBeCloseTo(10, 5);
    expect(r.driver_payout).toBeCloseTo(-110, 5);
  });

  it("matches Excel-style row: net 13.09, 10% on net, daily cash -96.16", () => {
    const driver10: DriverCommissionRow = {
      commission_type: "percentage",
      commission_rate: "10",
      fixed_commission_amount: null,
      minimum_commission: null,
    };
    const r = calculatePayout({
      income: 13.09,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: -96.16,
      transferTotal: null,
      resolvedPlatformNet: 13.09,
      driver: driver10,
      commission_base_type: "net_income",
    });
    expect(r.net_income).toBeCloseTo(13.09, 5);
    expect(r.company_commission).toBeCloseTo(1.31, 5);
    expect(r.driver_payout).toBeCloseTo(-84.38, 5);
  });

  it("fixed_amount commission ignores net for percentage but uses fixed charge", () => {
    const driverFixed: DriverCommissionRow = {
      commission_type: "fixed_amount",
      commission_rate: "10",
      fixed_commission_amount: "25",
      minimum_commission: null,
    };
    const r = calculatePayout({
      income: 100,
      tips: 0,
      taxa_aplicatie: 0,
      plata_zilnica_cash: 0,
      transferTotal: 100,
      resolvedPlatformNet: null,
      driver: driverFixed,
    });
    expect(r.company_commission).toBe(25);
    expect(r.net_income).toBe(100);
    expect(r.driver_payout).toBeCloseTo(75, 5);
  });
});
