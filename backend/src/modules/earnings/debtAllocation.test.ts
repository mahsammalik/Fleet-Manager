import { describe, expect, it } from "vitest";
import { nextRemainingForNegativePayoutRow } from "./debtAllocation";

describe("nextRemainingForNegativePayoutRow", () => {
  it("returns 0 for hold with zero remaining (forgiven)", () => {
    expect(
      nextRemainingForNegativePayoutRow({ debtAmount: 100, existingRem: 0, paymentStatus: "hold" }),
    ).toBe(0);
  });

  it("uses full period debt when existing remaining is zero and not hold-forgiven", () => {
    expect(
      nextRemainingForNegativePayoutRow({ debtAmount: 100, existingRem: 0, paymentStatus: "debt" }),
    ).toBe(100);
  });

  it("preserves partial forgiveness (remaining below period debt)", () => {
    expect(
      nextRemainingForNegativePayoutRow({ debtAmount: 100, existingRem: 50, paymentStatus: "debt" }),
    ).toBe(50);
  });

  it("preserves manually increased remaining above period shortfall", () => {
    expect(
      nextRemainingForNegativePayoutRow({ debtAmount: 100, existingRem: 120, paymentStatus: "debt" }),
    ).toBe(120);
  });

  it("clamps partial remaining to period debt when below cap", () => {
    expect(nextRemainingForNegativePayoutRow({ debtAmount: 100, existingRem: 33.33, paymentStatus: "debt" })).toBe(
      33.33,
    );
  });
});
