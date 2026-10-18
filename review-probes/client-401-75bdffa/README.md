# Q52 original-reporter confirmation: 401 recovery

Scoped technical **ACCEPT** of the existing 401 correction in PR81 exact `75bdffa42d858c82a8dcb0af11bc78803e3d9a09`, relative to parent `2860d8593f90e1a327ac86cee0ef313d94692489`. This confirms the implementation for Q52 finding5560763168. It does not approve all PR81 routes, adopt dependencies into PR62, or authorize merging.

**PR62 default dependency remains FIX/HOLD.** Its current `efe1629d70374b1202c7535161b3c07f59c8af46` strengthens the regression and fixes README spacing, while its composer still deliberately pins old API `db7034fc9e1dba035b87368117376e9730d6b830`. That default composition still reproduces the failure. The confirmed correction applies when the reviewed helper is supplied; integrator44/Brain must control adoption after the required reviews.

## Why the correction meets the finding

The only production change from286 to75 is the session subscription in `web/src/lib/api/journeys.ts`: a queued notification checks `!disposed` before resetting the bound actor. Direct `dispose()` still sets disposed, unsubscribes and clears once synchronously. The change prevents the captured MemorySession listener from republishing verifying after an earlier gateway listener disposed the binding and closed the feature. No feature guard, transport, credential or server authority is introduced.

Against the preserved Q52 assertion, API parent286 reports:

```json
{"gateway":"signed-out","status":"verifying","session":null,"location":null}
```

The same unmodified assertion with75 reports signed-out/closed/null/null and passes. Original e2c/1fd FIX, raw screenshots and failing probes at reviewer4d4bda2 remain unchanged.

## Independent evidence

Node24.17.0, existing TypeScript5.9.3, private temporary checkouts and owned Chrome profiles. No installs or collaborator source/cache changes.

| Exact boundary | Actual result |
| --- | --- |
| PR81 API75 native unit/view suite | 91/91 pass, including reentrant disposal and frozen e2c contact/driver view recovery |
| API75 strict NodeNext and ESNext/Bundler types | both pass |
| Unchanged original Q52 401 oracle, feature1fd/foundation3283 + full API75 | 1/1 pass |
| Same original oracle with only API parent286 instead | 0/1, verifying instead of closed |
| Frozen feature1fd + full API75 strict UI/fixture types | pass |
| Native browser read401 and write401 + explicit access recovery, feature1fd/full API75/foundation3283 | 2/2 pass |
| Current PR62 efe (same test/source blobs as364 for this finding), old API db7034 + **only journeys.ts from75** | all6 view tests plus unchanged Q52 oracle =7/7 pass |
| Same current feature/tests with untouched old db helper | 5/7 pass, both recovery assertions fail |
| Native browser read401 and write401 + explicit access recovery, **efe/db + only helper75** | 2/2 pass |

The isolated helper SHA256 is `a76892f47d0ad6b9ddcf75c78e849d38c7ef98e8c04796ace77fcbe8d71b685d`. The helper-only source manifest verifies all31 feature/test/API blobs against the explicit pins and one overlay. The earlier full-API fixture independently verifies32 blobs. New current test coverage is at364c4a4 and remains byte-identical at docs-only efe. Rendered feature implementation is unchanged from1fd/e2c except the separately reviewed source-age helper, which rendering does not consume.

Native triggering uses real CDP key/mouse/text input on existing controls. Each case first records an acknowledgement and enters a private draft. A fixture401 on a protected read or write signs the gateway out, shows the existing sign-in gate and removes location/receipts/draft. Native Enter follows that gate to the existing access page; native Enter on `session-primary` explicitly starts the shared gateway. Returning to the original route restores verified data with empty draft/receipt state. Both compositions have zero runtime exceptions. Eight exact-width screenshot rasters are hashed; closed and recovered surfaces were inspected. This is a narrow existing-finding check, not a new composition/whole-app campaign.

All HTTP replies/identity acquisition in these UI checks are explicitly synthetic. It is not real OIDC/provider/backend/SQL/device evidence. No parent7-check signed backend run was repeated for this client-only guard; the prior Q47 acceptance retains its declared source/test scope. Initial native-suite sandbox EPERM on one loopback socket check is retained separately; the91/91 run with owned socket access completes successfully.

## Live feedback and remaining ownership

Read the complete live PR81 review by47 at286 and all current PR62 comments/reviews:81 had0 comments/1 review and62 had4 comments/6 reviews,0 inline/threads on both, pagination exhausted. This includes our original recovery finding, Q45 retry confirmation, Q59's original age finding and its exact1fd confirmation, Q43's prior headless reviews and latest UI privacy review, and all author replies. Q43's latest UI review explicitly covers e2c even though GitHub attaches it to364; it does not confirm the later age correction. Author README nits are fixed at efe.

Q52 confirms only its existing recovery correction in75 and the specific corrected dependency combination. Q47 current-head client review, Q43 current API/auth/privacy and age confirmation, all human feedback and Brain-controlled adoption retain their own roles. PR62's actual old dependency pin remains unfixed until that adoption. No new recipient-discovery adoption, product feature, production entry wiring, merge, live send or issue closure.

## Portable reproduction

Fetch the exact source pins first. With Node24.17.0, from a clean PR81 checkout at75:

```sh
node --test web/tests/api/*.test.mjs web/tests/api/contact-view.integration.mjs
node <typescript5.9.3>/bin/tsc -p web/tests/api/tsconfig.json
node <typescript5.9.3>/bin/tsc -p web/tests/api/tsconfig.json --module ESNext --moduleResolution Bundler
```

For the minimal combination, from a disposable contact checkout at efe:

```sh
node web/tests/contacts/compose-ui.mjs
# Record its printed target. The composer preserves foundation3283 and API db7034.
# Overlay ONLY the exact repaired helper in the disposable target:
git show 75bdffa42d858c82a8dcb0af11bc78803e3d9a09:web/src/lib/api/journeys.ts > <target>/web/src/lib/api/journeys.ts
```

Install the locked dependencies in the target if needed. Copy unchanged `review-probes/contact-ui-e2c/401.integration.mjs` from this reviewer checkout to `<target>/web/tests/contacts/q52-401.integration.mjs`. From `<target>/web`:

```sh
node --test tests/contacts/view.integration.mjs tests/contacts/q52-401.integration.mjs
npm run dev -- --port 0
```

Both assertions fail without the helper overlay (expected5pass/2fail); with it,7pass/0fail. For native checks, run `node review-probes/client-401-75bdffa/helper-proof/native-401.mjs <printed-loopback-origin>` from this reviewer checkout. It exits0 and records both recovery cases. `CHROME_PATH` can select an installed Chromium executable. The script refuses non-loopback origins, owns its browser/profile and closes them. The separate top-level native script/logs preserve the earlier full-API75 boundary; their metadata is not silently promoted to the minimal combination.
