# Partial contact repair confirmation; overall FIX remains

Exact source `e3a9478dc2fc2ad0e6543a7a467692240d3b4afc` (PR62), compared with `cf32104a666860a69e745a1d1fbf8b12a4af64f6`. Node24.17.0, unchanged independent public-export probes and reviewer-owned synthetic responses. No live backend, app build, browser, phone, provider or persisted evidence is claimed. No author source changed and no merge occurred.

```sh
ANDES_CONTACT_REVIEW_ROOT=/ABS/EXACT_ARCHIVE node --test --test-reporter=tap review-probes/contact-scope-e3a9478/probes.test.mjs
cd /ABS/EXACT_ARCHIVE
node --test web/tests/contacts/journey.test.mjs web/tests/privacy/consent.test.mjs
```

Independent suite: baseline **2pass/5fail**, candidate **7pass/0fail**, no skips. Five counterexamples distinguish this repair from the old source; two adjacent auth/identity controls pass on both. Existing candidate journey/privacy unit suite: **29pass/0fail/0skip**. Native output is preserved exactly, including its reporter format.

Verified scopes:
- Map403 preserves separately authorized active SOS, acknowledgement receipt and subsequent contact response utility.
- Incident403/404 preserves separately authorized map facts.
- Map denial does not abort or discard an acknowledgement whose request commits; the same write signal remains un-aborted.
- Standing/trip revoke repeated while uncertain issues no new request/key; explicit retry reuses the first key.
- Reading the same incident again preserves this contact's own recorded acknowledgement.
-401 still clears all private context/retries, and a different identity rejects a late old acknowledgement and cached facts.

Inspected both repair deltas80c40cd/e3a9478: protected reads now track separate abort controllers, scoped read denial preserves the other scope, catalog concealment does not replace command state, revoke/resolve concealment retains pending/uncertain command guards, and completed revoke avoids cancelling its own committed request. Catalog UI integration, persisted races and resolve-specific behavior are outside this executable seven-case oracle; do not substitute its passes for those other checks.

Current Robert review5560841696 remains binding. This is only source/controller confirmation of the listed repaired counterexamples, not whole-PR ACCEPT. Required incident read-time/staleness,74 status and contact-role adoption, UI uncertain-command gating, decoder consistency, CI and original gatekeeper confirmations remain open or separately owned. The earlier source-age and supplied-helper401 confirmations keep their exact historical scopes. Current author comment6244207626 explicitly describes a partial repair; the later e3 commit covers command keys and does not close all remaining feedback.

Read live PR62 all7 conversation comments,9 full formal reviews including COMMENTED,0 inline comments/threads in the captured source snapshot; the original Q43 source-age confirmation5560849234 remains scoped. Also read current52/56/63 feedback for the demo acceptance plan. No approval or merge authority follows. Final actual Tándem demo checks await Q44 URL/source and shared Q56 visual receipt.
