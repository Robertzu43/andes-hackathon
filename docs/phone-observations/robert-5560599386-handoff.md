# Phone correction handoff to component57

This is a preserved tested author correction slice, not a completed disposition
or independent acceptance. Component57 exclusively owns remaining adapter/test/doc
corrections after the immutable commit supplied in the handoff message. Preserve
this work; do not restart from old 4aca76c. The latest [Robert review](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560599386)
is copied verbatim in [the review snapshot](reviews/robert-5560599386.json).
The original issue19 recorder and all collaborator source remain unchanged.

## Current actual evidence

Node22.22.3: **95/95 author and unchanged recorder checks pass** (64 adapter,
31 recorder). No real browser/sensor/provider/API, install or deployment was used.

```sh
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
```

The exact component57 followup probes run on Node24.17.0: **11/12 pass**.
Only B1 fails: an explicitly small maxCallbacksPerStream still counts raw callbacks
before throttle. The existing large default passes simulated30s/60Hz; component57
must decide/split useful-work versus raw safety guards rather than hiding the
small-cap case.

The unchanged reviewer52 lifecycle controls at immutable
534dba01b2d53bfd970c858be8f2cc53458439dd report **14/16 pass**, versus8/16 at4aca76c.
L11 expects generic platform-error while the corrected timer failure is specifically
timer-unavailable; L12 expects terminal denied from code1 alone, conflicting with
Robert's prompt-dismissal request. Actual L11 does not throw and leaves no token;
actual L12 returns ok:false with permission unknown until browser evidence.
Original probes must remain untouched; independent reviewer owns any separately
versioned expectation updates. Their script's printed candidate string is hardcoded
4aca76c; the source passed through ANDES_CANDIDATE_DIR was this working candidate.
No green independent verdict is claimed.

## Implemented changes to retain

- Coalesce blocked diagnostics per stream/reason, retaining a suppressed count;
  polling cannot spend the entire shared event cap. GPS stop uses geolocation.
- Consent withdrawal purges buffered and not-yet-delivered coordinates, clears
  location/motion/wake intents and records revoked permissions even while stopped.
  This blocks suspended precise resume. Previously handed-out copies require the
  consumer's own deletion/revocation, and queue42 remains separately responsible.
- Synthetic mode requires detached own navigator/document/timer abstractions and
  an explicit injected clock; reject global/prototype aliases and directly reused
  native browser objects/timers, checking again at acquisition. This is a test
  configuration boundary, not a JavaScript security sandbox.
- emit queues captured events; transition boundaries flush detached sink copies
  after state changes. Explicit settled request/permission phase barriers preserve
  cancellation before native acquisition and F1/F2 behavior. Native synchronous
  callbacks cannot call sinks mid-callback. One internal and one delivery copy
  replace the prior three event serializations. Reentrant stop is nonrecursive.
- Passive monitor fulfilment throws/rejections are caught and counted.
- Code1 is ambiguous unless browser permission evidence confirms denied. Fresh
  permission queries use epochs so older grants cannot overwrite verified denial.
  Current-session verified denial/revocation remains terminal.
- Separate permissionPromptTimeoutMs=120000 from requestTimeoutMs=10000; native
  GPS options remain10s, while an outstanding prompt may grant after30s. Inclusive
  prompt/session deadlines and delayed timers still apply. Budget revision is
  engineering-only/3 and must match reviewed configuration; no physical packet
  is supplied. GPS post-grant timeout is armed only after a known grant.
- Motion timer creation failure is structured and cleans the token/late promise;
  clock regression is distinct from timeout; sink stream cancellation is distinct
  from full session stop; synchronous GPS denial/stop returns ok:false.

Original author F2 tests now explicitly configure the new prompt deadline, and
F3 denial fixtures supply actual denied browser evidence. Historical expectations
and reviewer artifacts must not be rewritten or silently counted as current green.

## Remaining exclusive component57 work

1. Repair B1 small-cap useful-work accounting with separately bounded raw work.
2. Inspect all current reviews/independent probes and resolve remaining edges,
   including the two lifecycle expectation differences transparently with52.
3. Make verification/review instructions portable and preserve original evidence.
4. Publish full finding-by-finding disposition with immutable SHA and actual checks.
5. Compose the GPS-only active-trip factory with42's actual pipeline, not a second
   uploader. Current42 source read was9b53b7490da8aa36db9d1a124d87dac7e274f7e5; ask42
   to confirm exact reviewed head. Delegate sink/flush/tripStatus and revokeTrip,
   ensuring adapter stop/purge is synchronous before asynchronous queue deletion;
   expose failures without claiming server receipt. No /sharing route exists.

Brain's scope decision: default active-trip path GPS-only; retain raw motion only
as explicit opt-in qualification/evidence capability outside demo, with all privacy
fixes applying. Robert must confirm this disposition. Component50 moves to driver UI
on accepted controller80e9d45, API45 and shared49 foundation. No merge is authorized.
