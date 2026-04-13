import path from "path";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import pdfParse from "pdf-parse";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Glovo / RO exports often use comma as CSV separator AND comma as decimal separator
 * (e.g. 2.432,30). Naive comma-split shifts columns so "Fee" reads Ajustari Totale instead of Taxa aplicatie.
 */
function mergeEuropeanCommaDecimalFields(parts: string[], targetLen: number): string[] {
  if (parts.length <= targetLen || targetLen <= 0) return parts;
  const cells = [...parts];
  let guard = 0;
  while (cells.length > targetLen && guard < cells.length * 4) {
    guard += 1;
    let merged = false;
    for (let i = 0; i < cells.length - 1; i++) {
      const L = cells[i].trim();
      const R = cells[i + 1].trim();
      if (L === "" || R === "") continue;
      if (L === "0" && R === "0") continue;
      const Lc = L.replace(/\s/g, "");
      const Rc = R.replace(/\s/g, "");
      if (!/^\d{1,2}$/.test(Rc)) continue;
      if (Rc === "0") continue;
      const thousandsAndCents = /^-?\d{1,3}(\.\d{3})+$/.test(Lc);
      if (thousandsAndCents) {
        cells.splice(i, 2, `${L},${R}`);
        merged = true;
        break;
      }
      if (/^-\d+$/.test(Lc)) {
        cells.splice(i, 2, `${L},${R}`);
        merged = true;
        break;
      }
      if (!/^-?\d+$/.test(Lc)) continue;
      const absL = Lc.replace(/^-/, "");
      const nL = parseInt(absL, 10);
      // e.g. 1974,3 (Comenzi) — 4+ digit integer part + 1–2 digit fractional without merging 458,30
      if (/^\d{1,2}$/.test(Rc) && absL.length >= 4 && !absL.startsWith("0")) {
        cells.splice(i, 2, `${L},${R}`);
        merged = true;
        break;
      }
      if (nL < 100) continue;
      // 1000+ or mid-range amounts like 116,82; avoid merging 458 + two-digit next column
      if (nL >= 1000 || (Rc.length === 2 && nL >= 100 && nL <= 399)) {
        cells.splice(i, 2, `${L},${R}`);
        merged = true;
        break;
      }
    }
    if (!merged && cells.length > targetLen) {
      for (let i = 0; i < cells.length - 1; i++) {
        const L = cells[i].trim();
        const R = cells[i + 1].trim();
        if (L === "" || R === "") continue;
        const Lc = L.replace(/\s/g, "");
        const Rc = R.replace(/\s/g, "");
        if (!/^\d+$/.test(Lc) || !/^\d{2}$/.test(Rc)) continue;
        if (Lc === "0" && Rc === "0") continue;
        const nL = parseInt(Lc, 10);
        if (nL >= 10 && nL <= 99) {
          cells.splice(i, 2, `${L},${R}`);
          merged = true;
          break;
        }
      }
    }
    if (!merged) break;
  }
  return cells;
}

function parseDelimitedText(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  const delim = first.includes(";") && first.split(";").length > first.split(",").length ? ";" : ",";
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
      } else if (!q && ch === delim) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const headerCount = headers.length;
  const rows = lines.slice(1).map((line) => {
    let cells = split(line).map((c) => c.replace(/^"|"$/g, ""));
    if (delim === "," && headerCount > 0 && cells.length > headerCount) {
      cells = mergeEuropeanCommaDecimalFields(cells, headerCount);
    }
    return cells;
  });
  return { headers, rows };
}

function sheetToTable(sheet: XLSX.WorkSheet): ParsedTable {
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as string[][];
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = (matrix[0] ?? []).map((c) => String(c ?? ""));
  const rows = matrix.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? "")));
  return { headers, rows };
}

function parseXlsxBuffer(buf: Buffer): ParsedTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) return { headers: [], rows: [] };
  return sheetToTable(wb.Sheets[name]);
}

const INNER_EXT = /\.(csv|xlsx|xls|xml)$/i;

function pickZipEntry(zip: AdmZip): { data: Buffer; name: string } | null {
  const entries = zip.getEntries().filter((e) => !e.isDirectory && INNER_EXT.test(e.entryName));
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.entryName.localeCompare(b.entryName));
  const e = entries[0];
  return { data: e.getData(), name: path.basename(e.entryName) };
}

function flattenXmlToRows(obj: unknown): ParsedTable | null {
  const collectObjects: Record<string, unknown>[] = [];

  function walk(v: unknown): void {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => k !== ":@");
      const childArrays = keys.filter((k) => Array.isArray(o[k]));
      if (childArrays.length === 1) {
        walk(o[childArrays[0]]);
        return;
      }
      const numericLike = keys.filter((k) => {
        const val = o[k];
        if (typeof val === "string" && /[\d.,]+/.test(val) && val.length < 40) return true;
        if (typeof val === "number") return true;
        return false;
      });
      if (keys.length >= 3 && numericLike.length >= 1) {
        collectObjects.push(o);
      }
      keys.forEach((k) => walk(o[k]));
    }
  }

  walk(obj);
  if (collectObjects.length < 2) return null;
  const keySet = new Set<string>();
  collectObjects.forEach((o) => {
    Object.keys(o).forEach((k) => {
      if (k !== ":@") keySet.add(k);
    });
  });
  const headers = [...keySet].filter((k) => k !== ":@").slice(0, 40);
  if (headers.length < 2) return null;
  const rows = collectObjects.map((o) =>
    headers.map((h) => {
      const val = o[h];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    }),
  );
  return { headers, rows };
}

function parseXmlBuffer(buf: Buffer): ParsedTable {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const text = buf.toString("utf8");
  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch {
    return { headers: [], rows: [] };
  }
  const flat = flattenXmlToRows(parsed);
  return flat ?? { headers: [], rows: [] };
}

function parsePdfBuffer(buf: Buffer): Promise<ParsedTable> {
  return pdfParse(buf).then((data: { text: string }) => {
    const lines = data.text
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter(Boolean);
    const dataLines = lines.filter((l: string) => (l.match(/[\d.,]+/g) ?? []).length >= 2);
    if (dataLines.length < 2) {
      return { headers: [], rows: [] };
    }
    const splitLine = (l: string) =>
      l
        .split(/\s{2,}|\t+/)
        .map((c: string) => c.trim())
        .filter(Boolean);
    const first = splitLine(dataLines[0]);
    const colCount = Math.max(first.length, 4);
    const headers = Array.from({ length: colCount }, (_, i) => first[i] ?? `col_${i + 1}`);
    const rows = dataLines.slice(1).map((l: string) => {
      const p = splitLine(l);
      return Array.from({ length: colCount }, (_, i) => p[i] ?? "");
    });
    return { headers, rows };
  });
}

export async function parseEarningsFile(buffer: Buffer, originalName: string): Promise<ParsedTable> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".zip") {
    const zip = new AdmZip(buffer);
    const inner = pickZipEntry(zip);
    if (!inner) {
      throw new Error("ZIP does not contain a CSV, XLSX, XLS, or XML file");
    }
    return parseEarningsFile(inner.data, inner.name);
  }

  if (ext === ".csv") {
    const text = buffer.toString("utf8");
    const t = parseDelimitedText(text);
    if (t.headers.length) return t;
    throw new Error("CSV file has no header row");
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const t = parseXlsxBuffer(buffer);
    if (t.headers.length) return t;
    throw new Error("Spreadsheet has no header row");
  }

  if (ext === ".xml") {
    const t = parseXmlBuffer(buffer);
    if (t.headers.length && t.rows.length) return t;
    throw new Error(
      "Could not parse XML into tabular rows. Export as CSV or XLSX if possible.",
    );
  }

  if (ext === ".pdf") {
    const t = await parsePdfBuffer(buffer);
    if (t.headers.length && t.rows.length) return t;
    throw new Error(
      "Could not extract a table from PDF. Try exporting CSV or XLSX from the platform.",
    );
  }

  if (ext === "") {
    const t = parseDelimitedText(buffer.toString("utf8"));
    if (t.headers.length) return t;
  }

  throw new Error(`Unsupported file type: ${ext || "unknown"}`);
}
