// Audit tool (not part of the site): checks the MOVE on the advice card against the in-page
// exact solver for every piece layout in a sweep. A card disagrees when its move costs more than
// 0.25 modules above the solver's best move. This is the quick form of diff_harness.js: it needs
// no table files, because it reads the solver the page itself runs (which is checked against
// solver.py with diff_harness.js whenever the solver changes).
//
// Use: serve the site folder, open advanced.html or simple.html, load this file, then
//   await moveCheckAll();     // call again while it returns {partial:true}
//   moveReport();             // disagree must be 0
(function(){
  const isSimple=!!(state&&state.roles); const EL='Elemental Damage',CD='Critical Damage',CR='Critical Rate',CS='Charge Speed',CH='Charge Damage',AM='Max Ammo';
  const P=isSimple?(state.active||'Head'):'Leg';
  const G1=groupKey([CR,CD]), G2=groupKey([CS,CH]);
  const blank=()=>[0,1,2].map(()=>({effect:'',tier:11,locked:false}));
  const configs=[ {name:'default3',keys:[EL,'ATK',AM],effs:[EL,'ATK',AM],N:3}, {name:'custom3',keys:[EL,'ATK',CD],effs:[EL,'ATK',CD],goal:{[EL]:10,'ATK':10,[CD]:9},N:3},
    {name:'two',keys:[EL,'ATK'],effs:[EL,'ATK'],N:2}, {name:'one',keys:[EL],effs:[EL],N:1},
    {name:'blue3',keys:[EL,'ATK',AM],effs:[EL,'ATK',AM],goal:{[EL]:12,'ATK':12,[AM]:12},N:3}, {name:'black3',keys:[EL,'ATK',AM],effs:[EL,'ATK',AM],goal:{[EL]:15,'ATK':15,[AM]:15},N:3},
    {name:'twogroups',keys:[EL,G1,G2],effs:[EL,CR,CD,CS,CH],N:3,tiers:[3,13]},
    {name:'passable',keys:[EL,'ATK'],pass:[AM],effs:[EL,'ATK',AM],N:2},
    {name:'group+passable',keys:[EL,G1],pass:['ATK'],effs:[EL,CR,CD,'ATK'],N:2,tiers:[3,13]} ]
    .concat(isSimple?[{name:'any2of3',keys:[EL,'ATK',AM],effs:[EL,'ATK',AM],N:2},{name:'group',keys:[EL,'ATK',G1],effs:[EL,'ATK',CR,CD],N:3,tiers:[3,13]}]:[]);
  const setup=isSimple
    ? (cfg,temp)=>{ Object.keys(state.roles).forEach(k=>{ if(EFF_NAMES.includes(k)) state.roles[k]='Off'; else delete state.roles[k]; }); cfg.keys.forEach(k=>state.roles[k]='Target'); (cfg.pass||[]).forEach(k=>state.roles[k]='Passable'); state.goalTierBy=Object.assign({},cfg.goal||{}); state.N=cfg.N; state.tempLocks=temp; delete state.keep; delete state.rareOk; }
    : (cfg,temp)=>{ state.req=Object.fromEntries(cfg.keys.map(k=>[k,4])); (cfg.pass||[]).forEach(k=>state.req[k]='P'); state.goalTierBy=Object.assign({},cfg.goal||{}); state.tempLocks=temp; delete state.keep; delete state.rareOk; ['Head','Arm','Body','Leg'].forEach(p=>state.pieces[p]=blank()); state.active='Leg'; };
  const strip=s=>(s||'').replace(/<[^>]+>/g,'');
  const wait=()=>new Promise(r=>{ const t=()=>{ if(Exact.status(P)!=='pending'&&!Exact.busy()) r(); else setTimeout(t,30); }; t(); });
  const fmt=ls=>ls.map(l=>l.effect?(l.effect.split(' ').map(w=>w.slice(0,3)).join('')+l.tier+(l.locked?'🔒':'')):'–').join(' | ');
  let S=null;
  window.moveCheckAll=async function(budgetMs){
    budgetMs=budgetMs||30000;
    if(!S) S={ci:0,states:0,judged:0,disagree:0,maxGap:0,ex:[],unmapped:0,unmappedEx:[],saved:JSON.stringify(state),done:false};
    const t0=Date.now(); const jobs=[]; configs.forEach(c=>[false,true].forEach(t=>jobs.push([c,t])));
    for(;S.ci<jobs.length;S.ci++){
      if(Date.now()-t0>budgetMs) return {partial:true,done:S.ci,of:jobs.length};
      const [cfg,temp]=jobs[S.ci]; setup(cfg,temp); state.pieces[P]=blank(); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); Exact.ensure(P); await wait();
      const opts=[null,{e:'DEF',t:5}]; cfg.effs.forEach(e=>{ [...new Set(cfg.tiers?cfg.tiers.concat([goalTier(e)]):[1,3,goalTier(e),13,15])].forEach(t=>opts.push({e,t})); });
      const tag=cfg.name+(temp?' temp':'');
      for(const a of opts) for(const b of opts) for(const c of opts) for(let m=0;m<8;m++){
        const sel=[a,b,c]; if(sel.some((x,i)=>!x&&(m>>i&1))) continue;
        const effs=sel.filter(x=>x&&x.e!=='DEF').map(x=>x.e); if(new Set(effs).size!==effs.length) continue;
        if(sel.filter(x=>x&&x.e==='DEF').length>1) continue;
        const cur=sel.map((x,i)=>x?{effect:x.e,tier:x.t,locked:!!(m>>i&1)}:{effect:'',tier:11,locked:false}); state.pieces[P]=cur; S.states++;
        if(Exact.status(P)==='pending') await wait();
        const q=Exact.qvalues(P,cur); if(!q) continue;
        const rec=recommend(P); const t=strip(rec.title); let act; let mm;
        if((mm=t.match(/^🔑 Temp-lock Line (\d)/))) act=+mm[1];   // temp mode: holding the line is the move
        else act=actionOf(rec);
        if(act<0){ if(q.best===0&&rec.risk==='done'){ S.judged++; continue; } S.unmapped++; if(S.unmappedEx.length<4) S.unmappedEx.push(tag+' :: '+fmt(cur)+' :: '+t); continue; }
        S.judged++; const gap=(isFinite(q.Q[act])?q.Q[act]:1e6)-q.Q[q.best];
        if(gap>0.25){ S.disagree++; if(gap>S.maxGap) S.maxGap=+Math.min(gap,9999).toFixed(2); if(S.ex.length<6) S.ex.push(tag+' :: '+fmt(cur)+' :: card '+ACT_NAMES[act]+' vs solver '+ACT_NAMES[q.best]+' (+'+Math.min(gap,9999).toFixed(2)+') :: '+t); }
      }
    }
    S.done=true; Object.keys(state).forEach(k=>delete state[k]); Object.assign(state, JSON.parse(S.saved)); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); save(); if(typeof renderAll==='function') renderAll();
    return {done:true,states:S.states};
  };
  window.moveReport=function(){ return S?{page:isSimple?'by gear piece':'whole unit',finished:S.done,states:S.states,judged:S.judged,disagree:S.disagree,worstGap:S.maxGap,examples:S.ex,cardsNotUnderstood:S.unmapped,notUnderstoodExamples:S.unmappedEx}:'run moveCheckAll() first'; };
})();
