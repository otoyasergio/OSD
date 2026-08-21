# OSD auto-debug and fix — finish in Automations editor

Draft payload: [`osd-auto-debug-and-fix.json`](./osd-auto-debug-and-fix.json)

## What should already be prefilled

- **Name:** OSD auto-debug and fix
- **Triggers:** GitHub checks completed on `otoyasergio/OSD` + Sentry issue created
- **Tools:** Comment on PRs, manage check runs
- **Repo / branch:** `otoyasergio/OSD` @ `main`
- **Instructions:** PR-only fixes; no deploys; no pushes to `main`

## You must finish in the editor

1. Open **Cursor Automations** (Agents Window → Automations, or [cursor.com/automations](https://cursor.com/automations)).
2. If the form is empty, copy fields from `osd-auto-debug-and-fix.json` (name, description, triggers, tools, prompt).
3. **Sentry:** connect the Sentry integration if needed, then select the project that receives `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` for this app.
4. **GitHub:** confirm the Cursor GitHub app can access `otoyasergio/OSD`.
5. Enable **Cloud Agents** compute if prompted ([Cloud Agents dashboard](https://cursor.com/dashboard?tab=cloud-agents)).
6. Save / activate the automation.

## Smoke test

1. Open a tiny PR that fails typecheck or lint (or wait for a real red CI).
2. Confirm the automation run starts and opens/updates a `fix: …` PR (or comments why it stopped).
3. Confirm nothing ran `vercel --prod` / `npm run deploy:production` and nothing pushed to `main`.
4. Optionally trigger a test Sentry event in a non-prod environment and confirm a fix/investigation PR or clear blocked comment.
