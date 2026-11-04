# Drop-off agreement packet

Headless Adobe App Builder action for OTOMOTO TORONTO MOTO INC.

The customer profile files a drop-off agreement as the signature image. It does not file a PDF of the contract body. This action builds the merge payload for that PDF. It stamps the legal entity, address, and phone from code, because the `location` table has only a name, a code, and a status.

The caller cannot rename the contracting party. A body that says only "Toronto Moto" is rejected. The published contract in `scripts/data/otomoto-legal-contract.html` names Otomoto Toronto Moto Inc. and is accepted. Migration `20261103030500_drop_off_agreement_legal_entity.sql` rewrites the original seed while it still has that trade-name text. Publishing or signing in the shop uses the same rule and refuses a template that omits the legal entity.

`pdf` stays `null` and `pdfStatus` is `merge_data_ready`. Adobe PDF Services Document Generation is the next call, once that API is on the workspace. This action does not render a PDF inside the Next.js app.

## Auth

One layer: the `x-otomoto-action-secret` header must match the `AGREEMENT_ACTION_SECRET` runtime input. `require-adobe-auth` is false because the caller is the shop server, not an Experience Cloud user. Turning on IMS auth would reject that caller even with a valid shop secret.

The action logs the work order number and template version. It does not log the signer name or the secret.

## Local check

```bash
npm ci
npm test
```

From the repo root, `npm run test:agreement-action` runs the same Jest suite after dependencies are installed.

## Deploy

This package is not part of `npm run deploy:production`. Production for the shop site still ships from `main` with that script.

When an Adobe org is ready:

```bash
aio app use
aio app deploy
```

Set `AGREEMENT_ACTION_SECRET` in the target workspace `.env` before deploy. To see activation logs while verifying, send `x-ow-extra-logging: on` with the web action request.

Rollback: `aio app undeploy` from this directory. The shop app does not call the action yet, so undeploying it does not change the service floor.
