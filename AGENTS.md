# Agent notes

## Production (Vercel)

- Live URL: https://service.torontomoto.com
- **Deploy from `main` only** via `npm run deploy:production`.
- Never run bare `vercel --prod` from a feature branch — that previously rolled the shop back and dropped live features.
- GitHub default branch must stay `main`.

## Cloud Agent

The Cloud Agent environment uses an isolated local Supabase stack in Docker (`supabase start` against `supabase/config.toml`). Do not point `NEXT_PUBLIC_SUPABASE_URL` at the production project `eofxprepuajpqyvlolhw`.

On boot it starts Docker, local Supabase, seeds the synthetic QA shop, and runs `npm run dev` at http://127.0.0.1:3000.

QA owner login (fixture only): `qa-owner@otomoto.invalid` / `Otomoto-QA-2026!`

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
