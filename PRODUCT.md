# Tándem product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Register
product

## Stack
The existing web/ application uses React, TypeScript and Vite with the Fastify/PostgreSQL backend and workers. Use the committed package locks and Node >=24 <27. Preserve the frontend stack and backend package ownership. No native client, paid map/transcription service or new external identity provider is selected.

## Users
Independent Latin American freight truck owner-operators with one or two trucks, plus individually accepted trusted contacts. Product scope includes Brazil. Interface language is explicitly chosen between Spanish and Brazilian Portuguese; country, locale and timezone are explicit trip fields. Physical iPhone checks remain separate from local software verification.

## Product Purpose
Let a driver prepare and confirm a freight trip, share permitted trip information, report rest/OK/help, and let trusted contacts see available facts and record their response. Address robbery concerns and fatigue during transportation without equating a silent phone with either cause. Deliver the complete integrated software journey in this repository now.

## Positioning
A driver's own phone and chosen trusted contacts support an owner-operator with a small number of trucks. The primary flow must work without a large-fleet company dashboard or dedicated tracking hardware.

## Operating Context
Setup and visual/manual response happen while stationary or in independently qualified modes. A driver may have weak connectivity, navigation/calls in the foreground, denied/revoked permissions or an old location. The trusted contact may use a different phone, country and language. Driver status, source-aged location, server deadline and per-message channel facts must remain separate. Contact acknowledgement is not confirmed help.

## Capabilities and Constraints
Source: existing canonical docs/PLAN.md and issues #8–#44; the current published backend base, recorded in Git; exact implemented API is docs/contracts/runtime.md. Backend already implements authenticated truck/contact/draft/trip/location/incident routes and durable dispatch components. The browser uses a shared transport and separate driver/contact components. API contract is authoritative over proposed UI assumptions. Text trip drafting requires explicit correction and confirmation. Audio/transcription is currently unsupported and must not be presented as operational. WhatsApp group delivery is unavailable until an actual supported capability exists. Phone streams stay gated by measured qualification. No browser timer owns an emergency deadline. No server response, upload, acknowledgement or fixture implies delivery, safety or real-world assistance. Later voluntary research/aggregate reporting stays conditional.

## Brand Commitments
The user selected Tándem as the app identity; ANDES remains the project/repository identifier and GOAT the team. The supplied docs/design system v1.0 is authoritative: two paths form the T mark, outlined SVG wordmarks, exact semantic tokens, bundled Manrope and six editable screen references. DESIGN.md points to those contracts. Preserve the accent in Tándem and use Camiones / Caminhões. No new identity interview or replacement palette is needed. No business credentials, testimonials, adoption metrics or safety outcomes may be invented.

## Evidence on Hand
Preparatory contact, check-in, phone and channel tools, the implemented backend and local synthetic test reports provide software evidence only. No independently measured iPhone/Android qualification, participant comprehension or live-provider delivery is claimed. Label local demo identities/events and transports as demonstrations. Physical tests and field validation remain open, distinct from software completion.

## Product Principles
1. Show what is known, where it came from and how old it is.
2. Require explicit trip confirmation and scoped contact acceptance.
3. Keep uncertainty visible through retries, suspension and recovery.
4. Make immediate useful actions understandable without hiding their actual state.
5. Review all actionable collaboration feedback before merge; keep unrelated implementation moving.

## Accessibility & Inclusion
Mobile-first, large touch targets, keyboard/focus support, screen-reader labels, reduced motion, sufficient contrast, and full Spanish/Brazilian Portuguese strings including longer/error text. Location must not silently choose language or a national emergency number.

## Authorisation and Open Decisions
The user authorises implementation, local tests, normal commits/pushes, collaboration and merges after review resolution. Public deployment, paid provisioning, real outbound notifications and participant recruitment/collection are not part of this wave. The frontend stack is already implemented; the user-confirmed design assets govern its visual integration. A real login/provider onboarding and external service activation must use actual supported backend contracts; no pretend production authentication. The UI must expose unavailable functions honestly while software integration proceeds.
