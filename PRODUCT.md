# ANDES product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Register
product

## Stack
Brain-delegated recommendation: isolated web/ React + TypeScript browser application with Vite, backed by Robert's existing Fastify/PostgreSQL API and workers. Foundation executor verifies current package compatibility before committing versions. Backend currently requires Node >=24 <27; the agent's Node22 runtime is not the application requirement. Preserve backend package and lockfile ownership. No native client, paid map/transcription service or new external identity provider is selected.

## Users
Independent Latin American freight truck owner-operators with one or two trucks, plus individually accepted trusted contacts. Product scope includes Brazil. Interface language is explicitly chosen between Spanish and Brazilian Portuguese; country, locale and timezone are explicit trip fields. Sebastian has an iPhone for later physical checks.

## Product Purpose
Let a driver prepare and confirm a freight trip, share permitted trip information, report rest/OK/help, and let trusted contacts see available facts and record their response. Address robbery concerns and fatigue during transportation without equating a silent phone with either cause. Deliver the complete integrated software journey in this repository now.

## Positioning
A driver's own phone and chosen trusted contacts support an owner-operator with a small number of trucks. The primary flow must work without a large-fleet company dashboard or dedicated tracking hardware.

## Operating Context
Setup and visual/manual response happen while stationary or in independently qualified modes. A driver may have weak connectivity, navigation/calls in the foreground, denied/revoked permissions or an old location. The trusted contact may use a different phone, country and language. Driver status, source-aged location, server deadline and per-message channel facts must remain separate. Contact acknowledgement is not confirmed help.

## Capabilities and Constraints
Source: existing canonical docs/PLAN.md and issues #8–#44; Robert backend branch codex/aws-durable-backend at ebc8fb1d36f441ef012ca585201cefabf61383d6; exact implemented API is docs/contracts/runtime.md. Backend already implements authenticated truck/contact/draft/trip/location/incident routes and durable dispatch components. New client-read APIs are assigned to41; browser transport45; observations42; driver50; contacts51; foundation49; sole integrator44. API contract is authoritative over proposed UI assumptions. Text trip drafting requires explicit correction and confirmation. Audio/transcription is currently unsupported and must not be presented as operational. WhatsApp group delivery is unavailable until an actual supported capability exists. Phone streams stay gated by measured qualification. No browser timer owns an emergency deadline. No server response, upload, acknowledgement or fixture implies delivery, safety or real-world assistance. Later voluntary research/aggregate reporting stays conditional.

## Brand Commitments
Name ANDES. Hackathon team GOAT. Separate from SurcoCheck. Use Camiones / Caminhões, not passenger cars. No supplied logo, palette or established frontend was found in the source snapshot. Product identity may be created within this scope; no business credentials, testimonials, adoption metrics or safety outcomes may be invented.

## Evidence on Hand
Published preparatory tools for contact checks, check-in suppression, phone recording, channel evidence and evidence gates; reviewed phone adapter PR52 and monitoring projection PR53; Robert's implemented backend and local synthetic test reports. No independently measured iPhone/Android qualification, participant comprehension or live-provider delivery is claimed. Label local demo identities/events and transports as demonstrations. Physical tests and field validation remain open, distinct from software completion.

## Product Principles
1. Show what is known, where it came from and how old it is.
2. Require explicit trip confirmation and scoped contact acceptance.
3. Keep uncertainty visible through retries, suspension and recovery.
4. Make immediate useful actions understandable without hiding their actual state.
5. Review all actionable collaboration feedback before merge; keep unrelated implementation moving.

## Accessibility & Inclusion
Mobile-first, large touch targets, keyboard/focus support, screen-reader labels, reduced motion, sufficient contrast, and full Spanish/Brazilian Portuguese strings including longer/error text. Location must not silently choose language or a national emergency number.

## Authorisation and Open Decisions
The user authorises implementation, local tests, normal commits/pushes, collaboration and merges after review resolution. Public deployment, paid provisioning, real outbound notifications and participant recruitment/collection are not part of this wave. Frontend stack is an implementation recommendation, not a user-selected brand fact. A real login/provider onboarding and external service activation must use actual supported backend contracts; no pretend production authentication. The UI must expose unavailable functions honestly while software integration proceeds.
