// Transform a Supabase pg_dump (--inserts) into SQLite INSERTs for D1.
// Keeps only the essential public.* tables, strips the "public". qualifier,
// normalizes E'' escape-strings, and emits one INSERT per row.
//
// Usage: node pg-dump-to-d1.mjs <dump.sql> <out.sql>
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2] || "/tmp/wcn_data.sql";
const OUT = process.argv[3] || "/tmp/wcn_d1_data.sql";

// Skipped: cron_job_logs (huge/noise), query_history + journalism_queue (transient,
// pipeline recreates), user_roles (Access replaces auth), all auth.*/storage.*.
const ALLOW = [
  "app_settings", "artifact_clusters", "sources", "prompt_versions",
  "schedules", "council_meetings", "artifacts", "stories", "story_artifacts",
];

const text = readFileSync(SRC, "utf8");
const n = text.length;

function readString(start, eMode) {
  // start = index of opening quote. Returns {str, next} (next = index after closing quote).
  let i = start + 1;
  let out = "";
  const esc = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "\\": "\\", "'": "'", '"': '"' };
  while (i < n) {
    const c = text[i];
    if (c === "'") {
      if (text[i + 1] === "'") { out += "'"; i += 2; continue; } // doubled quote
      i++; break; // closing quote
    }
    if (eMode && c === "\\") {
      const e = text[i + 1];
      if (e in esc) { out += esc[e]; i += 2; continue; }
      if (e === "x") { out += String.fromCharCode(parseInt(text.substr(i + 2, 2), 16)); i += 4; continue; }
      if (e === "u") { out += String.fromCharCode(parseInt(text.substr(i + 2, 4), 16)); i += 6; continue; }
      out += e; i += 2; continue;
    }
    out += c; i++;
  }
  return { str: out, next: i };
}

const sqliteStr = (s) => "'" + s.replace(/'/g, "''") + "'";

function parseTable(table) {
  const header = `INSERT INTO "public"."${table}" (`;
  const hi = text.indexOf(header);
  if (hi === -1) return null;
  const colStart = hi + header.length;
  const colEnd = text.indexOf(") VALUES", colStart);
  const cols = text.slice(colStart, colEnd);
  let i = colEnd + ") VALUES".length;
  const rows = [];
  while (i < n) {
    while (i < n && /[\s,]/.test(text[i])) i++;
    if (text[i] === ";" || text[i] !== "(") break;
    i++; // consume '('
    const vals = [];
    while (true) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "'") {
        const { str, next } = readString(i, false);
        vals.push(sqliteStr(str)); i = next;
      } else if ((text[i] === "E" || text[i] === "e") && text[i + 1] === "'") {
        const { str, next } = readString(i + 1, true);
        vals.push(sqliteStr(str)); i = next;
      } else {
        let j = i;
        while (j < n && text[j] !== "," && text[j] !== ")") j++;
        vals.push(text.slice(i, j).trim()); // NULL / number / true / false
        i = j;
      }
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === ",") { i++; continue; }
      if (text[i] === ")") { i++; break; }
      break; // safety
    }
    rows.push(vals);
  }
  return { cols, rows };
}

let out = "";
const summary = [];
for (const t of ALLOW) {
  const parsed = parseTable(t);
  if (!parsed) { summary.push(`${t}: (no data)`); continue; }
  for (const r of parsed.rows) {
    out += `INSERT INTO "${t}" (${parsed.cols}) VALUES (${r.join(", ")});\n`;
  }
  summary.push(`${t}: ${parsed.rows.length} rows`);
}
writeFileSync(OUT, out);
console.error(summary.join("\n"));
console.error(`\nwrote ${OUT} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
