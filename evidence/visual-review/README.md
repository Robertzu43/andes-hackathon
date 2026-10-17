# Independent visual measurements

Component 56 owns these reviewer instruments. They are client-only synthetic
fixtures, not an app scaffold, candidate implementation, or acceptance oracle.
No dependencies, application tokens, private sessions, database, or backend
workers are required. Use Node 24 as required by the repository. Start the
allowlisted loopback server through Codus aux `dev`:

```sh
/Users/sebasbimbi/.nvm/versions/node/v24.17.0/bin/node evidence/visual-review/serve.mjs
```

Open `/sensitivity.html` in the embedded browser. The default broken control
intentionally overflows, has an undersized button, puts the main action below
the viewport, and runs a continuous CSS animation and RAF loop. After loading:

```js
return await andesVisualProbe.sample({ primarySelector: '#primary' });
```

Repeat with `?mode=corrected`. It must have no overflow, 44px targets, an action
inside the viewport, no running animation, and zero idle callbacks/mutations.
Press Tab, then Enter on `#named` using actual browser keyboard tools; inspect
focus and verify the status changes. These are instrument sensitivity results
only. Never assign a candidate PASS from this fixture.

The installed Anatomy `scripts/drive.mjs` can execute
`--actions evidence/visual-review/sensitivity.actions.json` against either
fixture URL. These assertions independently require the known defects in the
broken control and their absence in the corrected control, then actual Enter
activation. No test framework or browser dependency is installed. If embedded
keyboard injection does not activate a native button, retain that limitation
and use the helper's isolated Chrome/CDP keyboard path; do not alter the UI to
make synthetic events pass.

For a real candidate, use a **separate isolated synthetic preview** at its
exact reviewed SHA. Inject the contents of `probe.js` via `browser_eval`;
select the actual visual scope with `andesVisualProbe.observe(selector)`.
Record snapshots at rest, after actual keyboard/touch input, reduced motion,
offscreen, hidden, and after route unmount/remount. Install before module
mount if measuring its entire RAF lifecycle. Post-load installation cannot
account for a scheduler that captured the original RAF earlier. A native
hidden-tab interval must show `visibility: "hidden"`; setting a DOM property
does not prove browser suspension. Restore wrappers with `destroy()`.

All output is measurement, not automated approval. Geometry does not prove
contrast, accessible names, SVG painter order, clipping, source truth, actual
touch interaction, CPU/GPU usage, timers or memory cleanup. Inspect actual
screenshots, accessibility tree, console/network and source. Avoid attributing
page-wide frames to a visual without an isolated mount/unmount baseline.
Reject geometry comparisons with `geometryMeasurable: false`: the embedded
browser may initially report a zero-size hidden viewport before mounting its
preview. Show/capture it, wait for positive dimensions, then measure again.

Preserve candidate captures and raw measurements under a candidate SHA, include
actual viewport dimensions, locale, motion/JS mode, section/state and time.
Required sizes: 360×800, 390×844, 430×932, 1440×900, 1920×1080; Spanish and
Brazilian Portuguese. Native browser presets do not establish all five exact
sizes. Record missing coverage explicitly and use the installed Anatomy
capture/drive helpers for dimensions the embedded browser cannot set. Inspect
every captured PNG and 4× subject/mechanism crops.

Use the shared Codus Design Contract/UI Evidence Manifest and its
`ui-proof.cjs verify-manifest` validator for final proof. Do not substitute a
second receipt schema. Whole-app acceptance remains component 52's scope;
component 56 signs only actual reviewed visual revisions.
