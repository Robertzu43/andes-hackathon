# Route and state acceptance matrix

Backend reference: `5591c9b55fe7f4505e36ccee96d27aa913e0debf`.
All API route/payload/schema bindings below are unchanged from the prior source;
the exact dispatch/package delta is recorded in rebindings.md. Historical ebc
receipts remain separate and cannot be promoted to this binding.
UI path patterns: bound to Brain's validated foundation packet below. The actual
production-preview origin and UI states remain pending49; every browser row is
**not run**. API receipt assertions are implemented. Lane46's original isolated
runner was independently verified by52 (61 checks); normalized receipts still
await46's adapter, so that does not mark every oracle case measured.

Contract `andes-operate-v1`, schema1.0.0, independently passed the shared
`ui-proof.cjs verify-contract` validator. Packet read: 2026-10-17,
`andes-app-build/foundation` under the coordinating Brain.
Design Contract SHA-256: `2148eba873c75ba5714247259bc37a25f2e542bb7a978ce11a803e5cbc2660cf`.
Route map SHA-256: `e576c4db008837f993b6826281058297d4ee36ecb2bd8e0ad3c075224b370ea2`.
PRODUCT, DIRECTION, CONTENT-BIBLE, brand identity/contrast and all twelve route
blueprints were read. A validator pass proves contract structure, not rendered
UI, measured contrast, brand assets or successful actions.

| Approved browser route pattern | Owner | Required sections | Primary action hook / local event |
| --- | --- | --- | --- |
| `/` |50| Estado del viaje; Siguiente acción | home-primary / home_action |
| `/session` |49| Acceso; Modo de prueba | session-primary / session_action |
| `/trucks` |50| Camiones; Datos del camión | trucks-primary / trucks_action |
| `/contacts` |51| Contactos; Permisos | contacts-primary / contacts_action |
| `/trips/new` |50| Ruta y camión; Contactos del viaje; Confirmación | trip-new-primary / trip_new_action |
| `/trips/:tripId` |50| Última respuesta; Última ubicación; Avisos; Acciones del viaje | active-trip-primary / active_trip_action |
| `/trips/:tripId/check-in` |50| Estado de la respuesta; Acciones disponibles | check-in-primary / check_in_action |
| `/trips/:tripId/alerts` |50| Solicitud; Canales; Respuesta de contactos | alerts-primary / alerts_action |
| `/contact/trips/:tripId` |51| Ubicación compartida; Incidente; Tu respuesta | contact-trip-primary / contact_trip_action |
| `/contact/invitations/:grantId` |51| Invitación; Permisos | invitation-primary / invitation_action |
| `/trips/:tripId/summary` |50| Viaje; Hechos registrados; Pendientes | summary-primary / summary_action |
| `/privacy` |51| Datos compartidos; Revocar permisos; Uso opcional | privacy-primary / privacy_action |

Hooks are `[data-action="<hook>"]` from the route map. Events are bounded local
test observations, not external analytics or proof of server/provider acceptance.
Route parameters need real authorized synthetic IDs from the isolated run, not
literal colon placeholders. The origin `127.0.0.1:0` in the packet is a placeholder,
not a running preview URL.

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

Use every implemented module's full states at 390×844, 1440×900, 1920×1080,
360×800 and 430×932, as the route blueprints require; 390×844 is the supplied
user viewport. Test Spanish and Brazilian
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
- The approved route map and Design Contract are now read/validated. An actual
  built foundation, Git-bound UI Evidence Manifest and production preview remain
  pending49. Planned routes do not count as rendered screenshots or completed
  controls. Rendered colors,44px touch targets (56px driver primary actions),
  keyboard focus and privacy-safe generic noindex metadata require measurement.
- Coordinate46's own disposable database/ports and signed identities. Do not
  connect to another lane's DB, start workers with live transports, collect real
  location data or call a provider to fill an evidence gap.
- Backend accepts free-text attributed actions but has no verified emergency
  directory or corroboration service. UI must preserve unknown country guidance
  and reported-vs-observed outcomes instead of inventing rescue support.
- Robert PR52 CHANGES_REQUESTED5560453602 supersedes any assumption that its
  prior technical acceptance clears integration. Re-review explicit stop events
  on budgets/lifecycle, long-trip resource boundaries, wake-lock/resume/unsupported
  activation paths, high-accuracy request mapping, explicit demo qualification/
  precise consent, platform motion routes and error floods after50's next freeze.
  Stop-sharing and `/status` APIs are proposed/forthcoming in this packet, not
  present in the pinned backend. Bind actual reviewed source before using them;
  do not wire provisional PR53 clock/deadline inputs over unresolved Robert feedback.
