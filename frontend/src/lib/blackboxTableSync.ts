import type { CourierTableRow } from "../utils/courierTableParse";

export const DEFAULT_BLACKBOX_CHAT_ID = "dI1nCuH";

const LS_MIRROR_KEY = (chatId: string) => `blackbox:table-mirror:${chatId}`;

/** Last successful remote payload mirror (survives only while LS not cleared). */
export function readBlackboxMirror(chatId: string): CourierTableRow[] | null {
  try {
    const raw = localStorage.getItem(LS_MIRROR_KEY(chatId));
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    return data as CourierTableRow[];
  } catch {
    return null;
  }
}

export function writeBlackboxMirror(chatId: string, rows: CourierTableRow[]): void {
  try {
    localStorage.setItem(LS_MIRROR_KEY(chatId), JSON.stringify(rows));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Optional server sync. Set `VITE_BLACKBOX_TABLE_SYNC_URL` to your Blackbox/webhook endpoint.
 * Body: `{ chatId, rows, updatedAt }`
 */
export async function syncCourierRowsToBlackbox(
  chatId: string,
  rows: CourierTableRow[],
): Promise<{ ok: boolean; error?: string }> {
  const endpoint = import.meta.env.VITE_BLACKBOX_TABLE_SYNC_URL as string | undefined;
  writeBlackboxMirror(chatId, rows);

  if (!endpoint?.trim()) {
    return { ok: true };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        rows,
        updatedAt: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: t || res.statusText };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Blackbox sync failed",
    };
  }
}
