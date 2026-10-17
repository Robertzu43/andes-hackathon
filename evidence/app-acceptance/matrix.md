# Route and state acceptance matrix

Backend reference: `ebc8fb1d36f441ef012ca585201cefabf61383d6`.
UI paths: pending Brain/49's shared route map; module names below are tasks, not
invented browser URLs. Every browser row is currently **not run**. API receipt
assertions are implemented; live isolated execution belongs46 and is pending.

| Module/task | Actual backend route(s) | States and observable acceptance | Oracle case |
| --- | --- | --- | --- |
| Driver/truck/contact setup | GET `/v1/me`; POST `/v1/trucks`; POST `/v1/contacts`; POST `/v1/contacts/:id/accept` | Owned truck; invitation pending; contact accepts/narrows scope under their identity; no send/delivery claim | setup |
| Draft and explicit review | POST `/v1/trip-drafts`; POST `/v1/trip-drafts/:id/confirm` | Incomplete/draft stays inactive; explicit confirm; country/locale/zone retained; audio unsupported, raw text untrusted | explicit-confirm |
| Confirm retry | Same confirm route | Same key/result, changed/new confirmation conflict; no duplicate active trip | duplicate-confirm |
| Contact map age | GET `/v1/trips/:id/snapshot` | Missing location unavailable; old source stays stale after reconnect; separate capture/receipt/read; older uploads cannot refresh | stale-snapshot, unavailable-snapshot |
| Consent/privacy | POST `/v1/trips/:id/contacts/:grantId/revoke`; POST `/v1/contacts/:id/revoke` | Revoke current trip/standing scope; subsequent contact map/incident access denied; no silent reenrollment | revocation (trip); standing behavior also in46 |
| SOS submission/status | POST `/v1/trips/:id/sos`; GET `/v1/incidents/:id` | Click pending is distinct from server acceptance; unknown on lost response; same-key retry; active report does not prove provider acceptance/delivery | sos-acceptance; UI click/timeout evidence pending |
| Contact response | POST `/v1/incidents/:id/acknowledgements`; POST `/v1/incidents/:id/actions` | Acknowledgement, reported action and independent outcome distinct; conflicting/cannot-assist reports remain attributed | acknowledgement-action; outcome corroboration external |
| Arrival and summary | POST `/v1/trips/:id/commands`; GET `/v1/incidents/:id` | Arrival stops map; incident remains active and readable by current incident contact; no automatic resolution | arrival-preserves-sos |
| Explicit resolution | POST `/v1/incidents/:id/resolve` | Contact forbidden; driver resolves; resolution independent of trip map/liveness | owner-resolution |
| Role/auth recovery | GET `/v1/trips/:id`; POST `/v1/trips/:id/sos` | Stranger forbidden; expired auth/401 remains error; no local fake success or role bypass | cross-user; signed auth in46 |
| Safe check-in/rest | POST `/v1/trips/:id/commands` (`checkin_ok`, `rest_report`) | Attributed self-report only; no moving forced-screen prompt or response required to avoid alarm; ordinary manual prompt deferred for moving/unknown context | self-report; actual UI suppression pending |
| Pause/resume/offline | POST `/v1/trips/:id/commands` (`pause`, `resume`); snapshot GET | Pending/failed/unknown command shown honestly; retry/reconnect no invented acceptance, liveness or sleep; old source stays aged |46 API +50 controller/browser evidence pending |

## Browser receipt inventory

Use every implemented module's full states at 390×844, 1440×900 and 1920×1080;
add the user's actual viewport when supplied. Test Spanish and Brazilian
Portuguese, including long labels/errors and localized timestamps. Use each
builder's approved Design Contract and exact immutable production build. Do not
invent typography, accent or brand policy in this reviewer lane.

For each route/module/section/control/state/context retain: actual URL and Git
SHA, scenario/role, locale, viewport, action and input method, API exchange
reference, expected/actual result, screenshot of every required section/state,
console/network evidence, and remaining issue. The shared UI Evidence Manifest
must pass its versioned validator; missing/stale proof cannot be called pass.

| Axis | Required observations (all not run) |
| --- | --- |
| Loading/error/empty/unknown | Initial empty ownership lists, incomplete fields, slow request, permission denied/revoked, 401/403/409, offline and lost response; success only after observed acceptance |
| Input/keyboard | Accessible field labels and help/errors; logical Tab order; visible focus; Enter/Space where appropriate; dialog focus/escape/return; no keyboard trap; no accidental SOS through unrelated Enter |
| Mobile/overflow | Every section visible; `scrollWidth <= clientWidth`; controls fit and can be reached; no clipped ES/pt-BR error/copy; chosen font loaded before capture; no motion required with reduced-motion preference |
| Contrast | Measure rendered foreground/background ratios at actual text sizes (4.5:1 normal, 3:1 large); examine disabled/focus/error states and non-text controls; retain measured colors and affected control |
| Truth/copy | No-response unknown; cached source age stays visible; operational consent separate from future research; no medical/crime/continuous locked-phone claims or default emergency number for all countries |
| Delivery/action | SOS click, HTTP acceptance, unknown send, provider facts, recipient acknowledgement and reported useful action never collapse into a green delivered/safe state |
| Safe interaction | Moving/unknown ordinary prompt suppressed/deferred; no mandatory screen/tap response to prevent alarm; audio remains unvalidated; exercise only stationary synthetic UI scenarios |
| Reload/persistence | Refresh and role switch reconstruct persisted state from real read APIs, not fabricated local-only state; closed trip/open SOS survives reload correctly |
| Technical/brand | Per-route meaningful title/lang/heading and private/utility handling; approved shared brand assets, favicon/header identity; no exposed private Design Contract/harness/raw evidence in shipped assets |

## Source-backed dependencies, not invented routes

- At this reference there is no registered GET collection route for trucks,
  contact invitations/grants, trips or incidents. Known-ID reads do not supply
  reload/discovery lists. Reported to41/Brain; bind the eventual reviewed reads
  before accepting the corresponding navigation/reload journey.
- No frontend route map, Design Contract/manifest or production preview is yet
  supplied to52. Sent49 a concrete handoff request; preparation continues.
- Coordinate46's own disposable database/ports and signed identities. Do not
  connect to another lane's DB, start workers with live transports, collect real
  location data or call a provider to fill an evidence gap.
- Backend accepts free-text attributed actions but has no verified emergency
  directory or corroboration service. UI must preserve unknown country guidance
  and reported-vs-observed outcomes instead of inventing rescue support.
