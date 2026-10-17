# Channel evidence kit · issue #10

Preparatory, offline tooling for ANDES (GOAT). The [issue](https://github.com/Bimbi-Dev/andes-hackathon/issues/10)
remains blocked by #9 and the parent #1 evidence gates. Sebastian is accountable.
This kit does not establish channel availability, activate an account, send a message,
freeze the application stack/event contract, or authorise a pilot. Q44 owns integration;
component47 supplies the independent review. An author test pass is not that review.

## Run without installs

From the repository root, using Python 3.9 or newer (actually exercised: 3.14.7):

```sh
python3 -B -S evidence/channels/check.py evidence/channels/matrix.blank.json
python3 -B -S evidence/channels/check.py evidence/channels/examples/partial.synthetic.json
python3 -B -S evidence/channels/check.py evidence/channels/examples/false-supported.synthetic.json
python3 -B -S -m unittest discover -s evidence/channels -p 'test_*.py' -v
```

The first two commands exit **0** (internally consistent, still untested/conditional).
The third must exit **1** (unsupported claim, the negative control). Tests exit **0**.
Exit **2** means unreadable/malformed input or CLI usage. `-S` disables site packages;
`-B` avoids bytecode files. No packages, SDKs, services, credentials or network are needed.
The checker reads one UTF-8 JSON file and prints a JSON report; it never edits evidence.

`consistent: true` means only that the supplied assertions satisfy these rules.
It is **not** a truth certificate or a gate for enabling a channel. Forged records
with plausible metadata can pass. The CLI does not fetch URLs, open artifact locators,
authenticate signatures, check actual consent, consult provider accounts, verify a
country/number registry, or independently assess comprehension or action usefulness.
Every result includes that limitation and lists explicit gaps, including unknown cost
and action even when the narrower channel-support assertion is internally consistent.

## Blank matrix and schema

Copy [matrix.blank.json](matrix.blank.json) for each proposed combination. The blank
template reserves Spanish (`es`) and Brazilian Portuguese (`pt-BR`) rows for WhatsApp,
SMS and voice, plus existing WhatsApp groups. Countries, accounts, recipients, costs,
terms dates and observations are unset; no launch geography or provider is selected.

| Channel | Audience | Language | Driver / recipient / number countries | State |
|---|---|---|---|---|
| WhatsApp | Individual | es | unset / unset / unset | untested |
| WhatsApp | Individual | pt-BR | unset / unset / unset | untested |
| SMS | Individual | es | unset / unset / unset | untested |
| SMS | Individual | pt-BR | unset / unset / unset | untested |
| Voice | Individual | es | unset / unset / unset | untested |
| Voice | Individual | pt-BR | unset / unset / unset | untested |
| WhatsApp | Existing colleague group | es | unset / unset / unset | untested |
| WhatsApp | Existing colleague group | pt-BR | unset / unset / unset | untested |

[schema.json](schema.json) describes the structure using JSON Schema 2020-12.
`check.py` implements only the keywords used by this bundled schema, plus the rules
below; it is not a general JSON Schema implementation. Unknown fields and versions,
missing keys, empty text, duplicate keys/IDs, malformed timestamps and wrong types
fail. Keep keys present and use `null`, `unknown` or empty evidence lists for gaps.
Do not turn missing evidence into `false`, zero cost, or an unavailable-country claim.

| Field | Meaning and required provenance |
|---|---|
| `record_kind` | `blank`, `synthetic`, or `evidence`. Synthetic observations must retain synthetic mode. |
| `scope` | Driver country, recipient's actual country, number country, recipient language, channel, audience, provider and pseudonymous account/recipient/group references. Two-letter country and language syntax is checked; actual code allocation is a reviewer check. |
| `checks.account` | Eligibility of this account, sender, destination and use case, with an account record. A provider name/account label is insufficient. |
| `checks.opt_in` | Recipient permission for the specific messages/calls and channel; retain withdrawal and effective scope in the restricted source. Group membership alone is not consent. |
| `checks.number_format` | A source record of international E.164 format and its number-country assessment. Do not store raw phone numbers here. Format alone does not establish routability or current recipient location. |
| `checks.template` | Approval/rejection of the exact language/version or a dated explanation for `not_required` (for example a scoped service window). Store template ID, window basis or voice-script version in its source/summary. |
| `checks.comprehension` | Separate observed comprehension of the template or voice script and reply path in this language. Translation or template approval alone is insufficient. |
| `checks.existing_group` | Actual existing-group eligibility and scoped group evidence. Individual delivery and an API mention cannot qualify an existing group. |
| `terms`, `cost` | Official-source evidence ID and check timestamp. Cost amount/currency/unit must occur together; leave unknown amounts null. Preserve destination, category, direction, fees, taxes and billing assumptions in the source summary. |
| `attempt` | One message/call ID and environment, separate provider acceptance/delivery, separate recipient observation, explicit acknowledgement path and separate useful action. Each observation references the same ID and environment. Use another row for a retry. |
| `evidence` | Row-local IDs, kind, mode, observation and recording times with UTC offsets, attribution, artifact locator, summary, provider ID when applicable, scope snapshot and verification status. |

Country fields deliberately differ: a contact currently in Brazil may use a Chilean
number while the driver is in Peru. This synthetic example is not measured coverage.
An evidence scope snapshot must match its row; changing country, account, language or
group cannot silently reuse the old observations. `recipient_ref` for a group records
the observed recipient/member set; one member's reply does not establish all members'
delivery. Source text must state the population and limits, and reviewers must check it.

## Qualification rules

| State | What the checker requires and what the state does not establish |
|---|---|
| `untested` | No attempt-stage observations; eligibility/docs may be researched. Blank rows remain useful incomplete records. |
| `conditional` | Explicit unresolved conditions. Use for documentation-only, synthetic, sandbox, missing live eligibility, group uncertainty, incomplete arrival or acknowledgement evidence. |
| `unavailable` | Explicit scoped reason and dated documentation/live evidence basis; mock or sandbox-only failures do not establish general unavailability. A temporary failed attempt is not a regional ban. |
| `supported` | Evidence document, complete scope, no unresolved conditions, live account/opt-in/number/template/comprehension evidence, actual group evidence if relevant, dated terms, live traceable attempt, verified provider receipts, separately observed arrival and explicit observed acknowledgement. Still limited to the recorded case and date. |

`supported` is deliberately stricter than sandbox success. A sandbox can test mechanics
for joined recipients; it cannot establish live account or regional coverage. Unknown
cost remains null and is reported even for a structurally qualified support row; this
is a channel observation claim, not commercial readiness or permission to spend.

For each provider receipt, retain the raw provider status, its documented bounded
meaning, official source, message/call ID, and the restricted signature-verification
record in `verification_ref` (separate from the raw artifact `locator`) and `summary`.
`verification: verified` is the submitter's assertion,
not verification performed by this CLI. Future authorised review must inspect the
signed payload and verification procedure. Never put secrets or full webhook payloads
in this repository.

The bounded status vocabulary follows the [source register](SOURCES.md): message
`delivered` (WhatsApp may also report `read`) and voice `completed` may describe provider
delivery/connection. `accepted`, `queued`, `sent` or `ringing` cannot establish arrival.
Voice completion can be voicemail; read receipts do not demonstrate comprehension.
Other provider statuses require an explicit schema/checker review, not guesswork.

Acknowledgement requires its own recipient observation and explicit path (for example
a stationary text/button reply or an observed DTMF response). Useful action remains
unknown unless separately reported; `corroborated` needs a distinct independent
observer. Neither acknowledgement nor useful action is proof of driver wellbeing,
robbery, sleep, or reduced harm. No reply never infers an incident.

Observation and recording timestamps are distinct. The checker rejects observation
after recording and acknowledgement before arrival; callback ingestion order does not
define human chronology. Preserve contradictory originals and report the errors;
do not delete failed evidence to obtain a pass. Clock skew or ambiguous lineage needs
review and separate conditional records, not invented corrected timestamps.

## Examples, limits and handoff

The partial example contains no operational evidence. The false-supported example
intentionally fails. `test_check.py` also constructs fabricated complete assertions
in memory, including `mode: live`, to exercise the positive code path; these are never
exported as real evidence. The tests cover forged support from documents, mock/sandbox
records and account labels; cross-country/language/account reuse; voice voicemail
ambiguity; mismatched IDs; missing signatures/provenance; absent replies; contradictory
receipts; dates; malformed JSON; and missing/zero-cost source claims.

Only redacted synthetic fixtures and this blank template belong in Git. Later authorised
observations and raw originals need an approved restricted store and reviewer access;
opaque locators here do not prove that store exists or is accessible. No real recipient
contact, account activation, collection, hosting, installs or spending occurred.

Next evidence work remains conditional: verify account/destination eligibility and the
actual existing colleague group, then separately authorised opted-in stationary tests
for each promised country/channel/language. Where group support is unresolved, retain
opted-in individual delivery or stationary manual sharing as proposals; no unofficial
automation. Fallback order and deadlines remain unset until observed timings and the
incident window justify them. #9/#1 gates, independent review, privacy and benefit
evidence remain open. Passing this kit does not close #10.
