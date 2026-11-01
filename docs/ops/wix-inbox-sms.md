# Wix Inbox SMS operations

Customer SMS for **OTOMOTO TORONTO MOTO INC.** is sent through the existing Wix
Inbox channel for **647-424-1088**. That number stays owned and operated in Wix.
Do not port it or move customer SMS to another provider without a new, explicit
owner decision.

## Provider ownership and boundaries

- The app may send an outbound message through Wix Inbox.
- Customer replies remain in Wix Inbox. Staff read and answer them there.
- The app has no Wix inbound-message webhook and must not add one as part of
  this integration.
- Twilio remains in use for Voice and Video only. Its Voice routes and
  credentials are unrelated to customer SMS.
- Wix's send response supplies a message and conversation ID, but this
  integration has no carrier delivery callback. A `sent` communication-log
  entry means Wix accepted the send request, not that the handset received it.

## Required Wix access

Use a Wix API key for the Toronto site with only the permissions required by
the existing integrations:

- Contacts: read and manage
- Bookings: read
- Inbox: read and manage conversations/messages

Set `WIX_API_KEY` and `WIX_SITE_ID` server-side. Keep the key out of logs and
client-side variables. `WIX_ACCOUNT_ID` remains optional for account-scoped
Contacts calls.

## Fail-closed enablement

SMS is enabled only when all three values are present:

```text
WIX_API_KEY
WIX_SITE_ID
WIX_INBOX_SMS_ENABLED=1
```

Any other value, including an unset or empty flag, disables sending.
`GET /api/health` then reports `integrations.wixSms: "missing"` without calling
Wix. Keep the flag empty in CI, local stateful E2E, and any environment that
must not contact the live channel.

Before Production cutover, remove `TWILIO_MESSAGING_SERVICE_SID` and
`TWILIO_FROM_NUMBER` from the Vercel Production environment. They are retired
SMS settings, not Voice/Video settings. Confirm they are absent before enabling
`WIX_INBOX_SMS_ENABLED=1`.

## Consent and recipient checks

Every send re-reads the linked Wix Contact before contacting Inbox. The app:

1. requires a valid local phone number;
2. creates or refreshes the Wix Contact link when needed;
3. requires the Wix E.164 phone to match the intended recipient;
4. blocks `UNSUBSCRIBED`;
5. blocks `NO_SUBSCRIPTION_STATUS`;
6. allows `NOT_SET` or `PENDING` only when the local record is not opted out;
7. clears the local opt-out timestamp for `SUBSCRIBED`, or records one for
   `UNSUBSCRIBED` when the local record does not already have one; and
8. blocks a Wix deliverability status of `INVALID`.

Wix owns carrier STOP/START handling. If a customer replies, inspect the
conversation and current subscription in Wix Inbox/Contacts; there is no app
reply processor.

## Canary before enablement

Use a consenting internal test contact whose Wix phone is known and whose
conversation is visible in Wix Inbox.

1. Leave `WIX_INBOX_SMS_ENABLED` empty while installing the API key and site ID.
2. Confirm `GET /api/health` shows `wix: "ok"`, `wixSms: "missing"`, and the
   expected independent `twilioVoice` state.
3. Verify the API key has Contacts/Bookings and Inbox read/manage permissions.
4. Set `WIX_INBOX_SMS_ENABLED=1` on Preview only and redeploy.
5. Send one non-sensitive message from a work order to the internal contact.
6. Confirm the message appears in the existing Wix Inbox conversation under
   647-424-1088 and that the app records the Wix message ID.
7. Reply from the handset. Confirm the reply appears in Wix Inbox and nowhere
   in the app.
8. Test an unsubscribed contact and confirm the app blocks the send.
9. After owner acceptance, repeat the flag change and one-message canary in
   Production.

Do not interpret the absence of an immediate error as carrier delivery; this
integration receives no delivery callback.

## Troubleshooting

| Symptom                                             | Check                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Health shows `wixSms: "missing"`                    | Confirm the exact flag is `1`, then confirm `WIX_API_KEY` and `WIX_SITE_ID` are nonempty. Health makes no Wix request.           |
| Not configured error                                | Confirm all three enablement values in the same Vercel environment and redeploy.                                                 |
| Contact API error/not found                         | Confirm Contacts read/manage permission, site ID, and the customer's Wix link; retry contact sync.                               |
| Phone invalid/mismatch                              | Correct the Wix Contact phone and local customer phone so their E.164 values match.                                              |
| Subscription required/opted out                     | Review consent in Wix Contacts. Do not override it in the app.                                                                   |
| Inbox API error                                     | Confirm Inbox read/manage permission and inspect Wix status/logs without printing message content or the API key.                |
| Message is in the app log but delivery is uncertain | Check the Wix Inbox conversation and contact the customer by an approved alternate method; no carrier callback reaches this app. |
| Reply is not visible in the app                     | Expected. Read and answer replies in Wix Inbox.                                                                                  |

## Rollback

For this release, do not roll back to an immutable pre-cutover deployment.
That would restore retired Twilio SMS code and create conflicting provider
ownership. Rollback means disabling Wix SMS and deploying current `main`:

1. Remove `WIX_INBOX_SMS_ENABLED` or set it to empty in the affected Vercel
   environment to disable Wix SMS.
2. Deploy current `main` only with the guarded production command:

   ```bash
   git checkout main && git pull --ff-only origin main && npm run deploy:production
   ```

   Never run a bare `vercel --prod`, and never deploy Production from a feature
   branch.

3. Confirm `GET /api/health` reports `wixSms: "missing"`.
4. Confirm the app blocks a new SMS attempt with the not-configured message.
5. Continue handling existing conversations and replies in Wix Inbox.

Do not delete the Wix API key if Contacts or Bookings still use it. Rollback is
the SMS flag change; it does not alter Twilio Voice/Video or Wix conversation
history.
