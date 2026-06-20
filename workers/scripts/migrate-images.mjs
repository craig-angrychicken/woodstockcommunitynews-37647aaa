// Copy referenced images from the public Supabase Storage bucket → R2 (same keys).
// Resumable (skips objects already in R2). Reads R2 S3 creds from env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// Run from workers/:  set -a && . /Users/craigbaltes/coding/RISO4/.env && set +a && node scripts/migrate-images.mjs
import { execFileSync } from "node:child_process";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const SUPA_PREFIX =
  "https://cceprnhnpqnpexmouuig.supabase.co/storage/v1/object/public/artifact-images/";
const BUCKET = "artifact-images";
const CONCURRENCY = 8;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "wcn", "--remote", "--json", "--command", sql],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 256, encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).results ?? [];
}

// Collect all bucket-referenced image URLs from D1.
function collectKeys() {
  const keys = new Set();
  const add = (url) => {
    if (typeof url === "string" && url.startsWith(SUPA_PREFIX)) {
      keys.add(url.slice(SUPA_PREFIX.length));
    }
  };
  for (const r of d1(`select hero_image_url u from stories where hero_image_url is not null`)) add(r.u);
  for (const r of d1(`select hero_image_url u from artifacts where hero_image_url is not null`)) add(r.u);
  for (const r of d1(`select images from artifacts where images is not null and images <> '[]'`)) {
    try {
      for (const img of JSON.parse(r.images)) {
        add(img?.stored_url);
        add(img?.url);
      }
    } catch { /* ignore bad JSON */ }
  }
  return [...keys];
}

async function existsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function migrateOne(key) {
  if (await existsInR2(key)) return "skip";
  const res = await fetch(SUPA_PREFIX + encodeURI(key));
  if (!res.ok) return `fail ${res.status}`;
  const body = new Uint8Array(await res.arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: res.headers.get("content-type") || "application/octet-stream",
    }),
  );
  return "copied";
}

const keys = collectKeys();
console.log(`Found ${keys.length} referenced bucket objects. Migrating to R2…`);
const stats = { copied: 0, skip: 0, fail: 0 };
let idx = 0;
async function worker() {
  while (idx < keys.length) {
    const k = keys[idx++];
    try {
      const r = await migrateOne(k);
      if (r === "copied") stats.copied++;
      else if (r === "skip") stats.skip++;
      else { stats.fail++; console.error(`  ${r}: ${k}`); }
    } catch (e) {
      stats.fail++;
      console.error(`  error ${k}: ${e.message}`);
    }
    if ((stats.copied + stats.skip + stats.fail) % 50 === 0) {
      console.log(`  …${stats.copied + stats.skip + stats.fail}/${keys.length}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Done. copied=${stats.copied} skipped=${stats.skip} failed=${stats.fail}`);
