# Trusted-contact preparation for #15

Before a trip can rely on a trusted contact, a human needs evidence that the contact understands the role and can take an agreed useful action. This folder prepares that work for independent LATAM freight owner-operators with typically one or two trucks, including Brazil. Real walkthroughs and enrolment remain **untested**.

This is a standalone offline reference toolkit. It sends nothing, reads no address book, stores no actual contact details and starts no application or service. All executable examples are explicitly synthetic. No interview, participant recruitment, real trip collection or provider activity is authorised by these files.

## Run locally

Use Python 3.10 or newer and its standard library, from the repository root. No install is required.

```sh
python3 -B -m unittest discover -s evidence/contacts -p 'test_*.py' -v
python3 -B evidence/contacts/evaluator.py evidence/contacts/fixtures/synthetic-candidate.json --at 2026-10-17T12:30:00Z
python3 -B evidence/contacts/evaluator.py evidence/contacts/fixtures/synthetic-all-unavailable.json --at 2026-10-17T12:30:00Z
```

The clock is explicit. Tests use invented instants, surrogate IDs and channel labels. JSON output is deterministic for a given input and clock. Exit 0 means a structurally valid synthetic record was evaluated; it can still describe an unavailable contact or an invalid link. Exit 2 means malformed input or a missing/unreadable file. Neither exit code passes a human evidence gate.

Timestamp inputs use `YYYY-MM-DDTHH:MM:SS[.ffffff]` followed by uppercase `Z` or an explicit `+HH:MM` / `-HH:MM` offset. Optional fractional seconds contain 1–6 digits. Offset hours must be 00–23 and minutes 00–59; invalid calendar dates and local time components are rejected too. Compact offsets, offset seconds/fractions and timezone-free values are outside this fixture format. Equivalent valid offsets retain the same inclusive issue and exclusive expiry boundaries.

| Fixture | Expected model result at the instant above |
| --- | --- |
| `synthetic-candidate.json` | One action candidate, a planned action, one contract-valid model link; assistance and enrolment remain unestablished |
| `synthetic-acknowledgement-only.json` | `capacity_unconfirmed`; acknowledgement gives no candidate and establishes no help |
| `synthetic-all-unavailable.json` | `no_contact_can_act`; an honest terminal outcome |
| `synthetic-escalation.json` | First contact cannot assist; only the second appears in the explicit escalation order |
| `synthetic-revoked-consent.json` | `no_authorised_contact`; no candidate and invalid model link |

## What the evaluator checks

`evaluator.py` evaluates a snapshot. The fixture format is private to this preparation slice and makes no claim about Robert's eventual API, identity system or durable state transitions.

| Recorded fact | Model treatment |
| --- | --- |
| `pending`, `rejected`, `revoked` contact | Cannot qualify or have a contract-valid response link |
| `accepted` contact | Still needs current preferences, a recorded reachable preferred channel, mutual trip consent, teach-back, willingness, availability and an action description to qualify in the model |
| Missing or revoked driver/contact consent, trip-level withdrawal, or consent for another trip | Blocks qualification and all model links for that contact, even when an earlier snapshot was valid |
| Preferred channel versus recorded reachable channel | Uses their intersection in the contact's current preference order; no inferred channel fallback |
| Driver language, contact language, driver country, trip country and phone-number country | Stored independently, without country-to-language or phone-to-proximity inference |
| Acknowledgement, willingness, availability, comprehension and action status | Separate fields; acknowledgement alone never qualifies a contact or establishes assistance |
| Explicit cannot-assist, unavailable or unwilling response | Blocks that candidate even if other fields are positive; the next recorded candidate may be considered |
| All authorised contacts explicitly unable/unwilling | `no_contact_can_act`; revise the promise before considering enrolment |
| Any unresolved capacity, including no reply | `capacity_unconfirmed`; unknown remains unknown |

`model_escalation_candidates` preserves the exact supplied order after exclusions. It is a proposed list from synthetic labels and performs no dispatch or handoff. A link may have a valid permission contract while a contact is unavailable; permission to see a minimal field and ability to assist are separate checks. A model action candidate may also have an expired link. Neither result asserts a usable production journey.

Each model link binds a driver, trip and contact; it needs an accepted contact and current mutual per-trip sharing consent. Its nonempty scope must be a subset of both the trip's shared fields and that contact's consented fields. The fixed field vocabulary is `status_uncertainty`, `last_observation`, `observation_age`, `truck_reference`. It carries field names only. Revocation always denies the link, and validity is `issued_at <= evaluation_time < expires_at` with timezone-aware instants. Clock offsets are compared as instants. Duplicate keys, duplicate IDs, unknown fields, unsupported states, ambiguous types, naive timestamps and incomplete orderings are rejected before evaluation.

These checks are an offline permission/expiry contract for discussion with Robert in [#12](https://github.com/Bimbi-Dev/andes-hackathon/issues/12), [#14](https://github.com/Bimbi-Dev/andes-hackathon/issues/14) and [#29](https://github.com/Bimbi-Dev/andes-hackathon/issues/29). They implement no tokens, cryptographic verification, authentication, secure storage, authoritative clock, concurrent revocation, replay prevention or server access control. There is no data-release operation. `shared_trip_data_released` and `assistance_established` are always false; `product_eligibility` and `enrolment_readiness` always remain `untested`.

## Human evidence still needed

Follow [walkthrough.md](walkthrough.md) only after the separate prerequisites and participant authorisation are satisfied. Copy [blank-walkthrough.json](templates/blank-walkthrough.json) and use one [blank-observation.json](templates/blank-observation.json) per source event. Their real-observation, review and eligibility fields are blank. Keep any later authorised evidence in the agreed restricted evidence store, outside this repository; retain only permitted surrogate references here. Do not put actual names, numbers, routes, cargo information or identifying quotations into fixtures or commits.

The harness accepts records labelled `synthetic` only and rejects the blank human templates. Labels and checkbox values can be fabricated or wrong: passing this harness cannot establish meaningful consent, comprehension, present willingness, present availability, delivery, a useful action or physical proximity. Free text is not inspected for personal information or the semantic safety/usefulness of the proposed action. Language labels and country-code shapes are structural labels, not proof of localisation, a recognised country or provider coverage. Snapshot values have no automatic freshness assurance or historical provenance. Every real combination remains untested.

An observed acknowledgement is a phone interaction. A contact's stated willingness, intended action or claim that help was arranged is an attributed report. An independently corroborated outcome needs a separate source and evidence. Even the fixture value `independently_corroborated` remains synthetic and cannot establish a real outcome.

## Dependencies and review

[#15](https://github.com/Bimbi-Dev/andes-hackathon/issues/15) remains blocked by #14 and the parent [#2](https://github.com/Bimbi-Dev/andes-hackathon/issues/2) evidence gate. #12 and #29 interfaces remain Robertzu43's responsibility; this folder does not complete them. Real localisation/comprehension checks, original-baseline comparisons, consent and revocation observation, availability/action evidence and an independent reviewer disposition remain outstanding. No automated emergency-service dispatch or rescue guarantee is included.

Reviewer51 can reproduce the offline checks independently, record a pass/revise/stop/inconclusive disposition against the frozen SHA, and return failures without filling the blank human fields. Author tests are implementation evidence only. A draft PR is preparatory delivery, and leaves #15 open.
