# SYNTHETIC fixture: invented data

Every person, trip, time and record in this folder is invented for tests. Nothing here came from a real driver, contact or police record.

- Pair SYN-A (BR, pt-BR) carries a loaded interurban haul. The driver reports tiredness, then rests longer than planned without signal. The contact fears a robbery that never happened and calls a fellow driver. The pair's ordinary trip is left out of the export because its redaction review is unfinished.
- Pair SYN-B (CO, es) carries an attempted robbery that the driver reports and a synthetic police record corroborates. The pair has no ordinary trip, so `check` warns.
- `expected-export.json` is the exact output of `export` for this folder. The tests compare against it and against hand-calculated values.
