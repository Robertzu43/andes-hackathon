# Independent Q52 contact UI review

**FIX** for frozen UI `e2c1e677cf3ec3fa9c7f91529b082ab5b8ff91e6` and current `1fd365ee7805cd83b2b1a1706973788dea6f805e` of PR62. One P2 recovery defect is reproduced with native browser input and a separate controller/API probe at both SHAs. No author source was changed. No merge is authorized.

## P2: a 401 leaves the contact page permanently verifying

At `web/src/features/contacts/view-store.ts:98–103`, a retired binding's null actor callback can republish `status: 'verifying'` after the gateway already switched to signed-out and cleared the view. In the pinned API `db7034fc9e1dba035b87368117376e9730d6b830`, `MemorySession.#transition` iterates a captured listener array. The gateway's earlier listener disposes the feature binding and publishes closed; its captured `bindJourneySession.reset` then still runs without checking disposed and the feature callback publishes verifying again.

Reproduce at `/tests/contacts/fixture.html?screen=trip`, after the authenticated synthetic fixture's location and incident load: set `window.__CONTACT_FIXTURE__.mode = 'unauthorized'`, then click **Volver a consultar** in **Última ubicación**. The actual typed client receives a401 response and invalidates MemorySession. Protected data is correctly concealed, gateway is signed-out, but the body remains **Cargando información…** without the Gate's sign-in recovery. The footer link still permits manual navigation; this is a stuck feature state, not an authorization leak.

Observed independently at both immutable feature SHAs:

```json
{"gateway":"signed-out","status":"verifying","session":null,"location":null}
```

Expected a closed/expired/recoverable gate once verification can no longer complete. Keep null binding callbacks synchronous for privacy, but prevent disposed/obsolete callbacks from overwriting the gateway's final state. API45 owns the generic binding and contact51 owns this callback/Gate: coordinate one correction. Preserve the existing clear-data checks, add the status/recovery assertion, and verify401 during protected reads/writes plus valid subsequent authentication. Original reporter52 confirmation remains required.

The exact native capture and token-free fixture DOM/call log are included in `captures/FAIL-native-401-refresh-clears-protected-facts--receipts-and-same-actor-draft.png` and `failure-dom-4.json`. The separate executable reproducer is `401.integration.mjs`; it fails at both revisions. The old declared401 test verifies cleared data but does not assert a recoverable status.

## Independent validation and limits

Composition used one real shared FoundationRoot at `3283fe675ebeee04bb2be8a62f42ab5c475b4b0e` and API/session/client at `db7034fc9e1dba035b87368117376e9730d6b830`. Frozen feature checkout was clean. All19 composed feature/test blobs match e2c Git objects; all22 current blobs match1fd. Routes/view store/messages/CSS/privacy renderer are unchanged between the SHAs. Locked dependencies were copied privately from an existing installation after package-lock hashes matched; no install or collaborator cache mutation occurred. Node24.17.0.

| Check | Actual result |
| --- | --- |
| Frozen normal build + strict UI/fixture tsc | pass |
| Declared contact/privacy/controller/API suites | 28 pass, 3 persisted tests skipped by design, 0 fail |
| Author browser suite, independently rerun against immutable composition | 53/53 pass:40 route/locale/viewport matrix +13 functional controls |
| Additional native CDP key/mouse/text scenarios | 6/7 pass; the401 recovery case fails |
| Separate401 controller/API assertion | 0/1 at e2c and0/1 at1fd, same state above |
| Separate map-denial then authorized incident reread | 1/1 pass |
| Current1fd source-age tests | 8/8 pass |
| Current1fd UI typecheck + explicit location-age.types.ts type contract | pass |

The native positives exercise ES/PT-BR invite Enter/Space input, client validation and one explicit-scope POST;301 ASCII codepoints rejected and300 emoji codepoints accepted; acknowledgement/action separate receipts and keys without resolve; uncertain revoke+409 same-key retry with concealed data; missing references cause no invented incident fetch; map403 conceals first and a separately authorized incident reread restores response. The map control waits for the denial to settle before rereading so it does not mistake a deliberately superseded in-flight request for failure.

All native and fixture runtime exceptions remained empty. Forty rendered cases cover390/1440/1920/360/430 widths, both locales, contacts/privacy/invitation/contact-trip. Human inspection included phone contact-trip/response, full privacy, desktop contacts and invitation limits.112 viewport/full-page/extra diagnostic PNGs are retained in the local evidence directory and hash/dimension ledger; five representative images are committed. The known Portuguese select clipping/brand target findings belong to pinned foundation49 and are already recorded in PR56 review5560715902; these are not new feature51 findings or cleared by this review. This is a scoped functional review, not whole-app visual acceptance.

Initial native runner evidence is preserved. An initial301-emoji test was truncated to300 by native maxlength600 and incorrectly expected no POST; the corrected negative uses301 ASCII codepoints, with300 emoji as the positive. An early map test tried the incident reread before the403 settled; the final probe waits for the denial before its separate reread. Neither harness issue is presented as a product finding. The401 failure survived all corrections and the independent controller reproduction.

The current1fd delta changes only README, locationAge and matching tests/type fixture. It preserves raw server age with `asOf: 'server-read'` instead of adding unanchored client wall time. The UI already renders raw age/freshness with as-of-read ES/PT-BR labels. Q59's original COMMENTED helper finding is read and remains owned by59/43 for confirmation; this review does not silently close it.

Read all live feedback at snapshot:1 issue comment,3 complete COMMENTED formal reviews,0 inline comments and0 threads, all pagination exhausted. These include43's original and retry re-reviews,45's uncertainty confirmation and59's source-age finding. Original privacy acceptance stays scoped. Unknown writes retain their exact key and original uncertainty; prior owner/controller confirmations do not establish UI recovery. Human feedback still applies even without CHANGES_REQUESTED status.

Fixtures use actual React/controller/typed HTTP code with explicit synthetic memory-only HTTP replies and identities. No provider/OIDC login, fresh persisted backend/SQL run, deployment, physical phone, notification or human outcome is established. Production normal entry does not mount this feature registry yet; incoming invitation/shared-trip discovery and effective-permission reads remain missing dependencies. Acceptance stays disabled rather than inventing invitation scope. Invitation POST says pending, not notified. Incidents, acknowledgement, reported action, server/source/receipt/read times and unknown delivery/deadline remain distinct. Real whole-app integration belongs to44.

## Reproduce

With Git objects fetched, Node24.17.0 and dependency installation available, use a disposable feature checkout at either tested SHA:

```sh
node web/tests/contacts/compose-ui.mjs
# cd to its printed target/web, then npm ci --ignore-scripts --no-audit --no-fund
npm run build
node node_modules/typescript/bin/tsc -p tests/contacts/ui-tsconfig.json
node --test tests/contacts/*.test.mjs tests/privacy/*.test.mjs tests/contacts/view.integration.mjs
```

Copy `401.integration.mjs` and `map.integration.mjs` from this evidence directory into that composition's `web/tests/contacts/`. Then, from composed `web`:

```sh
node --test tests/contacts/401.integration.mjs # expected exit1 at e2c and1fd
node --test tests/contacts/map.integration.mjs # expected exit0
# current1fd only:
node --test tests/contacts/location-age.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --lib ES2023,DOM --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions tests/contacts/location-age.types.ts
npm run dev -- --port 0
```

Use its printed loopback origin. In another shell, run `node native.mjs <origin>` from this evidence directory; expected6pass/1fail and exit1. `CHROME_PATH` can select an installed Chromium executable. This script owns and closes its private browser/profile, uses trusted native CDP input, and refuses non-loopback origins. The author's complete53-case browser checker is `web/tests/contacts/browser-check.mjs`; its helper dependency/override is documented in the feature README. No tests launch another coding agent.
