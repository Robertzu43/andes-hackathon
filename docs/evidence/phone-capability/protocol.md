# iPhone capability measurement protocol (#9)

Status on 17 October 2026: **not run.** [#9](https://github.com/Bimbi-Dev/andes-hackathon/issues/9) is still blocked by [#8](https://github.com/Bimbi-Dev/andes-hackathon/issues/8). No physical-device observation exists yet, and every row in [`result-matrix.csv`](result-matrix.csv) is `not-run`. The only device available is the owner's iPhone. Android is untested and stays an explicit gap in the matrix.

ANDES serves independent freight truck drivers and owner-operators across Latin America, including Brazil: camioneros with one or two camiones, caminhoneiros with one or two caminhões. Robbery during transport and fatigue or falling asleep are the motivating problems. This protocol does not measure either of them. It measures what a web page can observe on one iPhone, in Safari and as a Home Screen web app, so that later work knows which phone states can carry check-ins, help requests and reports, and which cannot.

The output is evidence for the #9 capability matrix and the timing limits Robert needs for #12 and #21. It cannot by itself pass an acceptance criterion: an independent reviewer records the disposition.

## 1. Before any run

Settle each item with the owner and record it in the run sheet. A run without them is `inconclusive`.

1. **Device identity.** Record the iPhone model and the iOS version from the iPhone's About screen in Settings. Do not take the iOS version from the user agent: Safari 26 on iOS no longer lists the current OS version there [S9]. Record the Safari version shown in the user agent, which still changes with each release [S9]. Record the iPhone's language and region from Settings > General > Language & Region in `language`, so a capability observation can be tied back to the cohort it came from.
2. **Secure origin.** Choose with the owner where the test page is served. It must be an origin the iPhone treats as a secure context: in a non-secure context the Geolocation API calls back with `PERMISSION_DENIED` [S1], and a permission state reads as `denied` [S4]. Check `capabilities.secureContext` is `true` in the first trace. Hosting deployment is not authorised by this slice, so the origin is a separate decision.
3. **Test page.** A later controlled page imports [`recorder.js`](../../../tools/phone-capability/recorder.js). It is not part of this slice, and its design goes through the Brain's UX pipeline. It must start nothing on load. It needs separate tester controls for start, stop, mark, one location sample, location watch on and off, and export. Location is only requested from a tester tap. Motion permission is never requested by the recorder, because `DeviceMotionEvent.requestPermission()` needs a user gesture [S5] and changes device state. Record the revision of the recorder used in `recorder_revision`: the commit SHA of this repository that supplied `recorder.js` for the run, or `unknown` if it cannot be determined. The trace carries only the trace schema (`andes.phone-capability.trace/1`), not the implementation revision, so a run without `recorder_revision` cannot be reproduced against the same recorder later.
4. **Safety and privacy.** Stationary only: at a desk or in a parked truck cab, never while driving. No real trips, no participants; trip collection and pilots are not authorised. Never stage or induce a robbery, tiredness, sleep or an emergency, and never call a test contact pretending one is happening. Location is redacted by default. `rawCoordinates: true` is a per-run tester decision, and those traces never go into this repository or an issue.
5. **Inspection.** Enable Web Inspector on the iPhone (Settings > Apps > Safari > Advanced) and connect it to a Mac with Safari [S10]. Apple documents inspecting a Home Screen web app while it is in the foreground [S10]. A cable connection can charge the phone and a network connection adds traffic, so never attach the inspector during battery, data or offline runs. Mark the run sheet when it was attached.
6. **Conditions.** For each run record: where it ran (`setting`: desk, parked truck cab or outdoors), how the phone was held (`phone_placement`: mount, seat, pocket or hand), power (`charging`: none, cab charger or wall), any app running alongside (`concurrent_app`), network (Wi-Fi or cellular, carrier, country), Low Power Mode, the Location Services setting that applies to the page and whether Precise Location is on [S14], whether the clock is set automatically, and battery percentage.

Apple's guide paths quoted here are for the iOS version selected on the support site on 17 October 2026 (iOS 27) or as stated in the source. Confirm each path on the device and write down the one actually used.

## 2. Roles and clock alignment

- **Tester** holds the iPhone and performs the case steps.
- **Observer** keeps [`observer-log.csv`](observer-log.csv) on a separate device with network time, noting the device, time source and timestamp precision. The observer should not be the tester. If one person must do both, set `observer_independent` to `no`. That run cannot serve as independent ground truth.
- **Sync marks.** At the start and end of every run the tester taps mark (`sync-start`, `sync-end`) while saying "now", and the observer logs the same label. The offset is the trace `wall` time of the mark minus the observer time. Report the start and end offsets and their difference; human reaction time limits the precision. Do not assume a figure for it.
- **Action marks.** For every physical action (lock, unlock, switch app, Airplane Mode on or off, open Settings, start or end a call), the observer logs the time and the tester adds a mark when the page is visible again. While the screen is locked or the page is hidden, the observer log is the only record of what happened.

Observer log `event` values: `sync-start`, `sync-end`, `action` (what the tester did, in `detail`), `device-state` (what the observer saw on the phone), `anomaly` (anything outside the protocol). The log records test actions only. It is never an incident report.

The trace carries two clocks per observation: `mono` (`performance.now()`) and `wall` (`Date.now()`). The monotonic clock never decreases, but the wall clock can be adjusted and can go backwards, and the drift between them is observable [S2]. The specification text reviewed does not say whether the monotonic clock advances while the device sleeps [S2]. Treat that as something to measure from `timer-gap` observations, where `monoElapsedMs` and `wallElapsedMs` are recorded separately. The `start` and `stop` observations also record the device's IANA time zone, because a freight trip can cross zones and borders.

## 3. Contexts

Run each case in both contexts unless the matrix says otherwise.

- **A: Safari tab.** The page is open in Safari on the secure origin.
- **B: Home Screen web app.** Added from Safari with Share > Add to Home Screen and Open as Web App switched on [S13]. From iOS 26 every site added this way opens as a web app by default [S9]. On an earlier iOS, record which mechanism made it a web app. A Home Screen web app shows in the App Switcher separately from Safari [S7].

Record `navigatorStandalone` and `displayModeStandalone` from the trace, and the observer's note of how the page was launched. The launch note decides the context, since the two trace fields are only signals.

## 4. Cases

Each case runs at least twice per context so reproducibility can be judged; the reviewer may require more. Durations are first probes and are not derived from #8. Revise them when the #8 freight timelines show realistic check-in intervals and rest periods. Recorder settings for every run unless noted: `tickIntervalMs: 1000`, `gapThresholdMs: 2000`, `staleAfterMs: null` (freshness stays `unknown`; the #11 freshness limit is UNSET, and raw `ageMs` is the evidence).

| Case | What to do | What the trace and log should show |
|---|---|---|
| C01 Foreground baseline | Start, leave the page visible for 10 minutes without touching it, stop. If the screen dims or locks, record that and rerun with a longer Auto-Lock. | Tick regularity with no gaps beyond the threshold. This is the comparison for every other case. |
| C02 Foreground with location | Grant location when prompted from the sample control, start a watch with `enableHighAccuracy: true`, keep visible for 10 minutes. | `ageMs`, `accuracyM`, callback spacing and `providedFields` while visible. |
| C03 Screen lock | Press the side button, wait 1, 5 or 15 minutes (one variant per run), unlock, mark `unlocked`, wait 1 minute, stop. | Whether `visibilitychange`, `pagehide`, `freeze` fire; the `timer-gap` on return with both clocks; time from unlock to the first observation; same `session.id` or a reload. |
| C04 Screen lock with location | As C02, then lock for 5 minutes, unlock and keep the watch running for 2 minutes. | Whether any position callback arrives while locked. The specification delivers position updates only to visible documents [S1]. Also the age of the first position after unlock. |
| C05 Background | Swipe to the Home Screen or switch to a neutral app that does not use location for 1, 5 or 15 minutes, return, mark `returned`, stop after 1 minute. | As C03. Pulling down Control Center is part of C11 instead. |
| C06 Background with location | As C04 with an app switch instead of a lock. | As C04. |
| C07 Navigate away and back (A only) | In the same tab, open another page, wait 1 minute, go back. | `pagehide`/`pageshow` with `persisted` [S3] and whether the session continued. |
| C08 Location prompt denied | Begin with the page's location access at the default prompt state. Tap the sample control, choose Don't Allow, then tap sample again. | `geolocation-error` with code 1 `PERMISSION_DENIED` [S1]; the `permission` state before and after; whether the second tap prompts again. |
| C09 Location revoked during a watch | Grant, start a watch, open Settings and change the setting that applies to the page to deny location, return. | Whether the page gets a `permission` change, an error callback or silence, and the time after return. The observer records the exact Settings path. |
| C10 Approximate location | Turn Precise Location off for the setting that applies [S14], run C02 for 5 minutes. | `accuracyM` values with Precise Location off. |
| C11 Offline and reconnect | From Control Center turn Airplane Mode on for 2 minutes, then off. | `offline` and `online` events against the observer's switch times; `blur` or visibility changes caused by Control Center. `navigator.onLine` true means only that the browser might be online [S3]. |
| C12 Network handover | With cellular data on, turn Wi-Fi off for 2 minutes, then on. | Whether any network event fires when only the connection type changes. |
| C13 Low Power Mode | Turn on Low Power Mode [S18], repeat C01 for 5 minutes and C03 for 5 minutes. | Differences from C01 and C03. Low Power Mode sets Auto-Lock to 30 seconds [S18], so expect the screen to lock during the C01 variant and log when it does. |
| C14 Terminated | Export first, swipe the page (A) or web app (B) away in the App Switcher, wait 2 minutes, relaunch, start a new session. | The old in-memory trace is lost when the page dies, so the evidence is the last export, the observer log and the new session's start. Note whether Safari restores the tab or reloads it. |
| C15 Shutdown | Export first, power off, wait 2 minutes, power on, unlock, relaunch, start a new session. | As C14, plus the observer times of power off, power on and first page view. |
| C16 Navigation app in front | With a location watch running, open the navigation app the owner would use on a freight route and leave it in front for 5 minutes, then return. | The realistic cab layout: whether ticks, position callbacks or lifecycle events reach the page while another app holds the screen. |
| C17 Phone call | During recording, take or make a 2-minute call with a consenting contact who knows it is a test, then return. | Visibility and focus changes during the call and the gap on return. |
| C18 Long rest, charging | Connect power, lock the screen for 60 minutes; in a second variant, for an overnight-length rest if the owner agrees. Unlock, mark `unlocked`, stop after 1 minute. | Whether anything was observed during a rest-length lock while charging, the gap on return and whether the page reloaded. A long silent interval is unknown. It is not evidence of sleep or of a stop. |
| C19 Extended coverage loss | Airplane Mode on for 30 minutes, then off. | As C11 over a longer outage. Airplane Mode stands in for a stretch without coverage. Weak or intermittent signal on a real route needs a separately authorised test. |
| C20 Time zone change | Turn off automatic date and time, choose another Latin American zone (for example from America/Lima to America/Sao_Paulo), wait 2 minutes, stop, then restore the automatic setting. | `start` and `stop` show different `timeZone` values while `wall` time stays continuous, with no `timer-gap` from the zone change alone. Record the time setting before and after. |

Not covered by this slice. These rows stay in the matrix so the gaps remain visible:

- **N1 motion data and permission.** The recorder only reports whether `DeviceMotionEvent` and `requestPermission` are exposed. A later test needs a gesture-driven permission step. The specification fires motion events only to visible documents [S5]. Cab vibration, potholes and phone handling are confounders for any later motion rule. They never indicate a crash, an assault or sleep.
- **N2 notification delivery.** Web Push needs a sender and a server, which are outside this slice. On iOS it applies to Home Screen web apps from iOS 16.4, after a request made in response to direct user interaction [S7]. Check-in, rest and help prompts that must reach a locked phone depend on this row.
- **N3 audio or other response modes.**
- **N4 Android devices.** No Android phone is available, so this stays untested.

Page Lifecycle `freeze` and `resume` come from a Community Group draft that is not on the W3C standards track [S6]. If they never appear in a trace, record the absence; it says nothing about suspension.

## 5. Freight cab qualification

The published #9 asks for the recorder to be qualified in the freight cab once testing there is authorised. Phone placement, navigation and calls, mounting vibration, charging and connectivity can all change what the page observes. Stationary runs in a parked truck cab (C16 to C19 in particular) are the first step. Anything that needs the truck to move waits for a separate authorisation and a protocol revision. A desk result does not transfer to the cab: record `setting` on every row and keep cab and desk results apart.

## 6. What to keep for each run

- The trace from `exportTrace()`, saved as `<run_id>.json` (for example `C03-A-5m-1.json`), with coordinates omitted unless the run sheet says otherwise.
- The observer log rows for the run.
- The result-matrix row: conditions, file names and a short `observed_summary` written from the evidence.
- Web Inspector console captures, if the inspector was attached.

## 7. Classifying a row

Use these values in `status`. The reviewer records the disposition separately in `review_disposition`.

- `supported`: every repeat shows the behaviour the promise needs, with observer timing that agrees with the trace. A supported state must not imply continuous monitoring after the evidence became stale.
- `degraded`: the page cannot observe during the state but detects and reports the gap afterwards, for example a timer gap after unlock. A product built on it must show the gap and the age of the last observation.
- `unsupported`: the behaviour the promise needs was not observed, for example no ticks or position callbacks while locked.
- `inconclusive`: repeats disagree, evidence is missing, clocks could not be aligned, the observer was not independent where independence was required, or the run left the protocol.
- `not-run`: the default.

No observation pattern classifies a driver state. A timer gap, silence, an offline period or a still phone is unknown. Sleep, fatigue and robbery belong to attributed self-reports, suspected events and independently corroborated outcomes, which #8 and #18 keep apart. They are never inferred from a #9 trace.

A synthetic test, desktop browser, Simulator or Responsive Design Mode result never changes a row. Apple notes that simulators do not replicate the performance or features of a physical device [S12], and that Responsive Design Mode presets do not represent the behaviour of an actual device [S11]. The Node tests in `tests/phone-capability/` exercise recorder logic against a synthetic environment and prove nothing about Safari or iOS.

If the critical scenario needs continuous locked-screen capture the web app cannot establish, #9 says to narrow the promise or record a later native-platform decision. That build is not part of this work.

## 8. Battery and data baseline plan

Issue #9 asks for battery and data use measured against the same journey without the app. Freight journeys are not authorised yet, so the first step is stationary paired sessions that establish the method and its resolution. Journey pairs on a real freight route wait for separate authorisation.

1. **Sessions.** S0: test page closed. S1: recorder running in the foreground without location. S2: recorder running with a location watch. Use 30 minutes each, run in alternating order (S0 S1 S2, then S2 S1 S0) so drift does not favour one condition, and repeat the set.
2. **Hold conditions constant.** Same place, network, brightness and Auto-Lock; no Web Inspector; Low Power Mode off. Keep the battery above 20%, because Adaptive Power can switch Low Power Mode on below that level [S18]. Write down anything that differed.
3. **Charging.** Battery drain can only be read with the phone unplugged, so measure unplugged first. Drivers often charge from the cab, so also run C18 while charging and record power state. A charging session says nothing about drain.
4. **Battery.** Record the battery percentage at the start and end of each session. Afterwards record the Battery screen in Settings: per-app share with on-screen and background time for the day, and View All Battery Usage for the last eight days [S15][S16]. The per-app figures are daily, so other use that day mixes in. Note which entry iOS shows for a Home Screen web app.
5. **Data.** Turn Wi-Fi off, reset the cellular statistics before the session and read the per-app cellular data after it [S17]. Apple notes the carrier is the most accurate source for a billing period [S17]. Note which entry iOS uses for Safari and for the web app. Roaming across a border is out of scope until a cross-border test is authorised.
6. **Resolution.** The battery percentage moves in whole percent. A difference smaller than that is below the method's resolution, so report it that way instead of as zero.
7. **Scope.** This recorder makes no network requests, so these sessions measure the instrument and the method. They are not the product's resource cost. A product with a server connection must be measured again.

## 9. Handoff to #12 and #21

When reviewed runs exist, give Robert one row per measured limit: the limit (for example "longest timer gap while locked", "time from unlock to first position" or "observations while a navigation app is in front"), the context and setting, the values from each run, the number of runs, timing uncertainty from the sync marks, the classification and the trace files. Keep unknown and untested combinations explicit. One iPhone does not establish behaviour for other devices, carriers, countries or truck cabs.

## Sources

All accessed 17 October 2026. Editor's Drafts were used where the latest published W3C version was behind a bot check from the research environment; each links to its published version.

- **[S1]** W3C, *Geolocation*, Editor's Draft 07 April 2026, <https://w3c.github.io/geolocation/>. Non-secure context calls back with `PERMISSION_DENIED`; a hidden document waits until it is visible before a position is requested; position updates are delivered only to fully active, visible documents; `timeout` excludes time spent waiting for visibility and permission; `timestamp` is the time the position was acquired; `accuracy` is a radius in metres; error codes 1 to 3.
- **[S2]** W3C, *High Resolution Time*, Editor's Draft 1 September 2026, <https://w3c.github.io/hr-time/>. The monotonic clock never decreases; the wall clock can be adjusted and decrease; drift between `Date.now()` and `performance.now()` is observable. The text reviewed does not state whether the monotonic clock advances during system sleep.
- **[S3]** WHATWG, *HTML Living Standard*, last updated 16 October 2026: Page visibility (<https://html.spec.whatwg.org/multipage/interaction.html>), where the user agent determines the system visibility state, for example a task switcher obscuring the page; `PageTransitionEvent.persisted` (<https://html.spec.whatwg.org/multipage/nav-history-apis.html>); `navigator.onLine` (<https://html.spec.whatwg.org/multipage/system-state.html>), which returns false only when definitely offline and "is inherently unreliable".
- **[S4]** W3C, *Permissions*, Editor's Draft 06 October 2025, <https://w3c.github.io/permissions/>. `query()` rejects with `TypeError` for an unsupported name; `PermissionStatus` exposes `state` and `change`; in a non-secure context the permission state is `denied`.
- **[S5]** W3C, *Device Orientation and Motion*, Editor's Draft 12 February 2025, <https://w3c.github.io/deviceorientation/>. `DeviceMotionEvent.requestPermission()` rejects with `NotAllowedError` without transient activation while the state is `prompt`; motion events are not fired while the document is not visible.
- **[S6]** WICG, *Page Lifecycle*, Draft Community Group Report 9 June 2022, <https://wicg.github.io/page-lifecycle/>. "Not a W3C Standard nor is it on the W3C Standards Track."
- **[S7]** WebKit, *Web Push for Web Apps on iOS and iPadOS*, 16 February 2023, <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>. Web Push for Home Screen web apps from iOS and iPadOS 16.4; permission requested in response to direct user interaction; a Home Screen web app appears in the App Switcher separately from Safari.
- **[S8]** WebKit, *WebKit Features in Safari 16.4*, 27 March 2023, <https://webkit.org/blog/13966/webkit-features-in-safari-16-4/>. Screen Wake Lock API; Permissions API extended to workers. The recorder only reports whether these are exposed.
- **[S9]** WebKit, *WebKit Features in Safari 26.0*, 15 September 2025, <https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>. On iOS 26 every site added to the Home Screen opens as a web app by default; the iOS user agent no longer lists the current OS version, while the Safari version still changes per release.
- **[S10]** Apple Developer Documentation, *Inspecting iOS and iPadOS*, <https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios>. Web Inspector toggle under Settings > Apps > Safari > Advanced; cable connection, then optional network connection; Home Screen web apps inspectable while in the foreground.
- **[S11]** Apple Developer Documentation, *Responsive Design Mode*, <https://developer.apple.com/documentation/safari-developer-tools/responsive-design-mode>. Viewport presets "don't represent exact layout, rendering, and behavior as experienced on an actual device".
- **[S12]** Apple Developer Documentation, *Running your app on simulated or physical devices*, <https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices>. Simulators "don't replicate the performance or features of a physical device".
- **[S13]** Apple, *iPhone User Guide* (iOS 27), *Turn a website into an app in Safari on iPhone*, <https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios>.
- **[S14]** Apple, *iPhone User Guide* (iOS 27), *Control the location information you share on iPhone*, <https://support.apple.com/guide/iphone/control-the-location-information-you-share-iph3dd5f9be/ios>. Location Services under Settings > Privacy & Security; Precise Location off shares an approximate location.
- **[S15]** Apple Support, *Check battery usage on your iPhone*, published 25 March 2026, <https://support.apple.com/en-us/102432>.
- **[S16]** Apple, *iPhone User Guide* (iOS 27), *Understand your iPhone battery usage and health*, <https://support.apple.com/guide/iphone/understand-iphone-battery-usage-health-iphd453d043a/ios>.
- **[S17]** Apple, *iPhone User Guide* (iOS 27), *View or change cellular data settings on iPhone*, <https://support.apple.com/guide/iphone/view-or-change-cellular-data-settings-iph3dd5f213/ios>.
- **[S18]** Apple Support, *Use Low Power Mode to save battery life on your iPhone or iPad*, published 21 September 2026, <https://support.apple.com/en-us/101604>. Auto-Lock set to 30 seconds; off again once charged to 80%; Adaptive Power can turn it on below 20%.
