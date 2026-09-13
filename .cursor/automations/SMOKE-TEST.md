# Smoke test results — OSD auto-debug and fix

Date: 2026-08-04

## Static draft checks (passed)

- JSON parses; name/description present
- Two triggers: `git.ciCompleted` (repo `otoyasergio/OSD`) + `sentry.issueCreated`
- Tools: `prComment`, `manageCheckRun`
- `gitConfig`: `otoyasergio/OSD` @ `main`
- Prompt includes hard stops for `deploy:production` / `vercel --prod` / push to `main`

## Verification command path (passed)

Same commands the automation is instructed to run before opening a PR:

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 113 files / 807 tests pass

## Live trigger smoke (after you save the automation)

Cannot run until the automation is saved/activated with Sentry project selected:

1. Open a tiny PR that fails typecheck or lint, **or** wait for a real red CI on `otoyasergio/OSD`.
2. Confirm an Automations run starts.
3. Confirm outcome is a `fix: …` PR or a blocked comment — not a deploy, not a push to `main`.
4. Optional: fire a non-prod Sentry test event and confirm investigation/fix PR behavior.
