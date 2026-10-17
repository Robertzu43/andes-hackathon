# Offline verification record · #24

Scope: provisional software candidate only. No participant, physical-device,
stationary-study or independent human-factors assessment was performed.
`B_attention` remains unset; #23 and all human/dependency gates remain open.
The draft PR/Brain handoff identifies the frozen Git SHA for these sources.

Environment: Python 3.14.7, standard library, no dependency installation.
Commands from repository root (bytecode output disabled):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 evidence/checkins/run_scenarios.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s evidence/checkins -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 evidence/checkins/run_scenarios.py --json
git diff --cached --check
```

Recorded results: **50/50 synthetic scenarios passed; 12 unittest methods passed**.
The unittest suite includes 108 combinations of moving/unknown motion, road,
mode and opportunity, plus malformed scalars/shapes, every-field expiry/order
checks, late stationary/cached permission replay and checkpoint detachment.
Expanded JSON gives the exact inputs, expected decisions and actual outputs;
its records are synthetic and do not represent people or physical observations.

Sensitivity control: `test_moving_defect_is_caught_in_disposable_copy` copies only
the evaluator, runner and fixture into a temporary directory, deliberately lets
moving observations enter the candidate branch, and requires runner exit 1 with
`FAIL moving_visual_manual: stationary_candidate`. The unmodified runner passes.
The separate manual control run rejected seven moving candidates (43/50 passed,
exit 1). This is evidence that the relevant software assertion detects that
planted defect, not independent validation of driving safety.

Input/security review: the evaluator rejects non-synthetic inputs, missing/extra
fields, invalid provenance categories, unsupported enums and malformed clocks.
It performs no network, filesystem, command, notification or database operation.
The runner reads only its adjacent synthetic fixture; subprocess use is confined
to the unittest's fixed disposable-copy control, with no shell interpolation.
The change contains no secrets, accounts, endpoints, provider sends or personal
data. No server/API/UI is created. Source changes are confined to
`evidence/checkins/**`.

These results do not attest source authenticity, location safety, sensor accuracy,
human comprehension, attention cost, driving performance, server deadline
handling or reduced harm. Independent software review is delegated separately;
the author does not supply a human assessor disposition. Both blank study forms
remain unexecuted and confer no permission to recruit or collect data.
