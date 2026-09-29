# Agent notes

## Cloud Agent

- Install with `npm ci`. Node.js 22 is already on the image. `lint-staged` may warn that it wants Node `>=22.22.1`; `npm ci` still completes on 22.14.
- Dev server: `npm run dev` at http://127.0.0.1:3000.
- When `.env.local` is missing, write the same placeholders CI uses so `/login` renders and unauthenticated pages redirect to login: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example`, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`. Process environment values override those placeholders.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` do not need a live shop database. Sign-in against the placeholder host fails closed with a form error.
- Mutating integration and E2E tests need an isolated `supabase start` database. The production Supabase ref is `eofxprepuajpqyvlolhw`.

## Production (Vercel)

- Live URL: https://service.torontomoto.com
- **Deploy from `main` only** via `npm run deploy:production`.
- Never run bare `vercel --prod` from a feature branch — that previously rolled the shop back and dropped live features.
- GitHub default branch must stay `main`.
