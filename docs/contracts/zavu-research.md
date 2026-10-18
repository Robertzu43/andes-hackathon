# Zavu adapter research

Checked **2026-10-17** against the [official index](https://docs.zavu.dev/llms.txt) and the primary pages linked below. This is public-document verification, not account qualification or live-delivery evidence. Only this document was written; no account API, key, sandbox, message, call, redemption or deployment was used.

## Decision and evidence boundary

Zavu is selected for individual SMS, WhatsApp and voice alerts; AWS remains the application backend. Implement the documented REST contract with an injected HTTP transport and synthetic fixtures, **disabled by default**. Individual channels are immediately eligible product choices; the account's configured capabilities, balance, destinations, templates and actual receipts remain unverified. Do not claim an account activation requirement that the docs do not impose.

The [sending-limits reference](https://docs.zavu.dev/concepts/sending-limits.md) says new unverified accounts can send all three channels, with daily floors of 25 SMS, 5 voice and 100 conversational messages. Verification raises ceilings. Sender setup, balance and channel rules still apply. SMS to US/Canadian `+1` destinations requires approved 10DLC registration. These public limits are not measured account entitlements.

## Outbound contract

[Send-message OpenAPI](https://docs.zavu.dev/api-reference/send-a-message.md), [authentication](https://docs.zavu.dev/authentication.md), [sender routing](https://docs.zavu.dev/concepts/senders.md), [channel setup](https://docs.zavu.dev/guides/senders/adding-channels.md):

- `POST https://api.zavu.dev/v1/messages`, JSON; `Authorization: Bearer <server-only-key>`; `Zavu-Sender: <configured-sender-id>` overrides the default sender. Pin the sender explicitly.
- Set `channel` explicitly to `sms`, `whatsapp` or `voice`; set `fallbackEnabled:false` so three application jobs do not cause additional cross-channel fallback. Omitted-channel prose and schema defaults conflict (SMS versus auto); never depend on that default.
- `to` is the individual E.164 recipient for this adapter; `messageType` defaults to `text`. `metadata` values are strings. Send the stable per-attempt `idempotencyKey` **in the JSON body**; authentication mentions an optional header too, but the endpoint schema documents the body.
- Voice here is text-to-speech delivered as a phone call, using this same message endpoint. Set `voiceLanguage` explicitly (`es-ES` or `pt-BR` as documented); do not infer language from country prefix. Two-way voice-agent `/v1/calls` is a different product contract.

Synthetic request bodies (never sent; IDs and numbers are fixtures):

```json
{"to":"+15555550101","channel":"sms","messageType":"text","text":"ANDES prueba sintetica: estado sin confirmar.","fallbackEnabled":false,"idempotencyKey":"andes:attempt-fixture:sms","metadata":{"attemptId":"attempt-fixture"}}
```

```json
{"to":"+15555550101","channel":"voice","messageType":"text","text":"ANDES prueba sintetica. Estado sin confirmar.","voiceLanguage":"es-ES","fallbackEnabled":false,"idempotencyKey":"andes:attempt-fixture:voice","metadata":{"attemptId":"attempt-fixture"}}
```

WhatsApp free text requires the recipient's open 24-hour conversation window. For unsolicited emergency initiation use an approved, configured template; template availability and language are account-unverified. The [template guide](https://docs.zavu.dev/guides/whatsapp/templates/sending.md) documents positional or named body variables, with matching string keys; never mix both formats. Example with a hypothetical approved template:

```json
{"to":"+15555550101","channel":"whatsapp","messageType":"template","content":{"templateId":"tpl_fixture_approved","templateVariables":{"1":"Contacto de prueba","2":"Estado sin confirmar"}},"fallbackEnabled":false,"idempotencyKey":"andes:attempt-fixture:whatsapp","metadata":{"attemptId":"attempt-fixture"}}
```

## Acceptance, idempotency and reads

The [send reference](https://docs.zavu.dev/api-reference/send-a-message.md) specifies **202** for initial acceptance and **409** for project-scoped key replay. A 409 replays the original message in its current state and creates no new send; it is evaluated before quotas/balance. Parse a valid 409 `{message}` as an accepted original attempt, not a generic conflict. Missing/invalid response bodies are ambiguous, not proof of rejection.

Synthetic minimal 202 response (409 has the same envelope):

```json
{"message":{"id":"msg_fixture_1","to":"+15555550101","direction":"outbound","status":"queued","channel":"sms","messageType":"text","createdAt":"2026-10-17T12:00:00.000Z"}}
```

The Zavu identity is `message.id`; optional `providerMessageId` identifies the downstream carrier/provider. Preserve both without requiring an ID prefix. Acceptance/queued status does not prove delivery.

[Get-message OpenAPI](https://docs.zavu.dev/api-reference/get-message-by-id.md): `GET https://api.zavu.dev/v1/messages/{messageId}` with bearer authentication returns **200** `{message: ...}`, **404** if missing, **401** if unauthorized. Message schema statuses are `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `received`, `pending_url_verification`; unknown/new values must not imply delivery. The [SMS guide](https://docs.zavu.dev/guides/sending-messages/sms.md) distinguishes carrier handoff from delivery.

[List-message OpenAPI](https://docs.zavu.dev/api-reference/list-messages.md) has `status`, `to`, `channel`, `limit` (1–100) and `cursor` filters, returning `{items,nextCursor?}`. **No read-only lookup by idempotency key is documented.** Neither key retention/expiry, changed-payload reuse behavior nor a concurrency guarantee for simultaneous identical requests is specified. Do not invent those guarantees.

Application policy: persist the immutable key/payload and authorization before network I/O. A timeout, connection loss, abort, malformed success, or unexplained 5xx after initiation leaves acceptance **unknown**; aborting a client does not establish cancellation at Zavu. Do not resend an ambiguous attempt, even with the same key. With a known message ID reconcile via reads/callbacks. With no ID, ordinary list results or matching phone/text/time are not exact correlation; remain unresolved unless precise verified evidence arrives. Repeating POST is not a read-only recovery operation.

## Errors, limits and retry behavior

[Request-rate reference](https://docs.zavu.dev/concepts/rate-limiting.md) and [sending limits](https://docs.zavu.dev/concepts/sending-limits.md):

| Response | Meaning and adapter treatment |
| --- | --- |
| 400 `whatsapp_window_closed` | Free text cannot initiate outside the window; use an already approved template in a separately authorized attempt. |
| 401 / 404 | Credential or missing sender/template issue; do not automatically resend. |
| 402 `insufficient_balance` | Send refused for balance. |
| 403 `sending_suspended`, `ten_dlc_required`, `url_not_verified`, `url_shortener_blocked` | Refused for configuration/policy; retain exact code without exposing sensitive response data. |
| 429 `rate_limited` | Project request throttle; `Retry-After` is seconds, `details.retryAfter` and `X-RateLimit-Reset` are epoch milliseconds. Default public limit is 600 requests per sliding 60 seconds. |
| 429 `daily_limit_exceeded` | Channel-group budget; top-level `{code,message,details}`; daily reset at 00:00 UTC. |
| 429 `rate_limit_exceeded` | Per-recipient SMS cooldown of 60 seconds; nested `{error:{code,message}}`. |
| 429 `a2p_limit_exceeded` | Conversational monthly cap; nested `{error:{code,message,details}}`. |
| 500 / transport timeout | No documented nonacceptance guarantee; keep unknown unless stronger evidence exists. |

Synthetic error fixtures:

```json
{"code":"rate_limited","message":"Synthetic request throttle","details":{"retryAfter":1792238460000}}
```

```json
{"error":{"code":"rate_limit_exceeded","message":"Synthetic per-recipient SMS cooldown"}}
```

Respect limits without hidden retry loops. A new attempt after definitive refusal still needs prior-emitter quiescence and fresh application authorization. Queued risk review can last hours and later fail with `RISK_REJECTED`, `RISK_REVIEW_EXPIRED` or `RISK_BLOCKED`; queued is not an emergency-latency guarantee. Link-bearing SMS also needs URL verification.

The [TypeScript overview](https://docs.zavu.dev/sdks/typescript/overview.md) describes automatic retries with an option shape different from the `maxRetries` example in the rate guide. Neither reviewed page establishes a server cancellation/timeout contract. Prefer built-in REST HTTP with no automatic retry for this adapter; do not guess SDK options or defaults.

## Raw-body callback contract

[Security](https://docs.zavu.dev/guides/receiving-messages/security.md) and [signature migration](https://docs.zavu.dev/guides/receiving-messages/signature-migration.md) establish:

1. Preserve exact request bytes before JSON parsing. Header name: `X-Zavu-Signature` (case-insensitive HTTP lookup).
2. Parse comma-separated `t=...,v2=...` components; `t` is epoch **seconds**. The documented age window is no more than 300 seconds old and no more than 60 seconds in the future.
3. For v2, compute lowercase hexadecimal `HMAC-SHA256(UTF8(secret), UTF8(header_t + ".") || rawBodyBytes)` and compare equal-length digests in constant time.
4. v1 is HMAC over **body only**. Old timestamp-plus-body v1 examples were wrong. New receivers use v2; configure and require v2 for this adapter instead of silently permitting a downgrade.
5. Secrets are per sender. Rotation immediately invalidates the old secret. Existing v1 senders migrate through `v1+v2` before v2.

Implementation hardening, beyond the guide's permissive parser: reject duplicate required components, noninteger/malformed timestamps and non-64-character hexadecimal v2 signatures; ignore unknown component names. Choose the expected sender/secret from configured receiver context or a bounded configured key set, then validate signed `senderId`/`projectId`; do not trust an unsigned routing claim.

Deterministic synthetic signature fixture: UTF-8 body below, **no trailing newline**, secret `fixture-secret-not-a-credential`, verifier clock fixed at `1792238400` seconds:

```json
{"id":"evt_fixture_1","type":"message.delivered","timestamp":1792238400000,"senderId":"snd_fixture","projectId":"prj_fixture","data":{"messageId":"msg_fixture_1","to":"+15555550101","channel":"sms","status":"delivered"}}
```

```text
t=1792238400,v2=889cbe898f6bbdfaf9c52aa12cefa08a51ca401f6e7c241f2ce7892c54ed294b
```

The digest was computed locally with Python's standard-library HMAC; it is not a provider receipt. A one-byte body change must fail; age 301 or future skew 61 seconds must fail. Age checks do not prevent an authenticated event being retried: deduplicate by verified event ID durably.

## Callback correlation and delivery meaning

[Event reference](https://docs.zavu.dev/guides/receiving-messages/events.md): envelope has `id`, `type`, `timestamp` (epoch **milliseconds**, webhook dispatch time), `senderId`, `projectId`, `data`. Delivery events document `data.messageId`, `to`, `channel`, `status`; failed events add `errorCode` and `errorMessage`. Queued/sent/delivered/failed examples cover SMS and WhatsApp. The [webhook guide](https://docs.zavu.dev/guides/receiving-messages/webhooks.md) also lists `message.read`; the event guide omits its detailed payload. Exact outbound voice receipt payload and human-answer/playback semantics are not established by these pages.

Persist `(provider, projectId, event.id)` once, together with the verified raw evidence and correlation result. Map `data.messageId` to the saved Zavu message ID, checking sender/project/channel/recipient consistency. Callback examples do **not** promise echoed `metadata` or `idempotencyKey`; do not require them or fabricate them.

A callback may arrive before the HTTP response: store it durably as unmatched by message ID; when a response later maps that **same** ID, process the held event. Never associate it by phone number alone. If HTTP times out without an ID, the unmatched callback remains unmatched unless precise evidence identifies the attempt. Authenticated incompatible/contradictory events are evidence, not permission to mark delivery or launch another send.

[Webhook delivery rules](https://docs.zavu.dev/guides/receiving-messages/webhooks.md) require 2xx within 30 seconds and describe retries at 1 minute, 5 minutes, 15 minutes, 1 hour and 4 hours. The prose then says failure after five failed attempts, leaving total-attempt counting unclear. Security explicitly says at-least-once and fresh signing timestamps on retries. Verify, validate and durably save before acknowledging; then process asynchronously. Do not copy examples that acknowledge before durable storage or verify reserialized JSON.

SMS delivery receipts vary by carrier. Delivered/read evidence does not prove that a person understood the alert, accepted responsibility or that the driver is safe. Voice acceptance is not proof a human answered or heard playback.

## Missing facts and enablement checks

- **Account-unverified:** sender IDs/capabilities and allowed destinations, live key, prepaid balance/actual prices, approved WhatsApp templates and languages, expected webhook project/sender and v2 secret, real recipient eligibility/consent, country-specific SMS/voice receipts and observed latency. Keep delivery disabled until these have evidence.
- **Source-unspecified:** key TTL/payload-conflict semantics, read-only correlation by key, server-side timeout cancellation, webhook ordering, exact voice TTS status meaning and callback schema. These gaps must stay explicit.
- **Existing WhatsApp groups:** reviewed index, send schema and channel guides provide no actionable existing-group send endpoint/body contract. Sending-limits prose mentions a group reply, which is insufficient to establish API support or eligibility. Group support remains unresolved; individual broadcasts are not a substitute or evidence of group delivery.
- **No network tests with any key:** [authentication](https://docs.zavu.dev/authentication.md) says `zv_test_` keys deliver real WhatsApp from a shared sandbox number to verified team phones and refuse other channels. Test keys are not a no-send simulator. Some template-guide wording suggests avoiding charges; it does not override the explicit real-delivery warning.

Fixture acceptance should cover exact three-channel bodies/fallback suppression; 202 and replay-409; nested/top-level limit errors; acceptance followed by client timeout; malformed responses; raw-byte v2 verification/tampering/age; duplicate and early callbacks; foreign sender/project/channel; unmatched IDs; and unknown or contradictory statuses. These are engineering fixtures, not provider qualification.
