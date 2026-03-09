# Project: Woodstock Community News (Woodstock Wire 2.0)

## Supabase Deployment

After making any changes to Supabase (edge functions or migrations), always deploy automatically:

```bash
# Push database migrations
supabase db push

# Deploy all edge functions
supabase functions deploy
```

The project is already linked to `cceprnhnpqnpexmouuig` (Woodstock Wire 2.0).

## GitHub

Push changes to `git@github.com:craig-angrychicken/woodstockcommunitynews-37647aaa.git`

Never commit `.env` — it contains secrets.
