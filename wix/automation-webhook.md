# Wix Automation → OTOMOTO contact webhook

Paste this into a **Wix Automations** “Send HTTP request” (or equivalent) action when a contact is created or updated.

## Endpoint

```
POST https://<YOUR_APP_HOST>/api/wix/webhooks/contacts
```

Example (production):

```
POST https://otomoto.example.com/api/wix/webhooks/contacts
```

## Headers

| Header          | Value                         |
| --------------- | ----------------------------- |
| `Authorization` | `Bearer <WIX_WEBHOOK_SECRET>` |
| `Content-Type`  | `application/json`            |

`WIX_WEBHOOK_SECRET` must match the env var on the Next.js app (Vercel).

## Exact JSON body

Use this shape for both **contact created** and **contact updated** automations. Map Automation dynamic fields to the contact properties below.

### Contact created

```json
{
  "event": "contact.created",
  "contact": {
    "id": "{{Contact ID}}",
    "firstName": "{{First Name}}",
    "lastName": "{{Last Name}}",
    "email": "{{Email}}",
    "phone": "{{Phone}}"
  }
}
```

### Contact updated

```json
{
  "event": "contact.updated",
  "contact": {
    "id": "{{Contact ID}}",
    "firstName": "{{First Name}}",
    "lastName": "{{Last Name}}",
    "email": "{{Email}}",
    "phone": "{{Phone}}"
  }
}
```

Field notes:

- `contact.id` is **required** (Wix contact ID).
- At least one of `email` or `phone` is required; contacts with neither are rejected (`400`).
- `event` is optional for matching but should be set so logs/debugging stay clear.
- Placeholder names (`{{Contact ID}}`, etc.) depend on the labels Wix shows in the Automation builder — pick the Contact ID / name / email / phone variables from the trigger’s contact.

## Expected response

```json
{ "ok": true, "customer_id": "<uuid>", "created": true }
```

`created: false` means an existing app customer was updated (matched by `wix_contact_id`, then email, then phone).

## Related: daily reconcile cron

If Automations miss an event, the app also pulls all Wix contacts daily at 11:30 America/Toronto (15:30 UTC):

- Path: `GET` or `POST` `/api/cron/wix-contacts-sync`
- Auth: `Authorization: Bearer <CRON_SECRET>` only (no query-string secret)
- Vercel schedule: `30 15 * * *` (see `vercel.json`)
