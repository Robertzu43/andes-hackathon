# Driver commands and pending check-in policy

Read-only source inventory, 17 October 2026. Published backend
c752de8a3b424bcbc086764dc11052348b27e320 contains only documentation commits after
this driver branch's ebc8fb1d36f441ef012ca585201cefabf61383d6 runtime; these command
semantics are identical. No live prompts, policy changes or new API are authorized
by this inventory. “Check-in” means a voluntary attributed “I'm OK” report, not a
biometric pulse or measured wellbeing.

Source: src/trips/routes.ts, src/api/app.ts, src/contracts.ts,
src/notifications/dispatch.ts and docs/contracts/runtime.md at those frozen heads.
Driver validation.mjs restricts commands to that actual backend enum.

| Actual POST /v1/trips/:id/commands type | Persisted behavior | UI meaning and limits |
| --- | --- | --- |
| pause | Sets paused=true, checkins_active=false and increments version; cancels ordinary pending/claimed jobs. Map remains active. | Explicit pause acknowledgement; refresh trip before showing persisted pause. No pause reason, expiry or automatic resume time is accepted. |
| resume | Sets paused=false, checkins_active=true and increments version. | Explicit resume acknowledgement, not a new deadline/cadence or evidence of safe-to-reply. Previously cancelled jobs are not recreated by this route. |
| checkin_ok | Inserts an attributed trip event at backend receipt clock; no check-in deadline or incident change. | Voluntary I'm OK self-report. Not a safety outcome, biometric pulse, prompt acknowledgement or incident resolution. |
| rest_report | Inserts an attributed trip event at backend receipt clock; does not itself pause check-ins or change incident. | Voluntary rest report, not detected fatigue, verified rest duration or prompt suppression. |
| arrived / cancel | Closes trip, disables map/check-ins and cancels ordinary pending/claimed jobs atomically. Active incident and previously authorized work remain. | An arrival/cancel acknowledgement does not resolve SOS or prove the driver safe. |

Every command requires verified ownership, active trip and Idempotency-Key and
returns only {id,command,automaticEscalation:false}. It does not return an event
source time, last-response timestamp, due time or policy revision. The controller
records clientReceivedAtMs separately and leaves sourceTime null; ambiguous writes
remain unknown and explicit retry preserves the same key/body.

The dispatch authorization path rechecks active trip, checkins_active and paused
for ordinary jobs, separately from active-incident emergency authorization. A
client hiding a prompt is not this server authorization check and must not imply
a server deadline extension or cancelled/undelivered already-authorized work.

Absent at the inspected published backend: /v1/trips/:id/status, /sharing, last
response read, ordinary prompt/deadline discovery, suppression reason/expiry,
eating/busy/fuelling commands, curve/road hazard context and a published versioned
policy for prompt eligibility or deadline changes. Robert owns the future status,
security and #18/#21 contracts. Component41's PR65 owner catalogs do not fill those
gaps; component45 cannot normalize a missing server timestamp from browser time.

UI consequences: keep last response/deadline/per-job facts explicitly unavailable
until Robert publishes them; distinguish local prompt visibility from server
check-in state and acknowledged pause from an in-flight/unknown write. Eating,
busy or fuelling declarations cannot be silently mapped to rest_report or pause
without an approved product/contract decision. Never infer that interaction is
safe from GPS, motion, lack of curves or signal silence. The current controller
requires host-declared stationary/allowed-assistance for writes; moving/unknown
blocks them. The parked PR53 projection must not supply these missing facts.
