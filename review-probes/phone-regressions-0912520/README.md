# Independent corrected phone review: scoped ACCEPT

Exact source **b5a9eb5465513bdbcc392c0a80b51467ca8a2964**, PR52. Compared with091252042581490313437c9035c5165c76828221; the previous9f87e2c comparison and original failures remain preserved. Node22.22.3, immutable archives, detached synthetic platform and clocks. No author source edited.

The five required findings from Robert review5560875615 and its lifecycle/wake gate, drain semantics and cleanup dispositions are addressed within this adapter-library scope. This independent technical ACCEPT does not override unresolved human/gatekeeper feedback or authorize merge. Q44/Robert retain original confirmation and CI/integration requirements.

## Reproduction and results

```sh
ANDES_CANDIDATE_DIR=/ABS/EXACT_ARCHIVE node --test review-probes/phone-regressions-0912520/probes.test.mjs
ANDES_CANDIDATE_DIR=/ABS/EXACT_ARCHIVE node --test review-probes/phone-regressions-0912520/contract-v2.test.mjs
cd /ABS/EXACT_ARCHIVE
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
```

Use Node22.22.3. `source-manifest.json` pins the source/test/doc blobs; `evidence-sha256.json` pins all artifacts.

| Verification | Frozen0912520 | Correctedb5a9eb5 |
|---|---|---|
| Same independent11 checks |4pass/7fail|11pass/0fail|
| Versioned contract3 checks |1pass/2fail|3pass/0fail|
| Actual adapter/recorder suite |Earlier113-pass receipt is historical|124pass/0fail/0skip|
| New author DEMO52 controls against previous source |0pass/11fail|All11 included in124-pass run|
| Original Q52 six-case suite, unchanged |Earlier6pass|5pass/1reported-red|

For the author red control, archive0912520 and overlay ONLY `tests/phone-observations/adapter.test.mjs` fromb5a9eb5, then run `node --test --test-name-pattern=DEMO52 tests/phone-observations/adapter.test.mjs`. This reviewer-only composition uses unchanged old implementation and exactly the current regression file; all11 fail. It is not a deployable or whole-app source.

## Evidence and contract disposition

The unchanged11-check oracle now confirms that a stale after-error prompt cannot cancel an explicit retry, revoked GPS cannot reopen after intent clearing/resume, unavailable wake diagnostics preserve GPS evidence with bounded work, suspended explicit stop publishes terminal intent, failed factory start cannot resume a native watch, GPS retry gating cannot block the independent wake API, and suspended withdrawal publishes nonresumable consent-revoked state. Four nearby controls preserve working GPS, permission revocation, unavailable-GPS bounds, active stop and precise-coordinate purge. Fault attribution and the non-wholly-green9f87 comparison are retained in `baseline-0912520.md`.

The original R05 file and its red output are byte-preserved: it expected a **completed** trip wipe to permanently block the pipeline's **global** drain. The current gatekeeper explicitly requested a disposition permitting other trips to progress. Its output is5pass/1fail, not relabeled as passing. Separate versioned D01 tests the revised contract: pending/failed deletion blocks drain; confirmed successful deletion permits global delegation; this trip's capture/resume/flush remain blocked. This proves wrapper delegation only, not downstream queue implementation or persisted deletion adoption. D02 independently checks per-stream resume success settles after a synchronous sink stop (red before/green after). D03 validates the README's complete exported budget and explicit RangeError for old incomplete copies (positive on both).

Source inspection confirms the request generation is distinct from evidence epoch, initial permission monitoring remains session-scoped, final stop update is bounded and idempotent, resumable reasons/query handling are shared, unused template sessionId is no longer required, and factory state checks avoid cloning a full snapshot. README/event boundary document the two terminal events, independent wake gate, complete budgets and global-drain behavior.

Live feedback read: PR52 all5 conversation comments,9 formal reviews including COMMENTED,0inline comments/0threads in captured snapshot; current Q57 response6244223905 read. Also read updated PR56/62/63 conversations/reviews for the active demo plan. Those other source-specific findings remain independently binding. Original gatekeeper5560875615 confirmation is still required; this is a same-account technical review, not formal approval.

No UI, backend/provider, physical/background phone, integrated real demo, delivery or whole-PR readiness proof follows. Streams remain default disabled and qualification gates open. Actual app verification awaits Q44's URL and final source plus Q56's visual receipt. All older branches, source and review artifacts remain preserved; no merge occurred.
