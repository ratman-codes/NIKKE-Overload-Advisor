# NIKKE overload advisor: solver audit (2026-10-28)

## What was built

`solver.py` computes the exact optimal policy for one gear piece under the post-patch rules
(Change Effects, Reset Attributes with the no-repeat exclusion, lock 2/3 rocks, free unlock,
roll price 1/2/3 at 0/1/2 locks, Keep/Change as one joint decision). It reduces a piece to
(effect class, value band vs goal, locked) per line, enumerates every state, and runs value
iteration with an exact fixed-point solve for the Keep/Change step. `verify.py` replays the
solved policy in a Monte Carlo of the real game (actual effects and tiers) and reproduces the
solver's numbers, so the model matches the mechanics as coded.

| Scenario (one piece, from empty) | Optimal rocks | Real-game replay |
|---|---|---|
| Prydwen minimums, 3 targets (Ele/ATK/Ammo) | 62.5 | 62.7 ± 0.3 |
| Prydwen minimums, 2 targets | 27.0 | 27.3 ± 0.2 |
| Prydwen minimums, 1 target | 8.0 | 8.2 ± 0.1 |
| Blue (T12+), 3 targets | 146.3 | 145.6 ± 0.7 |
| Black (T15), 3 targets | 432.0 | 432.5 ± 2.8 |
| Black, 1 target | 92.7 | |
| Flex: Ele + ATK + any of Crit Rate / Crit Dmg / Ammo | 43.6 | 43.7 ± 0.2 |

## Advisor vs solver, every state (both pages give identical results)

Disagreement rate over all non-finished states, and the cost of following the advisor's
action instead of the optimal one from an empty piece:

| Scenario | Before | After patches | Rocks lost from empty, after |
|---|---|---|---|
| Prydwen 3 | 38% of states, max gap 3 | 5.5%, max gap 3 | +0.5% |
| Prydwen 2 | 20% | 0% | +0.0% |
| Blue 3 | 29%, max gap 18 | 1.9%, max gap 3.6 | +0.1% |
| Blue 2 | 10% | 0% | +0.0% |
| Black 3 | 38%, **max gap 84** | 0.5%, max gap 1.8 | +0.0% |
| Black 1 | 0% | 0% | +0.0% |

States with a locked junk line are excluded from the rates (the advisor now tells you to unlock
them, which is what the solver does).

Generality sweep (other effects, goal-1 effects, mixed goals), after two further fixes
(goal-1 effects like Crit never need a value, so they are never "protected"; a Blue Line 1 is
locked when the other targets are locked at cheap goals):

| Scenario | Disagree | Worst gap (rocks) |
|---|---|---|
| Charge Speed 8 / Charge Damage 1 / Ele 8 | 15% | 2.2 |
| Hit Rate 8 / ATK 8 / Crit Rate 1 | 15% | 2.2 |
| Ele 12 / ATK 8 / Ammo 7 (mixed) | 25% | 3.0 |
| Charge Speed 12 / Hit Rate 12 | 0% | 0 |
| Ele 15 / ATK 15 | 0% | 0 |
| Crit Rate 12 / Crit Dmg 12 / Ele 12 | 2% | 3.6 |

Every remaining disagreement across all twelve scenarios costs at most 3.6 rocks.

## What was wrong and what changed (advanced.html and simple.html)

1. **Black-goal bug (84 rocks).** With a Black line at goal on Line 1 and another target on
   Line 2/3, a simulated keep-vs-sacrifice comparison could flip on simulation noise and tell
   you to Change Effects, which rerolls Line 1 and throws the Black away. The comparison is
   removed; a line at a Blue/Black goal is locked on sight (Black always; Blue once a target
   also sits on Line 3 or with two targets wanted).
2. **"Blue/Black" now means "at goal".** A Blue roll under a Black goal is just below goal and
   no longer gets locked on sight.
3. **Locked Line 1 target.** Line 1 always rolls, so a lock there mostly buys a higher roll
   price. Below goal: unlock. At goal with an ordinary goal while still fishing: unlock, unless
   another lock is already protecting a Line 3 target.
4. **Locked junk line.** Unlock it; the lock only raises every roll's price.
5. **Line 2 lock timing.** A below-goal Line 2 is locked at N-1 only when the other target sits
   on Line 3 (or only two targets are wanted), never when it sits on Line 1. A Line 2 target at
   an ordinary goal that is hard to re-roll (Ele/ATK, under 30% per reset) is locked on sight. A
   locked below-goal Line 2 with nothing on Line 3 is unlocked.
6. **Values first when nothing is locked (ordinary goals).** With a below-goal target on a
   lockable line and no locks, Reset Attributes at 1 rock per roll and lock the line when it
   hits, instead of locking now and fishing the value later at a higher price.
7. **Value stage order.** Unlock below-target locks before placing the protective lock on a
   finished line (a lock placed with fewer locks already in place is cheaper).

## Whole-unit layer (advisor driven through a simulated four-piece build)

| Build | Advisor in the loop | Fixed Ammo assignment, same keep rule | Fixed assignment, optimal keep rule |
|---|---|---|---|
| 8/12 (Ele4 ATK4) | 107 | 107 | 108 |
| 10/12 (Ele4 ATK4 Ammo2) | 189 | 188 | 179 |
| 12/12 (Ele4 ATK4 Ammo4) | 269 | 269 | 250 |

The opportunistic Ammo layer neither helps nor hurts measurably: it lands within noise of
simply deciding up front which two pieces carry Ammo.

## Temp locks (solver run with provisional locks at ~0 rocks, `--temp`)

A provisional lock (line below its goal) costs no rocks; a final lock (line at goal) still
costs rocks. Optimal cost from an empty piece:

| Scenario | Module locks only | Temp locks for provisional holds | Saving |
|---|---|---|---|
| Prydwen 3 | 62.5 | 60.0 | 2.5 (4%) |
| Prydwen 2 | 27.0 | 26.2 | 0.8 |
| Blue 3 | 146.3 | 142.1 | 4.2 (3%) |
| Black 3 | 432.0 | 427.6 | 4.4 (1%) |

The saving is bounded by the lock fees the rock policy would have paid, because a temp lock
still raises the roll price like any lock. The advisor's temp-lock mode (temp for provisional
holds, modules for finished lines) sits within 3 rocks of this policy in every state
(disagreement 2 to 8% of states, mean gap 1 rock). The earlier page estimate of "183 to 158
with temp locks" came from the simulator treating every lock as free, finished lines included.

## The open item: which roll to keep

Every number above with the advisor's own Keep/Change rule (keep a roll only when it adds a
target, with Line 3 worth more than Line 1) is about 8% above the optimum on three-target
pieces, and exactly optimal on two-target pieces. The optimal rule is "keep the roll whose
expected remaining cost is lower", which depends on values as well as effects in ways no short
rule captured (several candidates were tried; adding an at-goal bonus made things worse because
it fights the placement preference). Closing this gap would mean shipping the solved tables with
the page and looking the comparison up. Everything else is settled.

## Files

- `solver.py`: model + value iteration + export (`solved_<scenario>.json`).
- `verify.py`: real-game Monte Carlo replay of the solved policy.
- `eval_policy.py`: evaluates a captured advisor policy inside the solved model.
- `diff_harness.js`, `unit_sim.js`: browser-side harnesses (inject into the live page).
- `advisor_policies_v*.json`: captured advisor actions per state, before and after patches.
