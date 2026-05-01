import { query } from "../../db/pool";
import { parseCommissionBaseType, type CommissionBaseType } from "./calculatePayout";

export async function readOrgGlovoCommissionBase(orgId: string): Promise<CommissionBaseType> {
  const { rows } = await query<{ settings: unknown }>(
    `SELECT settings FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  const s = (rows[0]?.settings as Record<string, unknown>) ?? {};
  return parseCommissionBaseType(s.glovoCommissionBaseType);
}

export async function writeOrgGlovoCommissionBase(orgId: string, base: CommissionBaseType): Promise<void> {
  await query(
    `UPDATE organizations
     SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('glovoCommissionBaseType', to_jsonb($2::text))
     WHERE id = $1::uuid`,
    [orgId, base],
  );
}
