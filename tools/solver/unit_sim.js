// TEMPORARY test harness (not part of the site): drive the live whole-unit advisor through a
// simulated game for a full four-piece build and measure the realised rock cost.
// Acceptance after a roll follows the simulator's own scoring (effect phase: targets present with
// placement bonus; value stage: at-goal lines count 100, park-low otherwise), i.e. the advice's intent.
(function(){
  const rngF=()=>Math.random();
  const bandTier=()=>{const r=rngF(); if(r<0.6) return 1+Math.floor(rngF()*5); if(r<0.95) return 6+Math.floor(rngF()*5); return 11+Math.floor(rngF()*5);};
  const bandTierEx=held=>{ let t; do{ t=bandTier(); }while(t===held); return t; };
  function drawEffect(exclude){ const rem=EFF_NAMES.filter(e=>!exclude.includes(e)); let tot=0; rem.forEach(e=>tot+=EFF_P[e]); let r=rngF()*tot; for(const e of rem){ r-=EFF_P[e]; if(r<=0) return e; } return rem[rem.length-1]; }
  function parse(t){ t=(t||'').replace(/<[^>]+>/g,''); let m;
    if((m=t.match(/^🔒 Lock Line (\d)/))) return ['lock',+m[1]-1];
    if((m=t.match(/^🔓 Unlock Line (\d)/))) return ['unlock',+m[1]-1];
    if(t.startsWith('🔁')) return ['change'];
    if(t.startsWith('🎯')) return ['reset'];
    if(t.startsWith('✅')||t.startsWith('🎉')) return ['stop'];
    if((m=t.match(/^⚠️ Line (\d) .* is locked below/))) return ['unlock',+m[1]-1];
    return ['other',t]; }
  function globalStep(){
    const reqd=reqEffects().length>0; const plan=buildPlan();
    const allMet=reqEffects().every(e=>plan.ua.remaining[e]===0&&!(plan.ua.stuck[e]));
    if(allMet) return null;
    const np=nextPiece();
    const target=(np&&np.need>0)?np.p:state.active;
    return {target, rec:recommendCore(target)};
  }
  // score a piece for Keep/Change (same spirit as simPieceCost)
  function effScore(p){ const a=analyze(p); let s=0;
    if(window.__heur){ // candidate human rule: present (10) + placement (L3 +2, L2 +1) + small at-goal bonus b
      const b=window.__b||1;
      a.desired.forEach(tg=>{ const i=state.pieces[p].findIndex(x=>x.effect===tg); if(i<0) return; const l=state.pieces[p][i]; s+=10+(i===2?2:(i===1?1:0)); if(l.tier>=goalTier(tg)) s+=b; });
      (a.optional||[]).forEach(tg=>{ const i=state.pieces[p].findIndex(x=>x.effect===tg); if(i>=0) s+=5+(state.pieces[p][i].tier>=goalTier(tg)?b/2:0); });
      return s; }
    a.desired.forEach(tg=>{ const l=state.pieces[p].findIndex(x=>x.effect===tg); if(l>=0) s+=10+(l===2?2:(l===1?1:0)); }); (a.optional||[]).forEach(tg=>{ const l=state.pieces[p].findIndex(x=>x.effect===tg); if(l>=0) s+=5; }); return s; }
  function valScore(p){ const a=analyze(p); let s=0; state.pieces[p].forEach((l,i)=>{ if(!l.effect||l.locked||!a.desired.includes(l.effect)) return; s+= l.tier>=goalTier(l.effect)?100:(l.tier<=5?2:(l.tier<=10?1:0)); }); return s; }
  // ---- optional: optimal Keep/Change acceptance from the solver tables (V lookup) ----
  window.__V={};   // key = sorted desired effects joined -> {classes:{effect:[[lo,hi],...]}, V:Map}
  window.unitLoadTables=async function(names){
    for(const nm of names){
      const data=await fetch('_solved_'+nm+'.json',{cache:'reload'}).then(r=>r.json());
      const key=data.targets.map(t=>t.effect).sort().join('|');
      const classes={}; const V=new Map();
      data.states.forEach(st=>{ st.lines.forEach(l=>{ if(l.kind==='target'){ (classes[l.effect]=classes[l.effect]||[]); if(!classes[l.effect].some(c=>c[0]===l.tiers[0])) classes[l.effect].push(l.tiers); } });
        const k=st.lines.map(l=>l.kind==='empty'?'e':(l.kind==='junk'?('j'+(l.locked?1:0)):(l.effect+':'+l.tiers[0]+':'+(l.locked?1:0)))).join('|'); V.set(k,st.V); });
      window.__V[key]={classes,V};
    }
    return Object.keys(window.__V);
  };
  function vLookup(p){
    const a=analyze(p); const key=a.desired.slice().sort().join('|'); const T=window.__V[key]; if(!T) return null;
    const k=state.pieces[p].map(l=>{ if(!l.effect) return 'e'; const cl=T.classes[l.effect]; if(!cl) return 'j'+(l.locked?1:0); const c=cl.find(c=>l.tier>=c[0]&&l.tier<=c[1]); return l.effect+':'+c[0]+':'+(l.locked?1:0); }).join('|');
    const v=T.V.get(k); return v===undefined?null:v;
  }
  window.unitTrial=function(maxSteps){
    PIECES.forEach(p=>state.pieces[p]=[0,1,2].map(()=>({effect:'',tier:11,locked:false})));
    let cost=0, steps=0, other=0;
    while(steps++<(maxSteps||4000)){
      const g=globalStep(); if(!g) break;
      const p=g.target, lines=state.pieces[p], [act,arg]=parse(g.rec.title);
      const nl=lines.filter(l=>l.locked).length;
      if(act==='stop'){ state.active=p; break; }
      if(act==='lock'){ cost+=lockCost(nl); lines[arg].locked=true; }
      else if(act==='unlock'){ lines[arg].locked=false; }
      else if(act==='change'){
        cost+=rerollCost(nl);
        const before=lines.map(l=>({...l})); const v0=window.__useV?vLookup(p):null; const b0=effScore(p);
        const lockedEffs=lines.filter(l=>l.locked).map(l=>l.effect);
        const drawn=[];
        for(let i=0;i<3;i++){ if(lines[i].locked) continue; if(rngF()<LINE_P[i]){ const e=drawEffect(lockedEffs.concat(drawn)); drawn.push(e); lines[i]={effect:e,tier:bandTier(),locked:false}; } else lines[i]={effect:'',tier:11,locked:false}; }
        const v1=(v0!==null)?vLookup(p):null;
        const accept=(v0!==null&&v1!==null)?(v1<v0):(effScore(p)>b0);
        if(!accept) state.pieces[p]=before;   // keep the old roll unless better
      }
      else if(act==='reset'){
        cost+=rerollCost(nl);
        const before=lines.map(l=>({...l})); const v0=window.__useV?vLookup(p):null; const b0=valScore(p);
        for(let i=0;i<3;i++){ if(lines[i].locked||!lines[i].effect) continue; lines[i]={effect:lines[i].effect,tier:bandTierEx(lines[i].tier),locked:false}; }
        const v1=(v0!==null)?vLookup(p):null;
        const accept=(v0!==null&&v1!==null)?(v1<v0):(valScore(p)>b0);
        if(!accept) state.pieces[p]=before;
      }
      else { other++; if(other>50) break; }
      EV_CACHE.clear();
    }
    return {cost,steps,other};
  };
  window.unitRun=function(n,budgetMs){ const t0=Date.now(); const out=window.__unit=window.__unit||{costs:[],others:0,steps:[]}; while(out.costs.length<n && Date.now()-t0<(budgetMs||30000)){ const r=unitTrial(); out.costs.push(r.cost); out.steps.push(r.steps); out.others+=r.other; } const c=out.costs; const m=c.reduce((s,x)=>s+x,0)/c.length; const sd=Math.sqrt(c.reduce((s,x)=>s+(x-m)**2,0)/c.length); return {n:c.length,mean:+m.toFixed(1),se:+(sd/Math.sqrt(c.length)).toFixed(1),sd:+sd.toFixed(1),others:out.others,maxSteps:Math.max(...out.steps)}; };
})();
