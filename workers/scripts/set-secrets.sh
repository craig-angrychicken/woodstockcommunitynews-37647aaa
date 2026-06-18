#!/usr/bin/env bash
# One-command Worker secret loader. Fill workers/.secrets.env (from .secrets.env.example),
# then run:  bash scripts/set-secrets.sh
# You run this — it reads your local files and uploads to your Cloudflare account; the
# values never leave your machine except to your own Worker.
set -euo pipefail
cd "$(dirname "$0")/.."   # → workers/

ENVFILE=".secrets.env"
if [ ! -f "$ENVFILE" ]; then
  cp .secrets.env.example "$ENVFILE"
  echo "Created $ENVFILE — paste the values you have (RESEND/FACEBOOK/GHOST), then re-run."
  exit 1
fi

set -a; . "./$ENVFILE"; set +a

# OpenRouter: pull from the RISO4 project if not provided here.
RISO_ENV="/Users/craigbaltes/coding/RISO4/viewer/.env.local"
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$RISO_ENV" ]; then
  OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' "$RISO_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
fi

# Shared secrets: generate if blank (must match between caller/callee — script keeps them in sync).
: "${QUEUE_PROCESSOR_SECRET:=$(openssl rand -hex 32)}"
: "${REVALIDATION_SECRET:=$(openssl rand -hex 32)}"
: "${ALERT_EMAIL:=craig@angrychicken.co}"

export OPENROUTER_API_KEY QUEUE_PROCESSOR_SECRET REVALIDATION_SECRET ALERT_EMAIL

# Build a JSON of only the non-empty secrets and bulk-upload to the wcn-api Worker.
node -e '
const keys=["OPENROUTER_API_KEY","LOVABLE_API_KEY","RESEND_API_KEY","ALERT_EMAIL",
  "FACEBOOK_PAGE_ACCESS_TOKEN","FACEBOOK_PAGE_ID","FACEBOOK_PLACE_ID",
  "QUEUE_PROCESSOR_SECRET","REVALIDATION_SECRET","GHOST_API_URL","GHOST_ADMIN_API_KEY","R2_PUBLIC_URL"];
const o={}; for(const k of keys){const v=process.env[k]; if(v&&v.length) o[k]=v;}
require("fs").writeFileSync(".secrets.json", JSON.stringify(o));
console.error("Uploading "+Object.keys(o).length+" secrets: "+Object.keys(o).join(", "));
'
npx wrangler secret bulk .secrets.json
rm -f .secrets.json

# The site needs the SAME revalidation secret so publish-story can purge ISR.
echo "Setting site REVALIDATION_SECRET to match…"
( cd ../site && printf '%s' "$REVALIDATION_SECRET" | npx wrangler secret put REVALIDATION_SECRET )

echo "✅ Done. Re-enable the pipeline when ready:"
echo "   npx wrangler d1 execute wcn --remote --command \"UPDATE schedules SET is_enabled=1\""
