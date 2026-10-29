"""Evaluate the live advisor's per-state policy (captured in the browser diff) inside the solved
model: expected rocks from an EMPTY piece under the advisor's actions vs the optimum.
Variant A = Tier-11 representatives for tiers 11+ classes (no Blue/Black flags),
variant B = Tier 13/15 representatives (Blue/Black flags on)."""
import json, sys
import numpy as np
from solver import Model, SCENARIOS, ACT_NAMES

src = sys.argv[1]
raw = json.load(open(src, encoding='utf-8'))
txt = raw[0]['text'] if isinstance(raw, list) else raw
pols = json.loads(json.loads(txt)) if isinstance(txt, str) else txt

for nm, pv in pols.items():
    targets, slots = SCENARIOS[nm]
    m = Model(targets, slots, nm); m.solve(verbose=False)
    e = m.sidx((0, 0, 0))
    line = f'{nm:9s} optimal {m.V[e]:7.2f}'
    for var in ('A', 'B'):
        s = pv[var]
        assert len(s) == m.nS, (nm, len(s), m.nS)
        pol = np.array([(ord(c) - 48) if c != '?' else 7 for c in s], dtype=np.int64)
        # an action the state does not allow (e.g. 'change' with 3 locks) falls back to the optimum
        for i in range(m.nS):
            if not np.isfinite(m.Q[i, pol[i]]): pol[i] = m.act[i]
        Vp = m.evaluate_policy(pol)
        line += f'   advisor-{var} {Vp[e]:7.2f} (+{100*(Vp[e]/m.V[e]-1):.1f}%)'
    print(line, flush=True)
