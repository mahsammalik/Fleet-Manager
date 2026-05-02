import type { PoolClient } from "pg";
import type { EarningsPlatform } from "./detectPlatform";
import type { EarningsStagingPayload, NormalizedEarningsRow } from "./normalizeRow";

export async function insertEarningsPreviewStaging(
  client: PoolClient,
  params: {
    orgId: string;
    userId: string;
    fileName: string;
    weekStart: string;
    weekEnd: string;
    platform: EarningsPlatform;
    detectionConfidence: number | undefined;
    filenameDate: string | null;
    headerCount: number;
    rowCount: number;
    normalizedRows: NormalizedEarningsRow[];
    /** Snapshot for commit: Glovo transfer commission base policy. */
    glovoCommissionBaseType?: string;
  },
): Promise<string> {
  const detectionMeta = {
    detectedPlatform: params.platform,
    detectionConfidence: params.detectionConfidence,
    filenameDate: params.filenameDate,
    headerCount: params.headerCount,
    rowCount: params.rowCount,
    ...(params.platform === "glovo" && params.glovoCommissionBaseType
      ? { glovoCommissionBaseType: params.glovoCommissionBaseType }
      : {}),
  };
  const ins = await client.query<{ id: string }>(
    `INSERT INTO earnings_imports (
          organization_id, file_name, import_date, week_start, week_end, platform,
          status, imported_by, detection_meta
        ) VALUES ($1, $2, CURRENT_DATE, $3::date, $4::date, $5, 'preview', $6::uuid, $7::jsonb)
        RETURNING id`,
    [
      params.orgId,
      params.fileName,
      params.weekStart,
      params.weekEnd,
      params.platform,
      params.userId,
      JSON.stringify(detectionMeta),
    ],
  );
  const importId = ins.rows[0]?.id;
  if (!importId) throw new Error("Failed to create earnings import");

  const chunk = 250;
  for (let i = 0; i < params.normalizedRows.length; i += chunk) {
    const slice = params.normalizedRows.slice(i, i + chunk);
    const values: unknown[] = [];
    const ph: string[] = [];
    let p = 1;
    for (let j = 0; j < slice.length; j++) {
      const rowIndex = i + j;
      const r = slice[j];
      const payload: EarningsStagingPayload = {
        tripDateIso: r.tripDateIso,
        hints: r.hints,
        amounts: r.amounts,
        rawSample: r.rawSample,
      };
      ph.push(`($${p++}, $${p++}, $${p++}, $${p++}::jsonb)`);
      values.push(params.orgId, importId, rowIndex, JSON.stringify(payload));
    }
    await client.query(
      `INSERT INTO earnings_import_staging (organization_id, import_id, row_index, payload) VALUES ${ph.join(",")}`,
      values,
    );
  }

  return importId;
}
