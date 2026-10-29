# Solver tooling

Everything used to audit and correct the advisor's rolling logic. The pages themselves
(`advanced.html`, `simple.html`) carry hand-written rules; these tools prove or disprove them.

| File | What it is |
|---|---|
| `solver.py` | Exact optimal policy for one gear piece by value iteration. `python solver.py prydwen3 blue3` writes `solved_<name>.json` (one entry per state: value, best actions, Q per action). `--temp` prices provisional locks at ~0 rocks (temp-lock mode). Scenarios are listed at the bottom of the file; add your own as `(effect, goalTier)` lists with slots (an "any of" slot is a list of several targets). |
| `verify.py` | Replays a solved policy in a Monte Carlo of the real game (actual effects, tiers, exclusion rule). Its mean must match the solver's value. `python verify.py prydwen3`. |
| `eval_policy.py` | Scores a captured advisor policy inside the solved model: expected rocks from an empty piece under the advisor's actions vs the optimum. |
| `diff_harness.js` | Browser-side diff. Copy it and the `solved_*.json` tables into the site folder (served locally), open `advanced.html`, inject the script, then `await diffNext(['prydwen3', ...])` and `diffReport()`. Lists every state where the advisor and the solver disagree, with the rock cost of the disagreement. |
| `unit_sim.js` | Browser-side whole-unit simulation: drives the live advisor through full four-piece builds and measures realised rock cost. |
| `solver_report.md` | The audit write-up: method, results before and after each fix, the temp-lock analysis, and the open Keep/Change item. |

Requirements: Python 3.12 with `numpy` and `numba`. A solve takes about a second.

Game rules encoded (confirmed in game, Oct 2026): line appearance 100/50/30%; effect weights
10 or 12% each, one type per gear; tier bands T1–5 12% each, T6–10 7%, T11–15 1%; Reset
Attributes never repeats a line's current tier; roll price 1/2/3 rocks at 0/1/2 locks; lock
2/3 rocks; unlock free; Keep/Change is one joint decision per roll.

The solved tables are not committed (several MB each); regenerate them with `solver.py`.
