# Bootstrap CI teardown diagnosis

**Scoped correction:** [b85b827](https://github.com/Bimbi-Dev/andes-hackathon/commit/b85b82753e8472d6c3a5042e3d1b2a859571af82), only `tests/database-config.test.mjs`. No application behavior, role permission, assertion, dependency, workflow or retry policy changed. The source-only commit is published for Q44's normal integration; old failed CI is not cleared by these local results.

## Failure and cause

PR69 `9d757a909268ebf4c9b45068fa4954fed873ddc8` failed [39080359469](https://github.com/Bimbi-Dev/andes-hackathon/actions/runs/39080359469) and [39080361836](https://github.com/Bimbi-Dev/andes-hackathon/actions/runs/39080361836): 46/47 passed, with the non-superuser bootstrap test reporting `terminating connection due to administrator command`. PR83 `b95ff267d297d1fe1f27fa8b016940996690691c` failed [39081267239](https://github.com/Bimbi-Dev/andes-hackathon/actions/runs/39081267239): 90/91 passed, same test/error. Both test blobs are `34ba14466ba07ce8bd7108aa9dc2f8ac0517ea63`; bootstrap/database source and the dependency lock are unchanged between those heads.

With pinned `pg` 8.16.3, `pg-pool` removes clients from its bookkeeping and can resolve `pool.end()` before their socket-end events. The unchanged test's after-hook then issues `DROP DATABASE ... WITH (FORCE)` while those clients are still disconnecting. The server terminates the lingering app/migration connections with SQLSTATE `57P01`; the idle-pool error is uncaught. The [pool API documentation](https://node-postgres.com/apis/pool) explains the error-event behavior; the premature bookkeeping/socket ordering here was established from the installed implementation and live trace, not inferred from a green rerun.

An unmodified trace records `pool-end-resolved` with `socketDestroyed:false, ended:false`, then `drop-database-start`, then client-end events. A controlled 100ms delay in the disposable process's actual protocol-close call makes the unchanged test fail with the exact error. No assertion or fixture invariant was changed. The correction records scoped client-end promises on public pool-connect events and waits for them before dropping the database. It adds no blanket error listener, sleep, skip or retry.

## Evidence

All checks used Node24.17.0 and an owned PostgreSQL16.14 cluster on private port56560. No shared DB, .env, AWS, provider or notification was used. CI used PostgreSQL18; these local results do not claim a new CI18 pass.

| Check | Result |
| --- | --- |
| Exact original test, ordinary timing | 2/2 pass; passing alone does not diagnose the CI failure |
| Original test with observation-only tracing | 2/2 pass; unsafe teardown ordering recorded |
| Original test with delayed protocol close | 1 pass / 1 fail, uncaught `57P01`, matching CI |
| Corrected test, observation-only trace | 2/2 pass |
| Corrected test, identical delayed protocol close | 2/2 pass; client ends precede database drop |
| Existing complete PR69 backend suite after correction | 47/47 pass |
| TypeScript build | Pass; application TypeScript is unchanged |

[Raw TAP, traces, owned-resource metadata, original CI logs and hashes](../../review-probes/results/bootstrap-20261018/manifest.json) preserve successes and failures. The two PR69 log SHA256 values match the durable component53 handoff. Original CI logs are stored losslessly as gzip, with compressed and decompressed hashes in the manifest. The portable runner was also executed: original candidate exit1 and corrected candidate exit0, with its outputs retained. The existing least-privilege checks still prove allowed DML, denied DDL/migration writes, repeat bootstrap, future table/sequence grants and rejection of unsafe application roles.

## Portable reproduction

Use disposable candidate checkouts for original `9d757a9` and corrected `b85b827`, with dependencies installed from their unchanged lock and their normal build completed. Use a separate checkout of runtime fixture `06885f4` with its locked dependencies. On Node24.17.0, from the review checkout, supply those paths and a PostgreSQL15+ binary directory; the output directory must not exist:

```sh
APP_INTEGRATION_PG_BIN="$pg_bin" APP_INTEGRATION_PG_PORT=56560 \
  node review-probes/run-bootstrap-close.mjs "$original_dir" "$fixture_dir" "$new_before_output" delay
APP_INTEGRATION_PG_BIN="$pg_bin" APP_INTEGRATION_PG_PORT=56560 \
  node review-probes/run-bootstrap-close.mjs "$fixed_dir" "$fixture_dir" "$new_after_output" delay
```

Expected exits: 1 before, 0 after. `plain`, `trace` and `suite` select the other recorded checks. The runner rejects an external administrator URL, creates its own cluster, retains the database URL only in memory, waits for the test child and then tears down only its resources. The preload is opt-in and only delays this test's `bootstrap_*` connections.

Q44 owns applying the one-file commit to the affected integration/visual stack and validating the resulting exact heads. Independent review and fresh required CI remain separate; nothing here authorizes a merge or changes PR54's human-confirmation hold.
