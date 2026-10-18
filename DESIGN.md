# Tándem design contract

The user-confirmed design system is [docs/design/README.md](docs/design/README.md), with the [specification](docs/design/specification.md), [semantic tokens](docs/design/tokens.json) and [component inventory](docs/design/components.json). It was supplied on codex/aws-durable-backend at dfa308b3b745a3342891ebcc0771f32a30862d5a. These files supersede the earlier ANDES visual proposal. ANDES is the repository/project name; Tándem is the app.

Use the supplied outlined wordmarks and two-path mark from docs/design/assets. Keep their proportions and clear space. Manrope is bundled in assets/fonts with its SIL OFL license. Reuse the existing React/TypeScript/Vite stack and one shared router, locale provider and component system.

Copy token values exactly, including surface/on-action white. The source palette, font and geometry take precedence over generic style defaults. Semantic action petrol, warning, positive and emergency red have separate roles. Green does not establish driver safety. Targets are at least 48px; primary actions 64px and in-route actions 80px, with room for translated/enlarged text.

Implement real responsive components against the prepare, review, active, offline, deferred and incident references in docs/design/screens. Do not render screen images as the app or infer runtime capabilities from them. Keep OK, pause and SOS order stable. SOS is independent of ordinary interaction gating; arrival does not resolve an open incident. Source observation, server receipt, delivery and human response remain separate facts.

Support Spanish and Brazilian Portuguese, keyboard/touch, text enlargement, safe areas and reduced motion. Keep critical controls visible without a tour, illustration or animation. Optional visuals and the explicit Driver.js tour must not perform writes or hide SOS. Data comes from implemented authenticated backend contracts; missing, denied, offline and uncertain outcomes stay explicit.

Design delivery and its recorded contrast/layout checks are not app, physical-device or live-channel qualification. Independent functional and visual review must cover the final assembled revision.

Implementation uses the Impeccable product craft floor at the digest recorded in docs/design-contract.json. The confirmed Tándem assets and exact tokens override generic style preferences. Installation paths and author/reviewer process receipts stay outside the repository.
