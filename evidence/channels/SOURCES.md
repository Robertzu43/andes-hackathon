# Official source register · checked 2026-10-17

Scope: WhatsApp messaging, SMS and telephone voice relevant to #10. These are
documentation references, not provider selection, purchase advice, account evidence,
recipient observations or proof of regional availability. No provider dashboard or
authenticated API was accessed. Recheck destination-specific terms before any later
authorised trial. All monetary values remain unset in the matrix.

| ID | Official source | Bounded use and remaining evidence |
|---|---|---|
| WA-POLICY | [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) (page updated 2026-09-23) | Recipient opt-in, opt-out handling and template/service-window rules. Does not prove our consent or account eligibility. |
| WA-TEMPLATE | [Twilio WhatsApp key concepts](https://www.twilio.com/docs/whatsapp/key-concepts) | Outside the customer-service window, approved templates are required. Record actual template ID/language/version and window basis; approval does not establish comprehension. |
| WA-SANDBOX | [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) | Joined test recipients and sandbox templates are scoped test facilities. Do not extrapolate to production, other recipients or countries. |
| MSG-STATUS | [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource) | `accepted`/`queued` are provider stages; `sent` is upstream acceptance; `delivered` reflects carrier and, where available, handset confirmation. `read` may be available for WhatsApp. These are not explicit acknowledgement or useful action. Source also describes international E.164 destination format. |
| SMS-COUNTRY | [Twilio country SMS guidelines](https://www.twilio.com/en-us/guidelines/sms) | Country-specific sender and messaging requirements must be assessed for the actual number destination; the country index is not proof an account can send. |
| SMS-PERMISSION | [Twilio SMS Geo Permissions](https://www.twilio.com/docs/messaging/guides/sms-geo-permissions) | Account geography controls are a separate eligibility check from published coverage. No permissions were changed. |
| VOICE-PERMISSION | [Twilio Dialing Permissions overview](https://www.twilio.com/docs/voice/api/dialing-permissions-resources) | Account/subaccount and destination-prefix restrictions matter. Published country reach does not establish our enabled destinations. |
| VOICE-STATUS | [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource) | `completed` establishes connection/audio transfer and can include voicemail or IVR. Keep explicit recipient arrival, comprehension, acknowledgement and action observations separate. |
| RECEIPT-INTEGRITY | [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) | Later evidence must retain signature-verification provenance; a pasted status string is insufficient. This kit performs no signature verification or webhook handling. |
| WA-COST | [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing) | Dated pricing source to consult for the chosen destination/category and provider fees. No applicable quote or amount established for ANDES. |
| SMS-COST | [Twilio SMS pricing, Peru](https://www.twilio.com/en-us/sms/pricing/pe) | Example of a destination-specific price page, not a Peru launch decision. Generic SMS pricing redirected to US; that default must not populate a LATAM cost row. |
| VOICE-COST | [Twilio Voice pricing, Brazil](https://www.twilio.com/en-us/voice/pricing/br) | Example country/prefix pricing reference, not a Brazilian availability claim. Generic voice pricing redirected to US; no regional or account-specific price inferred. |

The Meta [Groups documentation endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
returned HTTP 429 during this check; the [older endpoint](https://developers.facebook.com/docs/whatsapp/cloud-api/groups)
also could not be retrieved. **Unverified source gap:** no eligibility threshold,
existing-group interoperability or group availability claim is drawn from either page.
Third-party mirrors and API mentions were not used as evidence. Actual account/group
eligibility stays unknown/conditional until current official requirements and the
specific account, existing group and member observations can be reviewed.

Spanish and Brazilian Portuguese template/voice comprehension, international-number
routability, actual sender eligibility, consent, costs, recipient arrival and acknowledgement
are all **unobserved**. No website can establish those facts about our accounts or people.
Documentation access dates are not live test dates. This register is not a country-law
or compliance determination; those decisions and evidence gates remain separate.
