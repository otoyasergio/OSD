# Twilio Toll-Free Verification — paste pack

Use this with **+1 (888) 417-2793** in Twilio Console → Numbers & senders →
Continue setup → Toll-free registration (or Trust Hub → Registrations).

**Live legal pages (published on Wix Blog):**

- Privacy Policy: https://www.torontomoto.com/post/privacy-policy
- SMS Terms: https://www.torontomoto.com/post/sms-terms

Wix REST cannot create Classic Editor pages or nest them under Home in the
site menu. These are published blog posts with stable public URLs. To show
them under Home in the nav, add menu links in the Wix Editor manually.

---

## Business identity

| Field | Value |
|-------|--------|
| Business name | OTOMOTO TORONTO MOTO INC. |
| Doing business as | Toronto Moto |
| Business type | Private / for-profit |
| Website | https://www.torontomoto.com |
| Street | 99 River Street |
| City | Toronto |
| Province | ON |
| Postal code | M5A 3P4 |
| Country | CA / Canada |
| Business phone | +1 647-424-1088 |
| Notification email | info@torontomoto.com |

Contact first/last name: use the owner or front-office person who should get
verification emails (Twilio requires a real person).

---

## Use case

**Categories (check all that apply):**

- CUSTOMER_CARE
- ACCOUNT_NOTIFICATIONS

Do **not** check MARKETING until marketing consent + Privacy/Terms cover it.

**Use case summary (paste):**

```
Toronto Moto is a motorcycle service shop in Toronto. We text customers about
their open work orders only: drop-off agreement links, approval requests for
recommended work, ready-for-pickup notices, and payment reminders. Messages
are transactional and sent from our service app at service.torontomoto.com.
Customers provide their mobile number at intake and can reply STOP to opt out.
Estimated volume is under 1,000 messages per month.
```

**Estimated monthly volume:** `100` or `1,000` (pick the closest bucket; stay low)

---

## Opt-in

**Opt-in type:** `WEB_FORM` + verbal/intake (if asked for primary, choose WEB_FORM
once `/sms` is live; until then describe intake)

**Opt-in description (paste):**

```
Customers opt in when they provide their mobile number during motorcycle
service intake at Toronto Moto (in person or via the customer portal) and
agree to receive service texts about that work order. They can also opt in
at https://service.torontomoto.com/sms (public form, unchecked by default).
Disclosures state: Toronto Moto service updates; message frequency varies;
message and data rates may apply; reply HELP for help; reply STOP to opt out;
links to Privacy Policy and Terms. Consent is not required to complete a
purchase. Reply STOP opts out of all SMS.
```

**Opt-in confirmation message (paste):**

```
Toronto Moto: You are enrolled for service text updates. Message frequency
varies. Msg & data rates may apply. Reply HELP for help or STOP to cancel.
```

**Opt-in keywords (if asked):** leave blank, or `START` only if you document it

---

## Sample messages (from production templates)

1. `Hi [Name], Toronto Moto needs your approval for work on [WO#]. Review & approve: https://service.torontomoto.com/c/[token] Reply STOP to opt out.`

2. `[WO#] is ready for pickup at Toronto Moto. Pay online: https://service.torontomoto.com/c/[token] Reply STOP to opt out.`

3. `Please review and sign the drop-off agreement for [WO#]: https://service.torontomoto.com/c/[token] Reply STOP to opt out.`

4. `Reminder: invoice for [WO#] is outstanding. Pay here: https://service.torontomoto.com/c/[token] Reply STOP to opt out.`

**HELP reply sample:**

```
Toronto Moto: For help visit torontomoto.com. Message frequency varies.
Msg & data rates may apply. Reply STOP to cancel.
```

---

## Legal URLs (live)

| Field | Value |
|-------|---------|
| Privacy Policy URL | https://www.torontomoto.com/post/privacy-policy |
| Terms and Conditions URL | https://www.torontomoto.com/post/sms-terms |

---

## Additional information (paste if there is a free-text field)

```
Brand shown to customers: Toronto Moto. Legal entity: OTOMOTO TORONTO MOTO INC.
Sender: toll-free +18884172793 via Messaging Service "Toronto Moto Service".
Shop also publishes local number 647-424-1088 for calls/texts; app outbound
SMS uses the verified toll-free number. No age-gated content. No marketing in
this verification request.
```

---

## After submit

**Submitted 2026-08-27 via API** — SID `HHc77d11434926938bad555b3ff24e5518`, status `PENDING_REVIEW`.
Number: +18884172793. Notification email: sergio.otoya@torontomoto.com.

1. Status should stay **PENDING_REVIEW** / Verification in progress (traffic pending).
2. Approval is typically 3–5 business days.
3. When **Approved**, send a test ready-for-pickup SMS from the app to your own phone.
4. Rotate the Auth Token that was shared in chat (secondary token → update `.env.local` + Vercel → delete old).

Check status:
`GET https://messaging.twilio.com/v1/Tollfree/Verifications/HHc77d11434926938bad555b3ff24e5518`
