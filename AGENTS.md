# Agent notes

## Production (Vercel)

- Live URL: https://service.torontomoto.com
- **Deploy from `main` only** via `npm run deploy:production`.
- Never run bare `vercel --prod` from a feature branch — that previously rolled the shop back and dropped live features.
- GitHub default branch must stay `main`.
