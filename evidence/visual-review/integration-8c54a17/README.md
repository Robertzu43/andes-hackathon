# Independent final binding review

Candidate `8c54a17793bb6133d462cfa2598bcefe72c79590`, PR70. Verdict: scoped
technical PASS in an isolated unconfigured/demo FoundationRoot fixture.
The full decision and limits are in `docs/visuals/review.md`.

`raw/wrapper/report.json` records seven independently replayed wrapper groups.
`raw/binding/report.json` records four actual artwork/locale lifecycle groups.
Both intentionally have zero matrix rows: their builder matrix loops were
excluded, preserving the behavior probes without repeating the capture campaign.
`raw/independent-results.json` adds four independent narrow-screen accessibility,
primary-action, actual-art retention and locale/disclosure/remount cases.
Complete axe output is losslessly stored as `raw/axe-*.json.gz`.

The two lifecycle scripts are bounded copies of the candidate's existing
`foundation-check.mjs` and `figures-check.mjs`. Changes are limited to skipping
the matrix, identifying this independent run and resolving source/dependency
paths from this evidence directory. They use the installed isolated Chrome/CDP
helper, with trusted keyboard/touch and native document visibility.

The disposable checkout was `/private/tmp/andes56-8c54a17-git`. With Node24:

```sh
npm ci --prefix web
node web/tests/visuals/integration/prepare-figures.mjs
VISUAL_FOUNDATION_BUILD=/private/tmp/andes56-bound-build node web/tests/visuals/integration/serve-foundation.mjs --build
VISUAL_FIXTURE_PORT=3056 VISUAL_FOUNDATION_BUILD=/private/tmp/andes56-bound-build node web/tests/visuals/integration/serve-foundation.mjs --preview
```

Run a single preview through Codus aux `dev`, not a shell background process.
The evidence scripts use explicit disposable paths and must be rebound if that
checkout moves. Execute lifecycle scripts with the candidate checkout as cwd
so their recorded Git head/status describe the tested source. Set
`VISUAL_FOUNDATION_BUILD` to the same build directory. Pass preview URL and
output directory as the two script arguments. `independent.mjs` uses the
previously installed `/tmp/andes53-tools` Playwright/axe dependencies.

`source-binding.json` verifies unmodified tracked candidate source.
`raw/source-checks.json` independently verifies26 shared Foundation files,
all28 archived artwork files and54 supporting builder capture hashes.
`raw/builder-support` is explicitly builder-authored evidence inspected
read-only, not a new independent capture campaign. `artifact-index.json` hashes
the durable evidence and records actual PNG dimensions. None is a replacement
for the shared schema1.0.0 UI Evidence Manifest or complete UI proof.

Diagnostics preserve an equivalent CSS Lab serialization that rejected an
initial RGB-string assertion and embedded hidden-pane input limitations.
Final runtime palette assertions measure actual sRGB pixels. The embedded
hidden-caption capture proves readable text while that pane is hidden, not
mounted art or native interaction; Chrome/CDP supplies the latter evidence.

No real session/API, trip, notification, physical-device, full-app no-JS,
whole-app acceptance, backend CI or merge claim is made. Component52 owns
assembled-app acceptance and44 owns merges.
