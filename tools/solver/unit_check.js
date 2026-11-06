// Audit tool (not part of the site): checks the WHOLE-UNIT layer of advanced.html.
// The per-piece solver is exact; which piece carries which effect is decided by a planning
// layer on top of it. This script plays full builds the way the page advises (real roll odds,
// exact Keep / Change) and, at every unit state reached, compares the page with a brute-force
// reference: every way of assigning the required effects to the four pieces, each priced with
// the exact per-piece tables, cheapest wins. It reports
//   - "Modules to go" against the cheapest fixed assignment,
//   - the plan's commitments (each piece's must-have effects) against it,
//   - "planned for X" / "has to come from X" against it,
//   - "This piece is finished" against it,
//   - whether the "secured" counters on the page agree with each other,
//   - any game where a lock is undone by the very next card (a plan flip that would repeat forever).
// The reference is the best FIXED assignment. Real play can do slightly better by taking an
// effect wherever it happens to land, so a small gap is not an error; a large one is.
// States come from play, not from random filling: random units contain things no advised game
// produces (two locked copies of an effect wanted once) and say nothing about real use.
//
// Use: serve the site folder, open advanced.html, load this file, then
//   await unitCheckAll();     // call again while it returns {partial:true}
//   unitReport();
(function(){
  if(state && state.roles){ console.warn('unit_check.js is for advanced.html (the whole-unit page)'); return; }
  const EL='Elemental Damage', CD='Critical Damage', CR='Critical Rate', AM='Max Ammo';
  const configs=[
    {name:'Ele4 ATK4 CritDmg1 (custom tiers)', req:{[EL]:4,'ATK':4,[CD]:1}, goal:{[EL]:10,'ATK':10,[CD]:9}},
    {name:'Ele4 ATK4 Ammo2', req:{[EL]:4,'ATK':4,[AM]:2}},
    {name:'Ele4 ATK4 Ammo4', req:{[EL]:4,'ATK':4,[AM]:4}},
    {name:'Ele4 ATK4 Ammo2 CritRate1', req:{[EL]:4,'ATK':4,[AM]:2,[CR]:1}},
    {name:'Ele3 ATK3 Ammo3', req:{[EL]:3,'ATK':3,[AM]:3}},
    {name:'Ele2 ATK2 Ammo2 CritDmg2', req:{[EL]:2,'ATK':2,[AM]:2,[CD]:2}},
    {name:'Ele4 ATK4 CritAny2 (any of Crit Rate / Crit Damage)', req:{[EL]:4,'ATK':4,[groupKey([CR,CD])]:2}} ];
  const blank=()=>[0,1,2].map(()=>({effect:'',tier:11,locked:false}));
  const TOL=1.5;   // modules: page figures are rounded
  const ab=x=>x.split(' ').map(w=>w.slice(0,3)).join('');
  const fmtP=p=>state.pieces[p].map(l=>l.effect?(ab(l.effect)+l.tier+(l.locked?'🔒':'')):'–').join(' | ');
  const fmtU=()=>PIECES.map(p=>p+': '+fmtP(p)).join('   ');
  const fmtS=sets=>sets.map((s,i)=>PIECES[i]+':'+(s.map(ab).join('+')||'nothing')).join(' ');
  const ready=()=>new Promise(r=>{ const t=()=>{ if(!Exact.busy()&&PIECES.every(p=>Exact.status(p)!=='pending')) r(); else setTimeout(t,25); }; t(); });
  const combos=(n,k)=>{ const out=[]; (function rec(s,c){ if(c.length===k){ out.push(c.slice()); return; } for(let i=s;i<n;i++){ c.push(i); rec(i+1,c); c.pop(); } })(0,[]); return out; };
  let seed=20261106; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const bandTier=()=>{ const r=rnd(); if(r<0.6) return 1+Math.floor(rnd()*5); if(r<0.95) return 6+Math.floor(rnd()*5); return 11+Math.floor(rnd()*5); };
  const drawEffect=ex=>{ const rem=EFF_NAMES.filter(e=>!ex.includes(e)); let tot=0; rem.forEach(e=>tot+=EFF_P[e]); let r=rnd()*tot; for(const e of rem){ r-=EFF_P[e]; if(r<=0) return e; } return rem[rem.length-1]; };
  let S=null, saved=null;

  function cheapest(effs,req,costOf,ok){
    let best=Infinity, bestSets=null; const sets=[[],[],[],[]];
    (function rec(ei){
      if(ei===effs.length){ if(ok&&!ok(sets)) return; let c=0; for(let p=0;p<4;p++){ c+=costOf(p,sets[p]); if(c>=best) return; } best=c; bestSets=sets.map(s=>s.slice()); return; }
      const e=effs[ei];
      combos(4,req[e]).forEach(cs=>{ if(cs.some(p=>sets[p].length>=3)) return; cs.forEach(p=>sets[p].push(e)); rec(ei+1); cs.forEach(p=>sets[p].pop()); });
    })(0);
    return {cost:best,sets:bestSets};
  }
  const note=(bucket,gap,ex)=>{ bucket.bad++; const g=isFinite(gap)?gap:9999; bucket.sum+=Math.min(g,9999); if(g>bucket.worst){ bucket.worst=+Math.min(g,9999).toFixed(1); bucket.ex.unshift(ex); bucket.ex=bucket.ex.slice(0,4); } else if(bucket.ex.length<4) bucket.ex.push(ex); };

  // compare the page with the brute-force reference for the unit as it stands
  function checkUnit(cfg,effs){
    const plan=buildPlan(); if(PIECES.some(p=>plan.sets[p].overflow)){ S.skipped++; return; }
    const page=totalRemainingEV(); if(!page){ S.skipped++; return; }
    const memo={}; let nulls=0;
    const costOf=(pi,T)=>{ if(!T.length) return 0; const k=pi+'|'+T.join('|'); if(k in memo) return memo[k]; const v=Exact.valueFor(T,state.pieces[PIECES[pi]]); if(v===null) nulls++; return (memo[k]=(v===null?1e9:v)); };
    const ref=cheapest(effs,cfg.req,costOf); if(nulls||!isFinite(ref.cost)||ref.cost>=1e8){ S.skipped++; return; }
    S.units++; const per=S.per[cfg.name]; per.units++;
    const allMet=effs.every(e=>plan.ua.remaining[e]===0&&!plan.ua.stuck[e]);
    const base={setup:cfg.name,unit:fmtU(),cheapest:+ref.cost.toFixed(1),cheapestPlan:fmtS(ref.sets)};
    // 1) the headline figure
    const gap=page.ev-ref.cost; S.cost.n++; per.sumGap+=Math.max(0,gap);
    if(gap>TOL) note(S.cost,gap,Object.assign({pageSays:page.ev},base));
    if(gap<-TOL){ S.cost.under++; if(S.cost.underEx.length<3) S.cost.underEx.push(Object.assign({pageSays:page.ev},base)); }
    // 2) the plan's commitments: every piece carries at least its must-haves
    const musts=PIECES.map(p=>plan.sets[p].must);
    const rp=cheapest(effs,cfg.req,costOf,sets=>sets.every((T,i)=>musts[i].every(e=>T.includes(e)))); S.plan.n++;
    if(!isFinite(rp.cost)||rp.cost-ref.cost>TOL) note(S.plan,rp.cost-ref.cost,Object.assign({pagePlan:fmtS(musts),pagePlanCosts:isFinite(rp.cost)?+rp.cost.toFixed(1):'no valid assignment'},base));
    // 3) "planned for X" / "has to come from X"
    Object.entries(plan.forcedOn||{}).forEach(([e,ps])=>{ const idx=ps.map(p=>PIECES.indexOf(p)); const rf=cheapest(effs,cfg.req,costOf,sets=>idx.every(i=>sets[i].includes(e))); S.forced.n++;
      if(!isFinite(rf.cost)||rf.cost-ref.cost>TOL) note(S.forced,rf.cost-ref.cost,Object.assign({effect:e,pageSaysItComesFrom:ps.join(' / '),thatCosts:isFinite(rf.cost)?+rf.cost.toFixed(1):'no valid assignment'},base)); });
    // 4) "This piece is finished": stopping there must not cost more than the cheapest plan
    if(!allMet) PIECES.forEach((p,i)=>{ if(recommend(p).risk!=='done') return; const rf=cheapest(effs,cfg.req,costOf,sets=>costOf(i,sets[i])===0); S.finished.n++;
      if(!isFinite(rf.cost)||rf.cost-ref.cost>TOL) note(S.finished,rf.cost-ref.cost,Object.assign({pieceCalledFinished:p,stoppingThereCosts:isFinite(rf.cost)?+rf.cost.toFixed(1):'no valid assignment'},base)); });
    // 5) the "secured" counters agree: per-effect rows against the unit total
    const total=totalReqLines(); const sb=(typeof securedByEffect==='function')?securedByEffect():null;
    const byEffect=sb?effs.reduce((s,e)=>s+(sb[e]||0),0):effs.reduce((s,e)=>s+(cfg.req[e]-(plan.ua.remaining[e]||0)),0);
    const byPiece=Math.min(total,PIECES.reduce((s,p)=>s+securedCount(p),0)); S.counts.n++;
    if(byEffect!==byPiece){ S.counts.bad++; if(S.counts.ex.length<4) S.counts.ex.push({setup:cfg.name,perEffectRowsAddTo:byEffect,unitTotalSays:byPiece,unit:fmtU()}); }
  }

  // one advised move with real roll odds; returns false when the build is finished or stuck
  function playStep(){
    const plan=buildPlan(); const effs=reqEffects();
    if(effs.every(e=>plan.ua.remaining[e]===0&&!plan.ua.stuck[e])) return false;
    const np=nextPiece(); if(!np||np.need<=0) return false;
    const p=np.p, lines=state.pieces[p]; const t=(recommend(p).title||'').replace(/<[^>]+>/g,''); let m;
    const nl=lines.filter(l=>l.locked).length;
    if((m=t.match(/^🔒 Lock Line (\d)/))){ S.game.cost+=lockCost(nl); lines[+m[1]-1].locked=true; S.game.last={p,line:+m[1]-1,unit:fmtU()}; }
    else if(t.startsWith('🔓')||/^⚠️ Line \d .* is locked below/.test(t)){ const is=[...t.matchAll(/Line (\d)/g)].map(x=>+x[1]-1).filter(i=>lines[i].locked); if(!is.length) return false;
      // a lock the very next card undoes: the plan flipped because of the lock, and repeating it burns modules for nothing
      if(S.game.last&&S.game.last.p===p&&is.includes(S.game.last.line)){ S.loops.n++; if(S.loops.ex.length<4) S.loops.ex.push({setup:S.cur,piece:p,line:S.game.last.line+1,unitBeforeTheLock:S.game.last.unit}); return false; }
      is.forEach(i=>lines[i].locked=false); S.game.last=null; }
    else if(t.startsWith('🔁')||t.startsWith('🎯')){
      S.game.last=null; S.game.cost+=rerollCost(nl); const before=lines.map(l=>({...l}));
      const val=()=>{ const u=(typeof planCostWith==='function')?planCostWith(p,state.pieces[p]):null; return u!==null?u:Exact.value(p,state.pieces[p]); };   // the roll guide's verdict: whole unit when the plan is exact
      const v0=val();
      if(t.startsWith('🔁')){ const used=lines.filter(l=>l.locked).map(l=>l.effect); for(let i=0;i<3;i++){ if(lines[i].locked) continue; if(rnd()<LINE_P[i]){ const e=drawEffect(used); used.push(e); lines[i]={effect:e,tier:bandTier(),locked:false}; } else lines[i]={effect:'',tier:11,locked:false}; } }
      else for(let i=0;i<3;i++){ if(lines[i].locked||!lines[i].effect) continue; let nt; do{ nt=bandTier(); }while(nt===lines[i].tier); lines[i]={effect:lines[i].effect,tier:nt,locked:false}; }
      const v1=val();
      if(!(v0!==null&&v1!==null&&v1<v0-1e-9)){ state.pieces[p]=before; return 'kept'; }   // exact Keep / Change, as the roll guide judges it
    }
    else return false;
    return 'moved';
  }

  window.unitCheckAll=async function(budgetMs,gamesPerConfig){
    budgetMs=budgetMs||30000; gamesPerConfig=gamesPerConfig||6;
    const mk=()=>({n:0,bad:0,sum:0,worst:0,ex:[]});
    if(!S){ S={ci:0,gi:0,game:null,units:0,skipped:0,games:0,done:false,cost:Object.assign(mk(),{under:0,underEx:[]}),plan:mk(),forced:mk(),finished:mk(),counts:{n:0,bad:0,ex:[]},loops:{n:0,ex:[]},per:{}}; saved=JSON.stringify(state); }
    const t0=Date.now();
    for(;S.ci<configs.length;S.ci++,S.gi=0){
      const cfg=configs[S.ci]; const effs=Object.keys(cfg.req); S.cur=cfg.name;
      if(!S.per[cfg.name]){ S.per[cfg.name]={games:0,units:0,sumGap:0,sumCost:0};
        state.req=Object.assign({},cfg.req); state.goalTierBy=Object.assign({},cfg.goal||{}); state.tempLocks=false; delete state.keep; delete state.rareOk; PIECES.forEach(p=>state.pieces[p]=blank()); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear();
        const subs=[]; (function rec(i,c){ if(c.length&&c.length<=3) subs.push(c.slice()); if(c.length===3) return; for(let j=i;j<effs.length;j++){ c.push(effs[j]); rec(j+1,c); c.pop(); } })(0,[]);
        subs.forEach(s=>Exact.valueFor(s,blank())); await ready(); }
      const per=S.per[cfg.name];
      for(;S.gi<gamesPerConfig;S.gi++,S.game=null){
        if(!S.game){ PIECES.forEach(p=>state.pieces[p]=blank()); S.game={cost:0,steps:0}; if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); PIECES.forEach(p=>Exact.ensure(p)); await ready(); checkUnit(cfg,effs); }
        while(S.game.steps<3000){
          if(Date.now()-t0>budgetMs) return {partial:true,setup:S.ci+1,of:configs.length,game:S.gi+1,statesSoFar:S.units};
          S.game.steps++; const r=playStep(); if(r===false) break;
          if(r==='moved'){ if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); PIECES.forEach(p=>Exact.ensure(p)); await ready(); checkUnit(cfg,effs); }
        }
        S.games++; per.games++; per.sumCost+=S.game.cost;
      }
    }
    S.done=true;
    Object.keys(state).forEach(k=>delete state[k]); Object.assign(state, JSON.parse(saved)); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); save(); renderAll();
    return {done:true,games:S.games,states:S.units};
  };
  window.unitReport=function(){ if(!S) return 'run unitCheckAll() first';
    const f=b=>({checked:b.n,costlierThanCheapest:b.bad,averageWhenCostlier:b.bad?+(b.sum/b.bad).toFixed(1):0,worst:b.worst,examples:b.ex});
    return {finished:S.done,gamesPlayed:S.games,statesChecked:S.units,skipped:S.skipped,
      modulesToGo:Object.assign(f(S.cost),{belowCheapest:S.cost.under,belowExamples:S.cost.underEx}),
      planCommitments:f(S.plan), plannedFor:f(S.forced), pieceFinished:f(S.finished),
      securedCounters:{checked:S.counts.n,disagree:S.counts.bad,examples:S.counts.ex},
      lockThenUnlockLoops:{gamesThatHitOne:S.loops.n,ofGames:S.games,examples:S.loops.ex},
      perSetup:Object.fromEntries(Object.entries(S.per).map(([k,v])=>[k,{games:v.games,states:v.units,avgBuildCost:v.games?Math.round(v.sumCost/v.games):null,avgModulesToGoAboveCheapest:v.units?+(v.sumGap/v.units).toFixed(2):null}]))}; };
})();
