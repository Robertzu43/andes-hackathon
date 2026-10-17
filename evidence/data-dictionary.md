# Data dictionary · #8 freight trip reconstruction

Four tables, kept as spreadsheets and saved as UTF-8 CSV with these exact column names. Blank copies are in `templates/`. Use this dictionary to enter and manually review the sheets. Automated checking and export tooling are outside this materials-only slice.

## Conventions

- **IDs** use capital letters, digits and hyphens, with at least one letter: `P03-D`, `C03-W`, `C03-W-S2`, `C03-W-E07`. They are codes. Never use a name, phone number or plate as an ID. The key linking codes to people stays offline with the consent forms.
- **Lists** separate values with `;`.
- **Times** are ISO 8601 with the UTC offset in force at that moment: `2026-09-14T21:40-03:00`. Format time columns as plain text so the spreadsheet does not rewrite them. A WhatsApp export shows local phone time without an offset; convert it with the phone's time zone and record that zone in `source_time_zone`.
- **`unknown`** is a recorded answer. Leave a cell blank only where this page says it may be blank.
- **Exported** says whether the column leaves the private folder in the redacted export. `private` columns never do, and neither does any column added to a sheet. "Scanned" columns need identifier checks before sharing (see the export section).

## participants.csv

| Column | Values | Exported | Meaning |
|---|---|---|---|
| `participant_id` | ID | yes | One person. |
| `pair_id` | ID | yes | Shared by a driver and their trusted contact. A pair is one driver and one contact. |
| `role` | `driver`, `contact` | yes | |
| `country_of_residence` | two-letter code such as `BR`, `CO`, `MX` | yes | |
| `preferred_language` | language tag such as `es`, `pt-BR` or `es-419` | yes | Language of the guides used with this person. |
| `phone_platform` | `iphone`, `android`, `other`, `unknown` | yes | Phone used on the reconstructed trips. Feeds the #9 device coverage. |
| `work_arrangement` | `owner_operator`, `independent_driver`, `fleet_employed`, `other`, `unknown`; contacts use `not_applicable` | yes | How the driver works. `fleet_employed` is outside the target segment and raises a warning. |
| `trucks_operated` | `1`, `2`, `3_or_more`, `unknown`; contacts use `not_applicable` | yes | Trucks the driver owns or operates. `3_or_more` raises a warning. |
| `relationship_to_driver` | `family`, `fellow_driver`, `freight_company`, `friend`, `other`, `unknown`; drivers use `not_applicable` | yes | Who the trusted contact is. `freight_company` covers a carrier, shipper, broker or dispatcher. |
| `consent_ref` | free text | private | Required reference to the consent record held offline. The reference must exist; legal validity needs the approved consent process. |
| `consent_recording` | `yes`, `no`, `pending` | no | Consent to record the interview. |
| `consent_share_redacted` | `yes`, `no`, `pending` | no | Consent to share the redacted account with the GOAT team. Export needs `yes` from both people in the pair. |

## cases.csv

| Column | Values | Exported | Meaning |
|---|---|---|---|
| `case_id` | ID | yes | One reconstructed freight trip. |
| `pair_id` | ID | yes | |
| `trip_kind` | `worrying`, `ordinary` | yes | Each pair gives one of each. A missing one raises a warning. |
| `synthetic` | `yes`, `no` | yes | `yes` only for invented test data. |
| `concerns` | list of `security`, `fatigue`, `lost_contact`, `breakdown`, `crash`, `health`, `other`; or `none` alone | yes | What made the trip worrying, as the participants describe it. `security` covers robbery, attempted robbery, being followed and threats. `fatigue` covers tiredness, sleepiness and problems finding rest. |
| `trip_countries` | list of two-letter codes | yes | Countries the trip passed through. |
| `interview_language` | language tag | yes | |
| `load_status` | `loaded`, `empty`, `mixed`, `unknown` | yes | Cargo on board. `mixed` when it changed during the trip. |
| `haul_type` | `local`, `interurban`, `cross_border`, `mixed`, `unknown` | yes | |
| `corridor_label` | free text, may be blank | yes, scanned | Coarse route description such as "interstate route with a mountain stretch". No addresses, coordinates or exact places. |
| `connectivity` | `good`, `patchy`, `none`, `mixed`, `unknown` | yes | Phone signal along the route, as reported or recorded. |
| `arrangement` | free text, may be blank | yes, scanned | What the pair had agreed for this trip. |
| `arrangement_channels` | list of `whatsapp`, `call`, `sms`, `radio`, `location_sharing`, `tracking_service`, `other`, `none`, `unknown` | yes | Channels in that arrangement. `tracking_service` is a tracker or monitoring service run by someone else, such as a risk-management company. |
| `actionable_window` | `yes`, `no`, `unknown` | yes | Reviewer judgement: was there a period when a useful action was possible? |
| `someone_available_to_act` | `yes`, `no`, `unknown` | yes | Was someone able to act in that period? |
| `unmet_problem` | `yes`, `no`, `unknown` | yes | Did the existing arrangement leave a problem unsolved? |
| `window_start_event`, `window_end_event` | event IDs, both or neither | yes | The claimed intervention window, from the moment the driver's status became unconfirmed or help was needed to the first useful action. Required when `actionable_window` is `yes`, not allowed when it is `no`. |
| `driver_review`, `contact_review` | `pending`, `confirmed`, `corrected`, `disputed`, `declined` | yes | Result of each person reviewing their own account. |
| `trace_review` | `pending`, `traced`, `not_traceable`, `inconclusive` | yes | Result from a reviewer outside implementation who traced the window to its sources. |
| `redaction_status` | `not_started`, `in_progress`, `reviewed` | no | Export needs `reviewed`. |

## sources.csv

| Column | Values | Exported | Meaning |
|---|---|---|---|
| `source_id` | ID | yes | One piece of evidence. |
| `case_id` | ID | yes | |
| `kind` | `interview_driver`, `interview_contact`, `whatsapp_export`, `call_log`, `sms`, `location_history`, `tracking_log`, `screenshot`, `independent_record`, `other` | yes | Source format or origin only. A police, insurer or carrier record can use `independent_record`, but that label does not establish corroboration. |
| `provided_by` | participant ID | yes | Who supplied it. An interview comes from the person with the matching role. |
| `evidence_basis` | `attributed_account`, `independent_observation`, `contact_status_only`, `unknown` | yes | What the source contains. Interviews and a complaint merely repeating a driver's allegation use `attributed_account`. Call status or location metadata alone uses `contact_status_only`. `independent_observation` requires `kind=independent_record` and actual observations independent of the allegation; describe what supports the specific event in its `basis_note`. If not established, use `unknown`. For mixed documents, make separate source rows for the relevant excerpts. |
| `timestamped_record` | `yes`, `no` | yes | `yes` when the source carries its own clock times. Interviews are always `no`. |
| `source_time_zone` | IANA zone or `unknown`; required when timestamped | yes | Zone of the clock that produced the source's times. |
| `storage_ref` | free text, may be blank | private | Where the original is held in private storage. |
| `note_private` | free text, may be blank | private | |

## timeline.csv

| Column | Values | Exported | Meaning |
|---|---|---|---|
| `event_id` | ID | yes | One account of one moment. When the driver and the contact describe the same moment differently, use two rows. |
| `case_id` | ID | yes | |
| `seq` | whole number from 1, unique in the case | yes | Reconstructed order. |
| `event_type` | listed below | yes | What happened. Judgements such as "this was the useful action" belong in the case window. |
| `actor` | `driver`, `contact`, `third_party`, `system`, `unknown` | yes | Who did or experienced it. For `checkin_due`, the person who expected to hear from the other. |
| `reported_by` | participant ID or `record` | yes | Whose account the row is. Use the participant for `self_reported` and `reported_second_hand`; `record` is for an act shown by a record, such as a message being sent. |
| `occurrence` | listed below | yes | How the team knows it happened. |
| `source_ids` | list of source IDs from the same case, at least one | yes | The evidence behind the row. |
| `basis_source_id` | source ID; required for `suspected` and `corroborated`, otherwise may be blank | yes | The specific source supporting the classification, also in this event's `source_ids`. A suspicion requires an attributed account supplied by the participant in `reported_by`. Confirm the account actually expresses that person's suspicion; supplying a document does not prove authorship. Corroboration requires an `independent_record` with `evidence_basis=independent_observation`. |
| `basis_note` | free text; required for `suspected` and `corroborated`, otherwise may be blank | yes, scanned | For suspicion, state who expressed it and why, as supported by the cited account. For corroboration, state the independent observations and how they support this specific claim. A matching place/time, filing receipt or copied allegation alone is insufficient. The trace reviewer must check the original account and observations. |
| `time_basis` | `observed`, `recalled`, `both`, `unknown` | yes | See the time rules. |
| `observed_time` | time, may be blank | as minutes | Time taken from a record. |
| `observed_source_id` | source ID, may be blank | yes | The timestamped record that gives `observed_time`. It must also be in `source_ids`. |
| `recalled_earliest`, `recalled_latest` | times, may be blank | as minutes | The range the person remembers. Repeat the time for a single moment. Never narrow a range to make it look precise. |
| `time_zone` | IANA zone or `unknown`; required when a time is given | yes | Zone the times are written in. Offsets must match it. |
| `knew` | free text, may be blank | yes, scanned | What the actor knew at this point, and the cues behind any decision. |
| `conflicts_with` | list of event IDs in the same case, may be blank | yes | Rows that disagree with this one. Keep both. |
| `note_redacted` | free text, may be blank | yes, scanned | Short redacted description. |
| `note_private` | free text, may be blank | private | Anything that must stay in the private folder. |

### Event types

- Trip and rest: `trip_start`, `rest_start`, `rest_end`, `rest_difficulty` (no safe or suitable place to stop), `arrival`.
- Messages and calls: `checkin_due`, `message_sent`, `message_delivered`, `message_read`, `call_attempt`, `call_connected`, `contact_unconfirmed` (status remains unknown; requires `occurrence=unknown`).
- Fatigue: `tiredness_report` (felt tired or sleepy), `dozed_off_report` (dozed off or nearly fell asleep while driving).
- Security: `security_concern` (followed, a suspicious stop, a threat), `robbery_attempt`, `robbery`.
- Response: `help_request`, `contact_concerned`, `decision`, `third_party_contacted` (fellow drivers, the freight company, police or others), `assistance_arranged`, `missed_opportunity`, `resolution` (when someone learned how it ended), `other`.

The fatigue, security and rest types are reported states: they can never be `recorded` from phone, location or contact metadata alone. A GPS or tracker stop can be recorded as a stop with `other`; it is not `rest_start` unless a participant account says the driver rested.

### Occurrence

| Value | Meaning and rule |
|---|---|
| `recorded` | A timestamped record shows the act happened: a message was sent, a call was made, a truck stopped. Needs a cited timestamped record. A record can show that someone wrote that they were tired or robbed, or that a truck stopped. It cannot show tiredness, robbery or rest, so sensitive and rest types never use this value. |
| `self_reported` | The person who did or experienced it says so, in an interview or in their own message. Requires that participant in `reported_by`, a role matching the actor, and a cited source with `evidence_basis=attributed_account`. A message export supplied by the other participant can be that cited account; the reviewer checks the declaration against the original message. |
| `reported_second_hand` | Someone else says it happened. Requires the participant repeating the account in `reported_by` and a cited source with `evidence_basis=attributed_account`; that participant's role must differ from the actor. |
| `suspected` | A participant explicitly expressed a fear or suspicion, with their own cited account and stated basis in `basis_source_id` and `basis_note`. Requires that person in `reported_by`. An unanswered message alone does not create this classification. The suspicion is attributed, and the incident remains unverified. |
| `corroborated` | Independent observations support this specific claim. Requires `basis_source_id` pointing to a cited `independent_record` with `evidence_basis=independent_observation`, and `basis_note` explaining the observations. A police complaint repeating the driver's allegation remains `self_reported` with attribution to the driver; a second-hand account remains `reported_second_hand`. |
| `unknown` | Missing evidence leaves occurrence unverified. For no reply alone, use `contact_unconfirmed` with this value, without adding a fatigue, sleep or robbery label. A bounded follow-up under an agreed policy does not change that evidence status. |

Keep contact status and incident verification in separate rows. An unanswered call can be a recorded `call_attempt`; it establishes neither a robbery nor someone's suspicion of one. A separately sourced participant concern can coexist with unknown contact status. `time_basis` describes when the record or recollection occurred, not whether the incident is verified. In particular, a complaint's filing time is not an observed time of the incident it alleges.

### Time rules

- `observed`: `observed_time` and `observed_source_id`, a timestamped record also listed in `source_ids`. No recalled times.
- `recalled`: both recalled times, earliest first, with `reported_by` naming the participant whose memory it is and that participant's own untimestamped attributed account in `source_ids`. No observed time.
- `both`: everything above. The export reports how far the record falls from the memory.
- `unknown`: no times. The row still counts and keeps its place in `seq`.
- Flag observed times that run backwards against `seq`; this may indicate a clock difference between sources or an ordering mistake.

## Export

The following is the proposed handoff contract for later tooling, not an export command available in this materials-only slice. A handoff requires both participants' sharing consent, reviewed redaction and an independent trace review; prepare no handoff until those conditions are met.

- **Cases included:** `redaction_status` is `reviewed` and both people in the pair have `consent_share_redacted` set to `yes`. Other cases appear in `excluded_cases` with their reasons and no content.
- **Removed:** calendar dates, `consent_ref`, `consent_recording`, `consent_share_redacted`, `redaction_status`, `storage_ref`, both private notes and any added column.
- **Times:** minutes from the earliest time in the case, in `observed_offset_min` and `recalled_offset_min` (`earliest`, `latest`). `anchor_local_hour` keeps the local hour of that earliest time.
- **`recall_gap_min`:** for `both` rows, the minutes by which the record falls outside the remembered range. Negative when the record is earlier than remembered, 0 inside the range.
- **`window`:** the claimed window with the basis of each end. `duration_min` gives the shortest and longest possible window from the endpoint times, or null when an end has no time. `traceable_to_records` is true only when both ends have observed times.
- **`conflicts_with`** lists both directions.
- **`coverage`** counts countries, languages, phone platforms, drivers by trucks operated and case concerns, and lists gaps: Spanish (any `es` locale), Brazilian Portuguese (exact `pt-BR`; `pt-PT` does not count), iPhone, Android, security or robbery cases and fatigue cases.
- **Scanned text:** `corridor_label`, `arrangement`, `knew`, `basis_note` and `note_redacted` must not contain calendar dates, email addresses, links, coordinates, phone numbers or vehicle plates. Remove identifiers before sharing. Clock times are allowed. Human redaction review must also cover names, places and cargo details; no automated scan is supplied by this slice.
