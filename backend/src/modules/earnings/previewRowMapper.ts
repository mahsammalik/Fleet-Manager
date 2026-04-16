import type { EarningsPlatform } from "./detectPlatform";
import type { DriverMatchIndex } from "./matchDriver";
import type { EarningsStagingPayload } from "./normalizeRow";

/** Shape returned to the earnings import preview UI (matches frontend EarningsPreviewRow). */
export type EarningsPreviewRowDto = {
  rowIndex: number;
  tripDate: string | null;
  gross: number | null;
  net: number | null;
  transferTotal: number | null;
  platformFee: number | null;
  dailyCash: number | null;
  accountOpeningFee: number | null;
  tripCount: number | null;
  matchMethod: string;
  driverMatched: boolean;
  hints: {
    courierId?: string;
    phone?: string;
    plate?: string;
  };
};

export function stagingPayloadToPreviewRow(
  rowIndex: number,
  p: EarningsStagingPayload,
  platform: EarningsPlatform,
  index: DriverMatchIndex,
): EarningsPreviewRowDto {
  const { driverId, matchMethod } = index.match(platform, p.hints);
  return {
    rowIndex,
    tripDate: p.tripDateIso,
    gross: p.amounts.gross,
    net: p.amounts.net,
    transferTotal: p.amounts.transferTotal,
    platformFee: p.amounts.platformFee,
    dailyCash: p.amounts.dailyCash,
    accountOpeningFee: p.amounts.accountOpeningFee,
    tripCount: p.amounts.tripCount,
    matchMethod,
    driverMatched: !!driverId,
    hints: p.hints,
  };
}
