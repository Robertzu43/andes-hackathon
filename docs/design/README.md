# Tándem · Design system

Status: design direction and working agreement. The user selected **Tándem** as the product name and requested `Leonxlnx/taste-skill` for the whole design system. This document does not claim a finished component library, approved logo, implemented mobile UI or tested driving interaction. ANDES remains the existing hackathon/repository identifier; do not rename infrastructure identifiers as part of visual work.

## Skill source and scope

Source: [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill), MIT. Reference revision: `f624f37a8c650b9cc550253104925efe4c8de246`, retrieved 2026-10-17.

| Work | Skill | Application |
| --- | --- | --- |
| Logo, identity, palette, typography and brand applications | [brandkit](https://github.com/Leonxlnx/taste-skill/blob/f624f37a8c650b9cc550253104925efe4c8de246/skills/brandkit/SKILL.md) | Start from product meaning, one coherent metaphor, consistent assets and restrained composition. Generated boards are visual concepts, not production vectors or executable tokens. |
| Mobile screen concepts and flows | [imagegen-frontend-mobile](https://github.com/Leonxlnx/taste-skill/blob/f624f37a8c650b9cc550253104925efe4c8de246/skills/imagegen-frontend-mobile/SKILL.md) | Keep one design bible across screens: palette, type, spacing, controls, icon family, navigation and safe areas. This skill generates images only; it does not implement components. |
| Public website and landing | [design-taste-frontend](https://github.com/Leonxlnx/taste-skill/blob/f624f37a8c650b9cc550253104925efe4c8de246/skills/taste-skill/SKILL.md) | Use its content-first direction, composition, tokens and screenshot critique workflow. Its own scope explicitly excludes dashboards and app screens. |
| Implemented app components and contact views | Established Tándem design bible and product contracts | Translate the reviewed direction into the actual client stack. Do not treat an image-generation skill as implementation guidance or impose marketing-page motion/layout rules on operational UI. |

These three skills are installed locally under `~/.codex/skills/`. Other contributors must install/read them in their own environment; local installation is not distributed by a Git push. With Codex's skill installer:

```sh
python3 "$HOME/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo Leonxlnx/taste-skill \
  --ref f624f37a8c650b9cc550253104925efe4c8de246 \
  --path skills/taste-skill skills/brandkit skills/imagegen-frontend-mobile
```

Existing installations should be inspected before updating. Record a new reference revision when intentionally adopting upstream changes.

## Product meaning

Tándem connects an independent freight driver with the people they trust throughout a trip. The core visual idea under exploration is **two paths travelling together**, optionally forming a reduced T. The interface should feel calm, direct and dependable. Avoid police imagery, generic security shields and visual claims that someone is continuously watching or that rescue is guaranteed.

The earlier concept explored navy `#132C3A`, petrol `#087F8C`, ivory `#F7F5F0`, emergency red `#B42332`, and the line “Tu gente, contigo en ruta”. These are proposals, not approved or contrast-qualified tokens. The selected name does not imply trademark clearance. Do not derive exact fonts, geometry or color values by treating a generated image as a production specification.

## Product constraints take priority

Apply taste-skill to the whole visual system while preserving these requirements from the product discussion:

- Voice or text starts trip preparation while stationary. The driver reviews and confirms the trip and sharing recipients before activation.
- During an active trip, use large, clearly labelled controls for “Estoy bien”, pause and SOS. Keep critical controls stable and easy to find; do not depend on icon recognition, precise gestures or decorative animation.
- Treat check-ins as contextual interactions. Curves, demanding driving, refuelling, rest, loss of signal and background restrictions are meaningful states. Do not invent a fixed check-in cadence in the UI or imply that a missed reply proves sleepiness.
- Use a consistent, readable sans-serif system, generous spacing, short copy and restrained color. Support text scaling, screen readers, keyboard focus where applicable, safe areas and reduced motion. Show meaning through text and shape as well as color.
- Reserve emergency red for SOS and incident severity. It is not the general brand action color. Offline, stale location and uncertain delivery must remain distinguishable from confirmed emergency events.
- Keep route and emergency screens visually quiet: solid readable surfaces, no decorative grain behind text, no autoplay media, no compulsory scroll entrances or animation quotas. The mobile skill's decorative defaults are adapted to this driving context.
- Use a coherent, recognisable icon family with consistent geometry and weight; pair critical icons with labels. Keep vendor logos official when depicting infrastructure. The Tándem mark is a separate identity asset.
- Design Spanish and Brazilian Portuguese copy, international telephone numbers, and local timestamps without relying on fixed English-sized labels.

## States are part of the design system

Match actual backend evidence from [the runtime contract](../contracts/runtime.md). Planned states must be labelled as planned until the supporting client/provider behavior exists.

| Surface | Required distinction |
| --- | --- |
| Trip | Draft, confirmed/active, paused and ended; trip completion does not resolve an open SOS. |
| Sharing | Selected contact versus accepted/authorised contact; removing permission ends access. |
| Location | Observation timestamp and accuracy; recent, stale, unavailable and sharing ended. Never animate a stale point as live movement. |
| Check-in | Eligible/deferred prompt, response recorded and no response. “Estoy bien” is a time-specific self-report. |
| Incident | Explicit SOS versus uncertain nonresponse; incident time, last known location with freshness, and current incident status. |
| Notifications | Pending, attempt made, provider acceptance, delivery evidence, unknown outcome and failure; only show each when supported. A contact acknowledgement is a separate fact. |
| Connectivity | Local pending action versus server receipt. Do not show “Avisamos a tu contacto” merely because a button was pressed. |

## Design-to-implementation handoff

1. Create the identity board with `brandkit`; preserve the confirmed name and clearly label proposed logo/type/palette choices.
2. Establish one design bible before generating the mobile flow. Cover trip creation and confirmation, active trip, contextual check-in/pause, SOS and contact response, including degraded states.
3. Define reusable semantic tokens for backgrounds, text, actions, urgency, focus, type, spacing, touch targets and motion. Components reference these roles rather than scattered literal values. Do not invent an additional client framework for the design system.
4. Define component states and behavior alongside appearance: pressed, focused, unavailable, pending, success, error and unknown where relevant. Label demo data and unimplemented actions explicitly.
5. Review rendered screens at actual phone sizes, with enlarged text, both languages and relevant accessibility settings. Measure contrast and target dimensions; record the results rather than inferring compliance from a mockup. Check physical-device interaction before claiming suitability for use on the road.
6. Keep the same approved tokens and assets in Figma and code. For public web work, use the website skill's responsive inspection and critique loop. Follow the environment's browser-tool restrictions when choosing how to inspect.

Current verification is limited to installing/reading the skills and recording this agreement. No Figma design-system library, production logo, contrast audit or device validation is completed by this change.
