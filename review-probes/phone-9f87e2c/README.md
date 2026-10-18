# Independent Q52 review of PR52 9f87e2c

Scoped technical **ACCEPT** for `9f87e2c08be8ac9e9324136fd0c4401ad8823bc6` against base `bc8eeabfe5220e66a83be972b480a1d1ae8d87d2`. This is a COMMENTED reviewer verdict, not GitHub approval or merge clearance. Robert's CHANGES_REQUESTED reviews remain binding until he confirms the changes and scope; real queue/backend integration remains HOLD. No author code changed, merge or physical evidence claimed.

Source was extracted with `git archive` from the exact candidate. `src/phone-observations` tree `70d56e4168288db4807d0ba7700b7d6e88a12565` and `tests/phone-observations` tree `0c6c493cb2ee43e1d024b68509ae1d3d67bac578` are identical to correction freeze `a9e35aa5c1eba5d1c98e8a9937850d9447662169`. Independent runs used Node24.17.0 and detached synthetic platform/clock; no device, server or shared data was used.

All live public feedback was read: 3 issue comments, 5 formal reviews (including both complete Robert requests and our COMMENTED findings), 0 inline comments and 0 threads, with exhausted pagination. A refresh immediately before publication found the same head and feedback counts. Raw public snapshot is attached here. Earlier scoped ACCEPT did not resolve Robert's subsequent feedback.

## Independent results

| Suite | Actual result |
| --- | --- |
| Exact archive author adapter + recorder | 102/102 pass |
| Q57 complementary follow-up from a9e35aa | 12/12 pass |
| Unchanged original cc4dc5d probes | 17/22; P03/F4 low-accuracy default, P06 browser-managed exclusion, P15 combined deadline, F3 code1=denied expectations differ |
| Unchanged original four reproductions | F1/F2 pass; F3 permission semantics and F4 accuracy differ |
| Unchanged Q52 v2 contract | 20/22; P15/F3 differences retained |
| Unchanged Q52 lifecycle | 14/16; L11 generic timer error and L12 code1=denied expectations differ |
| Separately versioned contract v3 | 22/22 pass |
| Separately versioned lifecycle v2 | 16/16 pass |
| New Q52 independent controls | 5/5 pass |

Original artifacts and red runs remain intact. Original probe SHA256 `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756`, reproducer `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85`. The historical lifecycle's printed candidate remains4aca; the archived code actually tested in every attached log is9f87e2c.

## Explicit contract evaluation

V2 already separately accepted high-accuracy hints by default and opt-in browser-managed motion with permission unknown. V3 changes only P15's pending permission timer to `permissionPromptTimeoutMs` and F3 to genuine browser-confirmed denial. Lifecycle v2 changes only L11's attributed `timer-unavailable` reason and L12's ambiguous code1 permission to unknown, plus the displayed candidate.

A code1 error alone proves no acquired grant; dismissal/policy failure cannot establish a persistent user denial. V3 confirms that a fresh browser denial stays terminal even after an older query resolves granted. Independent V01 confirms the older passive grant cannot promote ambiguous code1 while a distinct fresh query is pending, and prompt permits an explicit retry. The original F3 fake returns the same promise for both queries; its fresh granted observation is therefore not evidence of a stale-query bypass under the revised semantics.

V02 rejects a successful sample at the inclusive post-grant deadline even when its timer is delayed. V03 does the same at the separate prompt deadline. V04 preserves useful success after the acquisition duration while permission is still pending. Prompt bound120s and native acquisition10s are finite engineering choices; they are not measured phone behavior. Session expiry, request/callback/event caps and useful positive controls remain independently exercised.

V05 produces three synchronous native watch callbacks with bufferCapacity1, withdraws at first sink delivery, and verifies that both later queued payloads contain no coordinates even after eviction. Existing L04/L05/L06 establish suspended/active/stopped withdrawal purge and resume refusal. Consumer copies already delivered and network work remain outside the adapter's deletion boundary.

## All review findings and remaining gates

The complete B1–B5, S1–S11 and R1–R6 inventory is in the candidate's `docs/phone-observations/robert-current-disposition.md`, independently checked against source and the suites here. Motion useful-work counting follows throttling with separate finite raw cap; transient/blocked diagnostics preserve useful GPS; reserved terminal delivery is nonrecursive; synthetic global aliases are rejected; synchronous denial/cancellation results, observer faults, timer failures, request IDs/options and source unknowns are attributed. The trusted gesture bridge stays synchronous and rejects fabricated dispatch. No scope label establishes physical qualification or a safety outcome.

Real streams remain disabled without matching reviewed device qualification/context. Active trip factory is GPS-only. Raw motion remains optional evidence tooling; Robert has not confirmed that disposition of his remove-motion recommendation. The new queue wrapper is a delegation boundary with synthetic tests; it does not clear Q47's actual queue9b53b74 retirement/durability/sign-out findings or prove adapter→queue→backend upload. Integrator44 must obtain reviewed queue and actual backend evidence; Robert's separate PR74 routes are not adopted here.

Physical iPhone/Android permission/lock/background behavior, battery/data, durable real-browser storage, delivery/provider and human outcomes remain NOT RUN. This technical ACCEPT resolves Q52's source-level findings at the exact head only. Global merge HOLD remains.

## Reproduce

From this reviewer checkout with Node24.17.0 on PATH:

```sh
author_dir=$(mktemp -d)
correction_dir=$(mktemp -d)
git archive 9f87e2c08be8ac9e9324136fd0c4401ad8823bc6 | tar -x -C "$author_dir"
git archive a9e35aa5c1eba5d1c98e8a9937850d9447662169 review-probes | tar -x -C "$correction_dir"
node --test "$author_dir/tests/phone-observations/adapter.test.mjs" "$author_dir/tests/phone-capability/recorder.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test "$correction_dir/review-probes/robert-pr52-followup.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test review-probes/phone-9f87e2c/phone-contract-v3.test.mjs review-probes/phone-9f87e2c/phone-9f87-independent.test.mjs
ANDES_CANDIDATE_DIR="$author_dir" node review-probes/phone-9f87e2c/phone-lifecycle-v2.mjs
# Preserve/observe historical expected failures, each exit1:
ANDES_CANDIDATE_DIR="$author_dir" node --test "$correction_dir/review-probes/historical/cc4dc5d2/probes.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node "$correction_dir/review-probes/historical/cc4dc5d2/reproduce.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test review-probes/phone-contract-v2.test.mjs
ANDES_CANDIDATE_DIR="$author_dir" node review-probes/phone-4aca76c-lifecycle.mjs
```
