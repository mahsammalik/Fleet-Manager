export type SortOrder = "asc" | "desc";

export type ListSortField = string | readonly string[];

export type ListSortResult =
  | { ok: true; orderByClause: string }
  | { ok: false; status: 400; message: string };

export type ListSortQuery = {
  sort_by?: string;
  sort_order?: string;
};

function normalizeOrder(raw: string | undefined, sortByPresent: boolean): SortOrder | null {
  if (!raw) {
    return sortByPresent ? "asc" : null;
  }
  const lower = raw.trim().toLowerCase();
  if (lower === "asc" || lower === "desc") {
    return lower;
  }
  return null;
}

function sqlDirection(order: SortOrder): "ASC" | "DESC" {
  return order === "asc" ? "ASC" : "DESC";
}

function orderExpr(expr: string, order: SortOrder): string {
  return `${expr} ${sqlDirection(order)} NULLS LAST`;
}

/**
 * Builds a safe ORDER BY clause from whitelisted field expressions.
 * When sort params are omitted, uses defaultField/defaultOrder.
 */
export function parseListSort(
  query: ListSortQuery,
  fieldMap: Record<string, ListSortField>,
  defaultExprs: readonly string[],
  defaultOrder: SortOrder = "desc",
  tieBreakExpr = "id ASC",
): ListSortResult {
  const sortByRaw = query.sort_by?.trim();
  const hasSortBy = Boolean(sortByRaw);

  if (!hasSortBy) {
    const dir = sqlDirection(defaultOrder);
    const parts = defaultExprs.map((e) => `${e} ${dir} NULLS LAST`);
    parts.push(tieBreakExpr);
    return { ok: true, orderByClause: `ORDER BY ${parts.join(", ")}` };
  }

  const sortBy = sortByRaw!;
  const mapped = fieldMap[sortBy];
  if (!mapped) {
    return { ok: false, status: 400, message: "Invalid sort_by" };
  }

  const order = normalizeOrder(query.sort_order, true);
  if (!order) {
    return { ok: false, status: 400, message: "Invalid sort_order" };
  }

  const exprs = typeof mapped === "string" ? [mapped] : [...mapped];
  const parts = exprs.map((e) => orderExpr(e, order));
  parts.push(tieBreakExpr);
  return { ok: true, orderByClause: `ORDER BY ${parts.join(", ")}` };
}
