# Phone Demo · Plan B (Web) Implementation Plan

**Status:** frozen.

**Spec:** `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md` §§2, 3, 7 and 9. Screen order, spotlight and the contact flow stay in the spec.

**Mount.** `web/src/main.tsx` renders `<FoundationRoot />` with no `routes` and no `session`, so the contact routes never mount and the driver feature has no route. Build the driver screens and mount the driver and contact routes there with a real `SessionGateway` (`web/src/foundation/session.ts`; demo through `createDemoSessionGateway`). `__ANDES_TEST_HOOKS__` stays test-only.

**CI.** A browser end-to-end test, driver → alert → contact, runs in CI against the real backend. The fake OTP sender exists only as an in-process `createApp` option.

**GPS.** Stays off until Plan C hands over the physical-device qualification packet. This browser test is not that packet.
