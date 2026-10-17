# Integrated backend baseline

This branch preserves Robert's backend at `ebc8fb1d36f441ef012ca585201cefabf61383d6`
and reviewed main at `3d7e724fc7a24a124765611b2cd9ef235fa42d20`. The latter includes
PR51's malformed-offset correction, confirmed by its original reviewer. The PR49
merge incident and superseded acceptance remain in the GitHub discussion.

The backend and offline toolkits run together in this checkout. The toolkits do
not become production classifiers or authorize device capture, messaging or a
pilot. Existing holds on PR46, PR52, PR53 and PR54 are independent of this branch;
their changes are not incorporated here.

## Local checks and synthetic journey

Use Node 24–26, PostgreSQL 15+ and Python 3.10+. Install the pinned Node dependencies
with `npm ci`. Set `TEST_DATABASE_URL` to a separate disposable database for this
checkout, using a disposable local PostgreSQL administrator. The bootstrap
suite creates throwaway databases/roles and exercises privileged role-attribute
rejection, so an ordinary application login is insufficient. Never point it at
shared application or production data.

```sh
npm run typecheck
npm run test:all
npm run demo
```

`npm test` retains the existing backend suite. It builds TypeScript and creates
unique per-test PostgreSQL schemas. `npm run test:tooling` runs the recorder,
channel consistency, decision-contract, check-in and trusted-contact suites,
then the synthetic check-in scenarios. Each Python suite runs in a separate
process, keeping their same-named test/evaluator modules isolated. Set `PYTHON`
to a Python executable path if it is not available as `python3`. A missing runtime
or failed child check makes the command fail; suites are not silently skipped.

The existing demo creates signed synthetic identities, confirms a persisted trip,
shows simulated fresh/stale locations, deduplicates explicit SOS, restarts actual
child processes to exercise recovery, and verifies contact revocation. It calls
no real identity, queue or notification provider. It is an executable backend
journey, with no browser or phone evidence implied.

## API and client seams

For the actual server, use the trusted OIDC and explicit one-off database setup in
the [runtime contract](../contracts/runtime.md) and [runbook](../../infra/README.md).
`npm start` does not migrate the database or install a synthetic login. Live sends
remain disabled unless separately configured and authorized.

Lane41 supplies additive owner-scoped client reads; Q44 coordinates their mount
in `src/api/app.ts`. Lane46 owns the HTTP/restart integration harness and its
signed synthetic-session boundary. Lane49 owns `web/` and its React/Vite runtime;
its planned local `/v1` proxy targets the explicitly configured API, without a new
backend CORS policy. Forwarding scripts will use the lanes' frozen commands once
available. No UI is included in this baseline.

API routes must come from the [runtime contract](../contracts/runtime.md) and the
reviewed source. In particular, proposed `/status` or `/sharing` endpoints in
review discussions are not implemented in the frozen backend above. The held
phone adapter and monitoring projection are not wired into the runtime.

## Verification limits

Synthetic fixture checks do not establish delivery, continuous background
capture, driver wellbeing, crime/fatigue detection, consent comprehension, useful
physical help, or product efficacy. Deployment, live providers, actual OIDC,
physical phones, retention qualification and human evidence retain their gates.
The existing CI workflow now also runs the offline toolkit checks after setting
up Python; local results do not establish that remote CI or AWS deployment ran.
