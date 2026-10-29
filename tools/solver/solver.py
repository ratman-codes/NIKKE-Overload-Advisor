"""
Exact optimal-policy solver for one NIKKE overload gear piece (post-Oct-2026 patch rules).

Model (all facts user-confirmed in game, 2026-10-28):
  - 3 lines; on Change Effects an unlocked line appears with prob 1 / 0.5 / 0.3 (L1/L2/L3),
    effect drawn by weight from the pool (one stat type per gear: effects on locked lines and
    effects already drawn this roll are excluded), value tier drawn fresh: T1-5 12% each,
    T6-10 7% each, T11-15 1% each.
  - Reset Attributes rerolls the VALUE of every unlocked non-empty line; a line's current tier
    can never repeat (the other 14 tiers are renormalised).
  - Both rolls cost 1 / 2 / 3 rocks at 0 / 1 / 2 locks. Keep/Change is one joint decision:
    after seeing the result you keep the old piece or take the new one.
  - Locking a line costs 2 / 3 rocks at 0 / 1 locks already placed. Unlocking is free, no refund.
  - A piece is "done" when every slot is satisfied: some line carries one of the slot's effects
    at or above that effect's goal tier. Locks are irrelevant at the end.

State reduction (exact for the quantities that matter):
  - a target line is (effect, tier class, locked) where tier classes group tiers by
    (value band, meets-goal). Every tier inside a band has the same mass, so the
    Reset exclusion rule is exact at class level.
  - junk lines are interchangeable; excluding a junk effect from the pool removes the
    AVERAGE junk weight (small approximation, affects costs by <1%, never the argmin).

Solved by Gauss-Seidel value iteration; the Keep/Change fixed point per state is solved by
Newton steps on the acceptance set (exact in a handful of iterations).
"""
import json, sys, time, itertools, os
import numpy as np
from numba import njit

EFF_P = {'Elemental Damage':.10,'ATK':.10,'Max Ammo':.12,'Charge Speed':.12,'Hit Rate':.12,
         'Charge Damage':.12,'Critical Rate':.12,'Critical Damage':.10,'DEF':.10}
PRYDWEN_MIN = {'Elemental Damage':8,'ATK':8,'Max Ammo':7,'Charge Speed':8,'Hit Rate':8,
               'Charge Damage':1,'Critical Rate':1,'Critical Damage':1,'DEF':1}
LINE_P = [1.0, 0.5, 0.3]
ROLL = np.array([1.0, 2.0, 3.0, 4.0])
LOCK = np.array([2.0, 3.0, 4.0, 4.0])
def BIN(t): return 0.12 if t <= 5 else (0.07 if t <= 10 else 0.01)

ACT_NAMES = ['stop','lock1','lock2','lock3','unlock1','unlock2','unlock3','change','reset']

def classes_for(goal):
    groups = {}
    for t in range(1, 16):
        band = 1 if t <= 5 else (2 if t <= 10 else 3)
        groups.setdefault((band, 1 if t >= goal else 0), []).append(t)
    out = []
    for key in sorted(groups):
        tiers = groups[key]
        # representative tiers for the advisor diff: the Blue/Black boundary (T12) matters to
        # the advisor's heuristics but not to the solver, so a class spanning it gets two reps
        reps = []
        if 11 in tiers: reps.append(11)
        hi = [t for t in tiers if t >= 12]
        if hi: reps.append(hi[len(hi)//2])
        if not reps: reps.append(tiers[len(tiers)//2])
        out.append(dict(band=key[0], meets=key[1], tiers=tiers, mass=sum(BIN(t) for t in tiers),
                        m=BIN(tiers[0]), reps=reps))
    return out


class Model:
    def __init__(self, targets, slots, name='', temp_locks=False):
        """targets: list of (effectName, goalTier); slots: list of lists of target indices.
        temp_locks: a PROVISIONAL lock (line below its goal) costs 0 rocks (keys instead);
        a FINAL lock (line at goal) still costs rocks."""
        self.name = name
        self.temp_locks = temp_locks
        self.T = [(n, EFF_P[n], g) for n, g in targets]
        self.nT = len(self.T)
        self.slots = slots
        self.cls = [classes_for(g) for _, _, g in self.T]
        junk = [e for e in EFF_P if e not in [n for n, _ in targets]]
        self.junk_names = junk
        self.WJ = sum(EFF_P[j] for j in junk); self.nJ = len(junk); self.aJ = self.WJ / self.nJ
        # ---- line codes ----
        self.codes = [dict(kind=0, tgt=-1, cls=-1, locked=0, meets=0),
                      dict(kind=1, tgt=-1, cls=-1, locked=0, meets=0),
                      dict(kind=1, tgt=-1, cls=-1, locked=1, meets=0)]
        self.code_of = {}
        for k in range(self.nT):
            for ci, c in enumerate(self.cls[k]):
                for lk in (0, 1):
                    self.code_of[(k, ci, lk)] = len(self.codes)
                    self.codes.append(dict(kind=2, tgt=k, cls=ci, locked=lk, meets=c['meets']))
        self.L = len(self.codes)
        # ---- states ----
        L = self.L
        self.states = []
        self.idx3 = -np.ones(L * L * L, dtype=np.int64)
        for a in range(L):
            for b in range(L):
                for c in range(L):
                    tg = [self.codes[x]['tgt'] for x in (a, b, c) if self.codes[x]['kind'] == 2]
                    if len(tg) != len(set(tg)): continue
                    self.idx3[(a * L + b) * L + c] = len(self.states)
                    self.states.append((a, b, c))
        self.nS = len(self.states)
        self._build_arrays()

    def sidx(self, tri):
        a, b, c = tri; L = self.L
        return int(self.idx3[(a * L + b) * L + c])

    def is_done(self, tri):
        for slot in self.slots:
            ok = False
            for x in tri:
                cd = self.codes[x]
                if cd['kind'] == 2 and cd['tgt'] in slot and cd['meets']: ok = True; break
            if not ok: return False
        return True

    def _build_arrays(self):
        nS, L = self.nS, self.L
        codes = self.codes
        self.done = np.zeros(nS, dtype=np.int8)
        self.nlock = np.zeros(nS, dtype=np.int64)
        self.lock_next = -np.ones((nS, 3), dtype=np.int64)
        self.lock_free = np.zeros((nS, 3), dtype=np.int8)   # 1 = provisional lock, costs no rocks (temp mode)
        self.unlock_next = -np.ones((nS, 3), dtype=np.int64)
        ctx_ids = {}
        self.ctx_of = np.zeros(nS, dtype=np.int64)
        ch_states, ch_probs, ch_off, ch_len = [], [], [], []
        rs_states, rs_probs = [], []
        self.rs_off = np.zeros(nS, dtype=np.int64); self.rs_len = np.zeros(nS, dtype=np.int64)
        for s, tri in enumerate(self.states):
            self.done[s] = 1 if self.is_done(tri) else 0
            nl = sum(codes[x]['locked'] for x in tri)
            self.nlock[s] = nl
            for i in range(3):
                cd = codes[tri[i]]
                if cd['kind'] == 2 and not cd['locked'] and nl < 2:
                    t = list(tri); t[i] = self.code_of[(cd['tgt'], cd['cls'], 1)]
                    self.lock_next[s, i] = self.sidx(tuple(t))
                    if self.temp_locks and not cd['meets']: self.lock_free[s, i] = 1
                if cd['locked']:
                    t = list(tri)
                    t[i] = self.code_of[(cd['tgt'], cd['cls'], 0)] if cd['kind'] == 2 else 1
                    self.unlock_next[s, i] = self.sidx(tuple(t))
            # change-effects context
            ctx = tuple(tri[i] if codes[tri[i]]['locked'] else -1 for i in range(3))
            if ctx not in ctx_ids:
                ctx_ids[ctx] = len(ch_off)
                outs = self._change_outcomes(ctx)
                ch_off.append(len(ch_states)); ch_len.append(len(outs))
                for tri2, p in outs:
                    ch_states.append(self.sidx(tri2)); ch_probs.append(p)
            self.ctx_of[s] = ctx_ids[ctx]
            # reset outcomes
            outs = self._reset_outcomes(tri)
            self.rs_off[s] = len(rs_states); self.rs_len[s] = len(outs)
            for tri2, p in outs:
                rs_states.append(self.sidx(tri2)); rs_probs.append(p)
        self.ch_states = np.array(ch_states, dtype=np.int64); self.ch_probs = np.array(ch_probs)
        self.ch_off = np.array(ch_off, dtype=np.int64); self.ch_len = np.array(ch_len, dtype=np.int64)
        self.rs_states = np.array(rs_states, dtype=np.int64); self.rs_probs = np.array(rs_probs)
        self.nctx = len(ch_off)

    def _change_outcomes(self, ctx):
        codes = self.codes
        locked_t = {codes[c]['tgt'] for c in ctx if c >= 0 and codes[c]['kind'] == 2}
        locked_j = sum(1 for c in ctx if c >= 0 and codes[c]['kind'] == 1)
        res = []
        def rec(i, cur, p, used, jcnt):
            if i == 3:
                res.append((tuple(cur), p)); return
            if ctx[i] >= 0:
                cur[i] = ctx[i]; rec(i + 1, cur, p, used, jcnt); return
            pa = LINE_P[i]
            if pa < 1:
                cur[i] = 0; rec(i + 1, cur, p * (1 - pa), used, jcnt)
            pool = [(k, self.T[k][1]) for k in range(self.nT) if k not in used]
            wj = max(0.0, self.WJ - self.aJ * jcnt)
            tot = sum(w for _, w in pool) + wj
            for k, w in pool:
                for ci, c in enumerate(self.cls[k]):
                    cur[i] = self.code_of[(k, ci, 0)]
                    rec(i + 1, cur, p * pa * (w / tot) * c['mass'], used | {k}, jcnt)
            if wj > 0:
                cur[i] = 1; rec(i + 1, cur, p * pa * (wj / tot), used, jcnt + 1)
        rec(0, [0, 0, 0], 1.0, frozenset(locked_t), locked_j)
        return res

    def _reset_outcomes(self, tri):
        codes = self.codes
        free = [i for i in range(3) if codes[tri[i]]['kind'] == 2 and not codes[tri[i]]['locked']]
        if not free: return []
        per = []
        for i in free:
            cd = codes[tri[i]]; k, ci = cd['tgt'], cd['cls']; cl = self.cls[k]
            m = cl[ci]['m']
            dist = []
            for cj, c2 in enumerate(cl):
                mass = c2['mass'] - (m if cj == ci else 0.0)
                if mass > 1e-12: dist.append((self.code_of[(k, cj, 0)], mass / (1 - m)))
            per.append(dist)
        res = []
        for combo in itertools.product(*per):
            t = list(tri); p = 1.0
            for (i, (code, pr)) in zip(free, combo):
                t[i] = code; p *= pr
            res.append((tuple(t), p))
        return res

    # ---------------------------------------------------------------- solve
    def solve(self, tol=1e-4, max_sweeps=20000, verbose=True):
        V = np.zeros(self.nS)
        # init from ABOVE: with (near-)free lock/unlock moves a low start can settle on a
        # bogus fixed point where the policy just cycles lock/unlock at no cost
        V[self.done == 0] = 1e5
        act = np.zeros(self.nS, dtype=np.int64)
        t0 = time.time()
        for sweep in range(max_sweeps):
            d = _sweep(V, act, self.nS, self.done, self.nlock, self.lock_next, self.lock_free, self.unlock_next,
                       self.ctx_of, self.ch_off, self.ch_len, self.ch_states, self.ch_probs,
                       self.rs_off, self.rs_len, self.rs_states, self.rs_probs, ROLL, LOCK, -1)
            if verbose and (sweep % 50 == 0 or d < tol):
                print(f'  sweep {sweep:5d}  maxdelta {d:.5f}  V(empty)={V[self.sidx((0,0,0))]:.2f}  {time.time()-t0:.1f}s', flush=True)
            if d < tol: break
        self.V, self.act = V, act
        self.Q = _qvalues(V, self.nS, self.done, self.nlock, self.lock_next, self.lock_free, self.unlock_next,
                          self.ctx_of, self.ch_off, self.ch_len, self.ch_states, self.ch_probs,
                          self.rs_off, self.rs_len, self.rs_states, self.rs_probs, ROLL, LOCK)
        return V

    def evaluate_policy(self, policy, tol=1e-4, max_sweeps=20000):
        """policy: int array of actions per state (ACT index). Acceptance is optimal w.r.t. the
        policy's own values. Returns V_pi."""
        V = np.zeros(self.nS); V[self.done == 0] = 1e5
        act = policy.astype(np.int64).copy()
        for sweep in range(max_sweeps):
            d = _sweep(V, act, self.nS, self.done, self.nlock, self.lock_next, self.lock_free, self.unlock_next,
                       self.ctx_of, self.ch_off, self.ch_len, self.ch_states, self.ch_probs,
                       self.rs_off, self.rs_len, self.rs_states, self.rs_probs, ROLL, LOCK, 1)
            if d < tol: break
        return V

    # ---------------------------------------------------------------- export
    def describe_line(self, code):
        cd = self.codes[code]
        if cd['kind'] == 0: return dict(kind='empty')
        if cd['kind'] == 1: return dict(kind='junk', locked=cd['locked'])
        c = self.cls[cd['tgt']][cd['cls']]
        return dict(kind='target', effect=self.T[cd['tgt']][0], goal=self.T[cd['tgt']][2],
                    tiers=[c['tiers'][0], c['tiers'][-1]], reps=c['reps'], meets=c['meets'], locked=cd['locked'])

    def export(self, path, tol_tie=0.25):
        out = dict(name=self.name, targets=[dict(effect=n, goal=g) for n, _, g in self.T],
                   slots=self.slots, junk=self.junk_names, actions=ACT_NAMES, states=[])
        for s, tri in enumerate(self.states):
            q = self.Q[s]
            best = [ACT_NAMES[a] for a in range(len(ACT_NAMES)) if np.isfinite(q[a]) and q[a] <= self.V[s] + tol_tie]
            out['states'].append(dict(id=s, lines=[self.describe_line(x) for x in tri], done=int(self.done[s]),
                                      V=round(float(self.V[s]), 3), best=best,
                                      Q={ACT_NAMES[a]: round(float(q[a]), 3) for a in range(len(ACT_NAMES)) if np.isfinite(q[a])}))
        with open(path, 'w', encoding='utf-8') as f: json.dump(out, f)
        return out


@njit(cache=True)
def _fixed_point(v0, cost, off, n, states, probs, V):
    """Solve v = cost + sum p*min(v, V[t]) by Newton steps on the acceptance set."""
    v = v0
    for it in range(12):
        acc = 0.0; prej = 0.0
        for j in range(n):
            vt = V[states[off + j]]
            if vt < v: acc += probs[off + j] * vt
            else: prej += probs[off + j]
        if prej >= 1.0 - 1e-12: return 1e18
        nv = (cost + acc) / (1.0 - prej)
        if abs(nv - v) < 1e-9: return nv
        v = nv
    return v


@njit(cache=True)
def _sweep(V, act, nS, done, nlock, lock_next, lock_free, unlock_next, ctx_of, ch_off, ch_len, ch_states, ch_probs,
           rs_off, rs_len, rs_states, rs_probs, ROLL, LOCK, fixed):
    maxd = 0.0
    for s in range(nS):
        if done[s] == 1:
            V[s] = 0.0; act[s] = 0; continue
        nl = nlock[s]
        best = 1e18; ba = -1
        for a in range(1, 9):
            if fixed == 1 and a != act[s]: continue
            v = 1e18
            if a <= 3:
                t = lock_next[s, a - 1]
                if t >= 0: v = (TEMP_LOCK_ROCKS if lock_free[s, a - 1] == 1 else LOCK[nl]) + V[t]
            elif a <= 6:
                t = unlock_next[s, a - 4]
                if t >= 0: v = V[t]
            elif a == 7:
                if nl < 3:
                    c = ctx_of[s]
                    v = _fixed_point(V[s], ROLL[nl], ch_off[c], ch_len[c], ch_states, ch_probs, V)
            else:
                if rs_len[s] > 0:
                    v = _fixed_point(V[s], ROLL[nl], rs_off[s], rs_len[s], rs_states, rs_probs, V)
            if v < best:
                best = v; ba = a
        d = abs(best - V[s])
        if d > maxd: maxd = d
        V[s] = best
        if fixed != 1: act[s] = ba
    return maxd


@njit(cache=True)
def _qvalues(V, nS, done, nlock, lock_next, lock_free, unlock_next, ctx_of, ch_off, ch_len, ch_states, ch_probs,
             rs_off, rs_len, rs_states, rs_probs, ROLL, LOCK):
    Q = np.full((nS, 9), np.inf)
    for s in range(nS):
        if done[s] == 1:
            Q[s, 0] = 0.0; continue
        nl = nlock[s]
        for a in range(1, 9):
            v = np.inf
            if a <= 3:
                t = lock_next[s, a - 1]
                if t >= 0: v = (TEMP_LOCK_ROCKS if lock_free[s, a - 1] == 1 else LOCK[nl]) + V[t]
            elif a <= 6:
                t = unlock_next[s, a - 4]
                if t >= 0: v = V[t]
            elif a == 7:
                if nl < 3:
                    c = ctx_of[s]
                    v = _fixed_point(V[s], ROLL[nl], ch_off[c], ch_len[c], ch_states, ch_probs, V)
            else:
                if rs_len[s] > 0:
                    v = _fixed_point(V[s], ROLL[nl], rs_off[s], rs_len[s], rs_states, rs_probs, V)
            Q[s, a] = v
    return Q

# a provisional (temp) lock is not quite free: a token rock cost stands in for the keys it
# burns, and keeps lock/unlock from being a zero-cost cycle in the equations
TEMP_LOCK_ROCKS = 0.05


SCENARIOS = {
    'prydwen3': ([('Elemental Damage', 8), ('ATK', 8), ('Max Ammo', 7)], [[0], [1], [2]]),
    'prydwen2': ([('Elemental Damage', 8), ('ATK', 8)], [[0], [1]]),
    'prydwen1': ([('Elemental Damage', 8)], [[0]]),
    'blue3':    ([('Elemental Damage', 12), ('ATK', 12), ('Max Ammo', 12)], [[0], [1], [2]]),
    'blue2':    ([('Elemental Damage', 12), ('ATK', 12)], [[0], [1]]),
    'black3':   ([('Elemental Damage', 15), ('ATK', 15), ('Max Ammo', 15)], [[0], [1], [2]]),
    'black1':   ([('Elemental Damage', 15)], [[0]]),
    # other effect sets / mixed goals (sweep for generality)
    'cs3':      ([('Charge Speed', 8), ('Charge Damage', 1), ('Elemental Damage', 8)], [[0], [1], [2]]),
    'hit3':     ([('Hit Rate', 8), ('ATK', 8), ('Critical Rate', 1)], [[0], [1], [2]]),
    'mix3':     ([('Elemental Damage', 12), ('ATK', 8), ('Max Ammo', 7)], [[0], [1], [2]]),
    'cs2blue':  ([('Charge Speed', 12), ('Hit Rate', 12)], [[0], [1]]),
    'black2':   ([('Elemental Damage', 15), ('ATK', 15)], [[0], [1]]),
    'crit3blue':([('Critical Rate', 12), ('Critical Damage', 12), ('Elemental Damage', 12)], [[0], [1], [2]]),
    # the user's example: third line may be any of three effects (values don't matter for them)
    'flex3':    ([('Elemental Damage', 8), ('ATK', 8), ('Critical Rate', 1), ('Critical Damage', 1), ('Max Ammo', 7)],
                 [[0], [1], [2, 3, 4]]),
}

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    args = sys.argv[1:] or ['prydwen3']
    temp = '--temp' in args
    names = [a for a in args if not a.startswith('--')]
    for nm in names:
        targets, slots = SCENARIOS[nm]
        t0 = time.time()
        m = Model(targets, slots, nm, temp_locks=temp)
        print(f'[{nm}{" temp" if temp else ""}] states={m.nS} contexts={m.nctx} change-outcomes={len(m.ch_states)} reset-outcomes={len(m.rs_states)} build {time.time()-t0:.1f}s', flush=True)
        m.solve(verbose=False)
        print(f'[{nm}{" temp" if temp else ""}] V(empty) = {m.V[m.sidx((0,0,0))]:.2f} rocks   total {time.time()-t0:.1f}s', flush=True)
        m.export(os.path.join(here, f'solved_{nm}{"_temp" if temp else ""}.json'))
