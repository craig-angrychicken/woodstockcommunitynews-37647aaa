# Woodstock Community News — Public Site

The reader-facing site for Woodstock Community News, serving AI-generated local
news for Woodstock, Georgia and Cherokee County at
[woodstockcommunity.news](https://woodstockcommunity.news).

Built with [Next.js](https://nextjs.org) (App Router) and deployed to Cloudflare
Workers via [OpenNext](https://opennext.js.org/cloudflare). Story content is read
from a Cloudflare D1 database through `lib/db.ts`.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Cloudflare bindings (D1, R2, etc.) are made available under `next dev` via
`initOpenNextCloudflareForDev()` in `next.config.ts`.

## Build & Deploy

```bash
# Build with the Cloudflare adapter and preview locally on the Workers runtime
npm run preview

# Build and deploy to Cloudflare Workers
npm run deploy
```

After changing the Cloudflare bindings, regenerate the env types:

```bash
npm run cf-typegen
```
