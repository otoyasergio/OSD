# Twilio verification paste pack

**Brand:** Toronto Moto  
**Legal entity:** Otomoto Toronto Moto Inc.  
**App URL:** https://service.torontomoto.com  
**Public opt-in:** https://service.torontomoto.com/sms  
**Privacy Policy:** https://www.torontomoto.com/privacy-policy  
**Terms / SMS Terms:** https://www.torontomoto.com/terms  
**Support:** https://www.torontomoto.com

Copy each section below into the matching Twilio Trust Hub / A2P Campaign / Toll-Free Verification field.

---

## 1. Campaign / use case summary

**Primary use cases (select all that apply):**

- CUSTOMER_CARE
- ACCOUNT_NOTIFICATIONS
- MARKETING

**Campaign description (paste):**

```
Toronto Moto (Otomoto Toronto Moto Inc.) sends text messages to motorcycle service customers who opt in. Service messages include work-order approvals, pickup readiness, contracts, payment links, and appointment-related updates. Customers may separately opt in to occasional promotional offers. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel. Privacy: https://www.torontomoto.com/privacy-policy Terms: https://www.torontomoto.com/terms
```

---

## 2. Message volume

**Estimated monthly message volume (paste):**

```
1000
```

---

## 3. Opt-in method

**How do end users opt in? (paste):**

```
Customers opt in by affirmatively checking unchecked consent boxes on our public SMS sign-up page (https://service.torontomoto.com/sms), during in-shop customer intake, when staff create or update a customer profile, or in the secure customer portal. Service updates and promotional offers require separate checkboxes; boxes are never pre-checked. Disclosures on each surface include business name (Toronto Moto), message types, frequency varies, message and data rates may apply, Reply HELP for help or STOP to opt out, and links to Privacy Policy and Terms.
```

**Opt-in URL (if requested):**

```
https://service.torontomoto.com/sms
```

---

## 4. Sample messages

### CUSTOMER_CARE

```
Toronto Moto: Hi [Name], jobs on WO-[Number] need your approval. Review: https://service.torontomoto.com/c/[token]. Reply STOP to opt out.
```

### ACCOUNT_NOTIFICATIONS

```
Toronto Moto: Your motorcycle is ready for pickup. Details: https://service.torontomoto.com/c/[token]. Reply STOP to opt out.
```

### MARKETING

```
Toronto Moto: Hi [Name], [offer]. Details: https://torontomoto.com. Reply STOP to unsubscribe.
```

---

## 5. Required disclosures (standalone block)

Paste anywhere the form asks for STOP / HELP / rates / frequency language:

```
Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel. For support visit https://www.torontomoto.com. Privacy Policy: https://www.torontomoto.com/privacy-policy Terms: https://www.torontomoto.com/terms
```

---

## 6. Keyword auto-replies (HELP / STOP)

### HELP reply (paste)

```
Toronto Moto: For help visit torontomoto.com. Message frequency varies. Msg & data rates may apply. Reply STOP to cancel.
```

### STOP reply (paste)

```
Toronto Moto: You are unsubscribed. No more messages will be sent. Visit torontomoto.com for help.
```

**Accepted opt-out keywords:** STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, HALT

**Accepted help keywords:** HELP, INFO, SUPPORT

---

## 7. Welcome / opt-in confirmation message

Sent when a customer newly opts in via web form, portal, or staff UI:

```
Toronto Moto: Welcome to our text alerts! You are enrolled for [service updates / promotional offers / service updates and promotional offers]. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel.
```

_(The app substitutes the bracketed program label based on which box(es) were checked.)_

---

## 8. Additional details / reviewer notes

**Soft rollout for existing customers (paste):**

```
Existing customers who enrolled before dual-consent checkboxes launched may continue to receive transactional service texts until they interact with a consent UI (public sign-up page, staff customer form, or customer portal). Once a customer record is updated through any consent surface, service texts require explicit transactional opt-in. Marketing texts always require separate marketing opt-in. Global STOP opt-out blocks all outbound SMS.
```

---

## 9. Embedded links

**Does the campaign include embedded links?**

```
Yes — customer portal links (https://service.torontomoto.com/c/...) and, for marketing samples, https://torontomoto.com
```

---

## 10. Messaging Service settings checklist

Before submitting the campaign, confirm in Twilio Console:

- [ ] **Advanced Opt-Out** enabled on the Messaging Service
- [ ] Compliance toolkit / opt-out keywords configured
- [ ] Incoming webhook: `https://service.torontomoto.com/api/twilio/webhooks`
- [ ] Status callback: `https://service.torontomoto.com/api/twilio/status`
- [ ] `NEXT_PUBLIC_APP_URL` on Vercel = `https://service.torontomoto.com`
- [ ] Privacy and Terms URLs published on Wix and set in Vercel env
- [ ] Public opt-in page live at `https://service.torontomoto.com/sms`

---

## 11. Pre-submit ops sequence

1. Publish Privacy Policy and Terms on Wix using drafts in `docs/compliance/privacy-policy-wix.md` and `docs/compliance/sms-terms-wix.md`.
2. Set on Vercel (Production):
   - `NEXT_PUBLIC_PRIVACY_POLICY_URL=https://www.torontomoto.com/privacy-policy`
   - `NEXT_PUBLIC_TERMS_URL=https://www.torontomoto.com/terms`
3. Redeploy; verify `https://service.torontomoto.com/sms` shows disclosures and legal links.
4. Submit campaign in Twilio Console using sections 1–9 above.
5. Enable **Advanced Opt-Out** on the Messaging Service before going live.
