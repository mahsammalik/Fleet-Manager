/**
 * CLI: parse CSV with fast-csv + same column mapping as dashboard import.
 *
 * Dry run (default): prints first rows with accountOpeningFee + TVT.
 * Post: multipart upload to POST {baseUrl}/import/earnings-csv
 *
 *   npx ts-node --transpile-only scripts/import-earnings-csv.ts ./fixtures/x.csv
 *   npx ts-node --transpile-only scripts/import-earnings-csv.ts ./f.csv --post http://localhost:4100/api eyJ... glovo 2026-04-01 2026-04-07
 */
import * as fs from "fs";
import * as path from "path";
import { parseFile } from "fast-csv";
import { buildColumnMap } from "../src/modules/earnings/romanHeaderMap";
import { rowCellsToNormalized } from "../src/modules/earnings/normalizeRow";
import { detectPlatformWithMeta, isEarningsPlatform, type EarningsPlatform } from "../src/modules/earnings/detectPlatform";
import { extractDateFromFilename } from "../src/modules/earnings/filenameDate";

function parseAllRows(filePath: string): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const rows: string[][] = [];
    parseFile(filePath, { headers: false, ignoreEmpty: true, trim: true })
      .on("error", reject)
      .on("data", (row: string[]) => rows.push(row.map((c) => String(c ?? ""))))
      .on("end", (rowCount: number) => {
        void rowCount;
        resolve(rows);
      });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const postIdx = argv.indexOf("--post");
  const fileArg = postIdx >= 0 ? argv[0] : argv[0];
  if (!fileArg) {
    console.error("Usage: import-earnings-csv <file.csv> [--post <apiBase> <jwt> <platform> <YYYY-MM-DD> <YYYY-MM-DD>]");
    process.exit(1);
  }
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(abs)) {
    console.error("File not found:", abs);
    process.exit(1);
  }

  const table = await parseAllRows(abs);
  if (!table.length) {
    console.error("Empty CSV");
    process.exit(1);
  }
  const headers = table[0] ?? [];
  const dataRows = table.slice(1);
  const { platform: detected } = detectPlatformWithMeta(path.basename(abs), headers);
  const colMap = buildColumnMap(headers);
  const filenameDate = extractDateFromFilename(path.basename(abs));

  if (postIdx >= 0) {
    const base = argv[postIdx + 1];
    const token = argv[postIdx + 2];
    const platform = argv[postIdx + 3];
    const weekStart = argv[postIdx + 4];
    const weekEnd = argv[postIdx + 5];
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!base || !token || !platform || !weekStart || !weekEnd || !iso.test(weekStart) || !iso.test(weekEnd)) {
      console.error("After --post need: <apiBase> <jwt> <platform> <weekStart> <weekEnd>");
      process.exit(1);
    }
    if (!isEarningsPlatform(platform)) {
      console.error("Invalid platform:", platform);
      process.exit(1);
    }
    const buf = fs.readFileSync(abs);
    const fd = new FormData();
    fd.append("file", new Blob([buf]), path.basename(abs));
    fd.append("platform", platform);
    fd.append("weekStart", weekStart);
    fd.append("weekEnd", weekEnd);
    const url = `${base.replace(/\/$/, "")}/import/earnings-csv`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(res.status, text);
      process.exit(1);
    }
    console.log(text);
    return;
  }

  const platformEff = detected;
  const normalized = dataRows.map((cells) =>
    rowCellsToNormalized(cells, colMap, filenameDate, {
      skipInferredPlatformFee: platformEff === "glovo",
    }),
  );
  const sample = normalized.slice(0, 5).map((r, i) => ({
    row: i + 1,
    tripDate: r.tripDateIso,
    courierId: r.hints.courierId,
    transferTotal: r.amounts.transferTotal,
    accountOpeningFee: r.amounts.accountOpeningFee,
    dailyCash: r.amounts.dailyCash,
  }));
  console.log(JSON.stringify({ detectedPlatform: platformEff, rows: sample }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
