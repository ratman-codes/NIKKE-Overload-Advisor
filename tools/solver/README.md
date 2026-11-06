# Solver tooling

Everything used to audit and correct the advisor's rolling logic. Since Oct 2026 the pages
run the solver themselves (`solver_worker.js`, embedded as a Web Worker): it picks the move for
the piece in front of you and judges each roll in the roll guide. The hand-written rules
remain as the wording layer and as a fallback while a table is still computing. A rule's move
is kept when it is within 0.25 modules of the solver's best move, so the advice stays stable
and well-worded; otherwise the solver's move is shown, built from the same templates, and the
card carries a "✓ exact" pill either way.

The solver also covers "any N of these targets" (`minSlots` in the spec, used by the by-gear
page when fewer lines are wanted than targets), "any of" groups (`slots` in the spec: one
target per member effect, each with its own value goal, and a slot that any one member
satisfies, exactly as `solver.py`'s slots; before Oct 2026 the pages pooled a group into one
pseudo-effect with the highest member goal, which overstated a Crit line's requirement and was
1–2 modules off) and the whole-unit layer: on the whole-unit page, deciding which piece should
carry a scarce effect (for example one Max Ammo across four pieces) uses the exact difference
between that piece's cost with and without the extra target. Keys are not priced; they have
no exchange rate in modules.

Verification (Oct 2026): both pages were diffed state by state against `solver.py` tables for
prydwen3/2, blue3, black3, mix3, cs3, the any-N tables, and the group tables critany, ammocs,
critanyblue and flex3, in both lock modes: 0 disagreements, and every state's value matches to
0.001 modules.

Later in Nov 2026:

- The solver always runs. If a browser cannot start a Web Worker, the same solver source runs on the page (`getLocal` in `Exact`). Test switches: `?noworker=1` forces the in-page solver, `?nosolver=1` turns the solver off to show the last-resort rule cards and their warning banner.
- `pin` is also used for a passable bonus the player has locked, so the solver never advises unlocking it.
- An entry the game cannot produce (the same effect on two lines, a locked empty line) gets a message instead of a move (`pieceProblem`).
- The page asks for all the tables a change needs, shows a "Recalculating" marker while they compute and draws once at the end; the card for a piece is cached per state (`recommendCore`).
- The simulator (`simPieceCost`) now only supplies the +/- spread and the temp-lock estimate, with the same dice for every state. It plays the older rule policy, not the solver's, so those two figures are estimates and are not covered by any check here.
- Sweeps now include two "any of" groups, a passable bonus, and a group with a passable bonus. Results: moves 0 wrong in 171,846 layouts (whole unit) and 214,438 (by gear piece), also with `?noworker=1`; sentences 0 wrong in 88,672 and 114,584; whole-unit plan 0 flagged in 899 states over 35 simulated builds, 0 loops.

| File | What it is |
|---|---|
| `solver.py` | Exact optimal policy for one gear piece by value iteration. `python solver.py prydwen3 blue3` writes `solved_<name>.json` (one entry per state: value, best actions, Q per action). `--temp` prices provisional locks at ~0 rocks (temp-lock mode). Scenarios are listed at the bottom of the file; add your own as `(effect, goalTier)` lists with slots (an "any of" slot is a list of several targets; an optional third element is `min_slots`, "any N of these", as in `any2of3`). |
| `solver_worker.js` | The same solver in JavaScript, embedded in both pages (as a Web Worker) so the roll guide's Keep / Change verdict and the step shown are exact. Reproduces `solver.py` to the second decimal; a target set solves in about 150 ms. `minSlots` ("any N of these targets") matches `min_slots` in `solver.py`; the by-gear page was diffed against the `any2of3`, `any1of3` and `any2of3blue` tables with 0 disagreements and identical values. When you change the model in one, change the other. One option exists only here: `pin` (line positions that may never be unlocked), used when the player chooses to keep a rare roll above the target; the page then shows the exact cost of finishing with that line held. With no `pin` the solver is unchanged. |
| `walk_copy.js` | Browser-side copy walkthrough: drives simulated builds and lists every distinct string the advisor can show, for reviewing the wording as a whole. |
| `verify.py` | Replays a solved policy in a Monte Carlo of the real game (actual effects, tiers, exclusion rule). Its mean must match the solver's value. `python verify.py prydwen3`. |
| `eval_policy.py` | Scores a captured advisor policy inside the solved model: expected rocks from an empty piece under the advisor's actions vs the optimum. |
| `diff_harness.js` | Browser-side diff. Copy it and the `solved_*.json` tables into the site folder (served locally), open `advanced.html`, inject the script, then `await diffNext(['prydwen3', ...])` and `diffReport()`. Lists every state where the advisor and the solver disagree, with the rock cost of the disagreement. |
| `claim_check.js` | Browser-side check of what the advice card SAYS, not just the move it picks. `diff_harness.js` cannot see a card whose move is right but whose sentence is wrong (a "then lock that line" that is not the next move, a landing named on a line where it does not help). Since Nov 2026 the card text is written from the solver (`exactWording` in both pages: which effect on which line, why, and the real next step), and this script verifies it: every named effect is on the named line, every "then" is the solver's next move, every stated reason holds. Serve the site folder, open either page, load the script, run `await claimCheckAll()` until it reports done, then `claimReport()`; `wrongClaims` must be 0. Nov 2026: 0 wrong in 22,966 layouts (whole unit) and 48,878 (by gear piece). Run it after any change to card wording or rules. 6 Nov 2026: the whole-unit sweep gained setups with targets below x4 (`spare 4/4/2`, `spare 4/2/2`, `spare 4/3 blue`), and on that page every landing, value and "then" is judged with the unit's plan re-chosen around the hypothetical piece (`unitValue` / `qAt` in `advanced.html`), not the piece's own table. The old x4-only sweep could not see the bug a player found in one entry: an empty Head with Ammo x2 said "Lines 1 and 2 do not count yet" while taking Elemental on Line 2 saved 5 modules (the plan then makes Head a two-line piece). The sweep also found an unlock card calling a unit target "not one of this piece's targets" and a reset card leaving out a line whose hit would move a target to that piece; both reworded. The checker also verifies the reverse: a landing or a hit that is progress for the unit must be named on the card. Later that day the Change Effects card changed shape on both pages: a short title (the counted lines, plus the effects when at most two and the same on every counted line) and one row per line in the game's order ("Line 2 · Elemental Damage or ATK"; locked and temp-held lines shown as such); the card carries `rec.rows`, which this checker reads instead of the title, and it checks the title against the rows and every "does not count yet" row against the solver. After the change: 0 wrong in 104,410 (whole unit) and 114,584 (by gear piece); moves 0 in 219,274 and 214,438. |
| `move_check.js` | Browser-side check of the MOVE on the card against the in-page solver, for every layout in a sweep (no table files needed; `diff_harness.js` remains the check of the in-page solver against `solver.py`). `await moveCheckAll()` until done, then `moveReport()`; `disagree` must be 0. Nov 2026: 0 in 89,460 layouts (whole unit) and 132,052 (by gear piece). Latest (6 Nov 2026, fresh page load): 0 in 171,846 and 214,438; `judged` must equal `states`. Both this tool and `claim_check.js` wait for the solver table of every layout, not only the first one of a setup: a locked passable line needs its own table, and before this the sweep on a fresh page read the stand-in rule card (claim check: about 2,000 false alarms) or skipped the layout (move check). |
| `unit_check.js` | Browser-side audit of the WHOLE-UNIT layer of `advanced.html` (which piece carries which effect). Plays full builds the way the page advises, with real roll odds and exact Keep / Change, and at every unit state compares the page with a brute-force reference: every assignment of the required effects to the four pieces, priced with the exact per-piece tables. Reports the "Modules to go" figure, the plan's commitments, "planned for X", "This piece is finished", the secured counters, and any lock that the next card undoes. Run `await unitCheckAll()` until done, then `unitReport()`. Nov 2026: it found that with two or more effects below x4 the old per-effect planner sat about 10 modules above the cheapest assignment, opened by stacking every effect on the same pieces, and could fall into a lock / unlock loop, because it chose carriers one effect at a time by marginal cost and a lock changes those marginals. The plan is now chosen by total exact cost (`exactSets` / `buildPlan` in `advanced.html`), and the roll guide judges a roll by the whole unit's plan cost. After the change: 48 simulated builds, 1,189 unit states, 0 states above the cheapest assignment, 0 loops, counters agree. |
| `unit_sim.js` | Browser-side whole-unit simulation: drives the live advisor through full four-piece builds and measures realised rock cost. |
| `solver_report.md` | The audit write-up: method, results before and after each fix, the temp-lock analysis, and the open Keep/Change item. |

Requirements: Python 3.12 with `numpy` and `numba`. A solve takes about a second.

Game rules encoded (confirmed in game, Oct 2026): line appearance 100/50/30%; effect weights
10 or 12% each, one type per gear; tier bands T1–5 12% each, T6–10 7%, T11–15 1%; Reset
Attributes never repeats a line's current tier; roll price 1/2/3 rocks at 0/1/2 locks; lock
2/3 rocks; unlock free; Keep/Change is one joint decision per roll.

The solved tables are not committed (several MB each); regenerate them with `solver.py`.
