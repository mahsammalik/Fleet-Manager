import { describe, expect, it } from "vitest";
import { parseListSort } from "./listSort";

const FIELDS = { name: "d.last_name", created_at: "d.created_at" };

describe("parseListSort", () => {
  it("defaults when sort params omitted", () => {
    const r = parseListSort({}, FIELDS, ["d.created_at"], "desc", "d.id ASC");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orderByClause).toContain("d.created_at DESC");
      expect(r.orderByClause).toContain("d.id ASC");
    }
  });

  it("rejects invalid sort_by", () => {
    const r = parseListSort({ sort_by: "evil" }, FIELDS, ["d.created_at"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Invalid sort_by");
  });

  it("rejects invalid sort_order", () => {
    const r = parseListSort({ sort_by: "name", sort_order: "sideways" }, FIELDS, ["d.created_at"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Invalid sort_order");
  });

  it("applies asc when sort_order omitted", () => {
    const r = parseListSort({ sort_by: "name" }, FIELDS, ["d.created_at"], "desc", "d.id ASC");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orderByClause).toContain("d.last_name ASC");
    }
  });
});
