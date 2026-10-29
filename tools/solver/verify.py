"""Independent check of the solver: play the REAL game (actual effects, actual tiers, exact
exclusion rule, one-type-per-gear) with the solver's policy and see whether the realised
average cost matches V(empty). Acceptance after a roll: take the new piece iff its state value
is lower (ties -> keep)."""
import sys, os, time, random
import numpy as np
from solver import Model, SCENARIOS, EFF_P, BIN, LINE_P, ROLL, LOCK, ACT_NAMES

def play(m, trials=20000, seed=1, start=None):
    rng = random.Random(seed)
    tiers = list(range(1, 16)); tw = [BIN(t) for t in tiers]
    names = list(EFF_P); w = [EFF_P[n] for n in names]
    tname = {n: k for k, (n, _, _) in enumerate(m.T)}
    def cls_of(k, t):
        for ci, c in enumerate(m.cls[k]):
            if t in c['tiers']: return ci
    def code(line):
        if line is None: return 0
        eff, t, lk = line
        if eff in tname: return m.code_of[(tname[eff], cls_of(tname[eff], t), 1 if lk else 0)]
        return 2 if lk else 1
    def sidx(lines): return m.sidx(tuple(code(l) for l in lines))
    costs = []
    for _ in range(trials):
        lines = list(start) if start else [None, None, None]
        cost = 0.0; guard = 0
        while guard < 20000:
            guard += 1
            s = sidx(lines)
            if m.done[s]: break
            a = int(m.act[s]); nl = sum(1 for l in lines if l and l[2])
            if a == 0: break
            if 1 <= a <= 3:
                i = a - 1; cost += LOCK[nl]; lines[i] = (lines[i][0], lines[i][1], True)
            elif 4 <= a <= 6:
                i = a - 4; lines[i] = (lines[i][0], lines[i][1], False)
            elif a == 7:
                cost += ROLL[nl]
                used = [l[0] for l in lines if l and l[2]]
                new = list(lines)
                for i in range(3):
                    if lines[i] and lines[i][2]: continue
                    if rng.random() < LINE_P[i]:
                        pool = [(n, EFF_P[n]) for n in names if n not in used]
                        tot = sum(x for _, x in pool); r = rng.random() * tot
                        for n, x in pool:
                            r -= x
                            if r <= 0: break
                        used.append(n)
                        new[i] = (n, rng.choices(tiers, tw)[0], False)
                    else:
                        new[i] = None
                if m.V[sidx(new)] < m.V[s]: lines = new
            else:
                cost += ROLL[nl]
                new = list(lines)
                for i in range(3):
                    if lines[i] and not lines[i][2]:
                        t = lines[i][1]
                        while True:
                            nt = rng.choices(tiers, tw)[0]
                            if nt != t: break
                        new[i] = (lines[i][0], nt, False)
                if m.V[sidx(new)] < m.V[s]: lines = new
        costs.append(cost)
    c = np.array(costs)
    return c.mean(), c.std() / np.sqrt(len(c)), c.std()

if __name__ == '__main__':
    for nm in (sys.argv[1:] or ['prydwen3']):
        targets, slots = SCENARIOS[nm]
        m = Model(targets, slots, nm); m.solve(verbose=False)
        t0 = time.time()
        mean, se, sd = play(m, trials=int(os.environ.get('TRIALS', '20000')))
        print(f'[{nm}] solver V(empty)={m.V[m.sidx((0,0,0))]:.2f}   real-game MC={mean:.2f} ±{se:.2f} (sd {sd:.1f})   {time.time()-t0:.1f}s', flush=True)
