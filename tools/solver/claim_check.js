// Audit tool (not part of the site): checks what the advice card SAYS against the solver.
// diff_harness.js checks the move the advisor picks. This checks the sentences around it:
// that every effect named on a line really is on that line, that every "then ..." preview is
// the solver's actual next move, and that every stated reason ("at its target", "below
// target", "does not count yet", quoted chances and prices) is true for the piece.
//
// Use: serve the site folder locally, open advanced.html or simple.html, then in the console
//   await import('./tools/solver/claim_check.js');      // or paste this file
//   await claimCheckAll();                               // call again while it returns {partial:true}
//   claimReport();                                       // every claim with its count; bad must be 0
// It sweeps piece layouts for several target setups with temp locks off and on, and restores
// your saved state when it finishes.
(function(){
  const isSimple=!!(state && state.roles);
  const EL='Elemental Damage', CD='Critical Damage', CR='Critical Rate', CS='Charge Speed', CH='Charge Damage', AM='Max Ammo';
  const P=isSimple?(state.active||'Head'):'Leg';
  const G1=groupKey([CR,CD]), G2=groupKey([CS,CH]);
  // keys = the targets (an "any of" group is one key); effs = every effect the sweep puts on lines;
  // pass = passable bonuses (kept if they land, never rolled for); groupEffs = members of groups
  const configs=[
    {name:'default3', keys:[EL,'ATK',AM], effs:[EL,'ATK',AM], N:3},
    {name:'custom3', keys:[EL,'ATK',CD], effs:[EL,'ATK',CD], goal:{[EL]:10,'ATK':10,[CD]:9}, N:3},
    {name:'two', keys:[EL,'ATK'], effs:[EL,'ATK'], N:2},
    {name:'one', keys:[EL], effs:[EL], N:1},
    {name:'blue3', keys:[EL,'ATK',AM], effs:[EL,'ATK',AM], goal:{[EL]:12,'ATK':12,[AM]:12}, N:3},
    {name:'twogroups', keys:[EL,G1,G2], effs:[EL,CR,CD,CS,CH], groupEffs:[CR,CD,CS,CH], N:3, tiers:[3,13]},
    {name:'passable', keys:[EL,'ATK'], pass:[AM], effs:[EL,'ATK',AM], N:2},
    {name:'group+passable', keys:[EL,G1], pass:['ATK'], effs:[EL,CR,CD,'ATK'], groupEffs:[CR,CD], N:2, tiers:[3,13]} ]
    .concat(isSimple?[
      {name:'any2of3', keys:[EL,'ATK',AM], effs:[EL,'ATK',AM], N:2},
      {name:'group', keys:[EL,'ATK',G1], effs:[EL,'ATK',CR,CD], groupEffs:[CR,CD], N:3} ]:[]);
  const blank=()=>[0,1,2].map(()=>({effect:'',tier:11,locked:false}));
  const setup=isSimple
    ? (cfg,temp)=>{ Object.keys(state.roles).forEach(k=>{ if(EFF_NAMES.includes(k)) state.roles[k]='Off'; else delete state.roles[k]; }); cfg.keys.forEach(k=>state.roles[k]='Target'); (cfg.pass||[]).forEach(k=>state.roles[k]='Passable'); state.goalTierBy=Object.assign({},cfg.goal||{}); state.N=cfg.N; state.tempLocks=temp; }
    : (cfg,temp)=>{ state.req=Object.fromEntries(cfg.keys.map(k=>[k,4])); (cfg.pass||[]).forEach(k=>state.req[k]='P'); state.goalTierBy=Object.assign({},cfg.goal||{}); state.tempLocks=temp; ['Head','Arm','Body','Leg'].forEach(p=>state.pieces[p]=blank()); state.active='Leg'; };

  const strip=s=>(s||'').replace(/<[^>]+>/g,'');
  const L=(e,t,l)=>({effect:e,tier:t,locked:!!l});
  const wait=()=>new Promise(r=>{ const t=()=>{ if(Exact.status(P)!=='pending'&&!Exact.busy()) r(); else setTimeout(t,30); }; t(); });
  const TIE=0.25, EMO=['🎯','🔁','🔒','🔓','⚠','✅','🎉'];
  const NAMES=EFF_NAMES.slice().sort((a,b)=>b.length-a.length).join('|');
  const fmt=ls=>ls.map(l=>l.effect?(l.effect.split(' ').map(w=>w.slice(0,3)).join('')+l.tier+(l.locked?'🔒':'')):'–').join(' | ');
  let S=null, saved=null;

  window.claimCheckAll=async function(budgetMs){
    budgetMs=budgetMs||30000;
    if(!S){ S={claims:{},errors:[],states:0,samples:{},ci:0,done:false}; saved=JSON.stringify(state); }
    const add=(k,ok,ex)=>{ const c=S.claims[k]=S.claims[k]||{n:0,bad:0,ex:[]}; c.n++; if(!ok){ c.bad++; if(c.ex.length<3) c.ex.push(ex); } };
    const t0=Date.now(); const jobs=[]; configs.forEach(cfg=>[false,true].forEach(temp=>jobs.push([cfg,temp])));
    for(;S.ci<jobs.length;S.ci++){
      if(Date.now()-t0>budgetMs) return {partial:true,done:S.ci,of:jobs.length};
      const [cfg,temp]=jobs[S.ci];
      setup(cfg,temp); delete state.keep; delete state.rareOk; state.pieces[P]=blank(); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); Exact.ensure(P); await wait();
      const opts=[null,{e:'DEF',t:5}]; cfg.effs.forEach(e=>{ [...new Set(cfg.tiers?cfg.tiers.concat([goalTier(e)]):[3,goalTier(e),13])].forEach(t=>opts.push({e,t})); });
      const tEffs=cfg.effs.filter(e=>!(cfg.pass||[]).includes(e));   // effects that are targets (a passable bonus is not)
      const tag=cfg.name+(temp?' temp':'');
      for(const a of opts) for(const b of opts) for(const c of opts) for(let m=0;m<8;m++){
        const sel=[a,b,c]; if(sel.some((x,i)=>!x&&(m>>i&1))) continue;
        const effs=sel.filter(x=>x&&x.e!=='DEF').map(x=>x.e); if(new Set(effs).size!==effs.length) continue;
        if(sel.filter(x=>x&&x.e==='DEF').length>1) continue;
        const cur=sel.map((x,i)=>x?L(x.e,x.t,m>>i&1):{effect:'',tier:11,locked:false}); state.pieces[P]=cur; S.states++;
        if(Exact.status(P)==='pending') await wait();
        let r; try{ r=recommend(P); }catch(e){ if(S.errors.length<5) S.errors.push(tag+': '+e.message+' @ '+fmt(cur)); continue; }
        let plain=strip(r.title), body=strip(r.body); const held=[];
        if(/undefined|NaN|\bnull\b/.test(plain+body)) add('no undefined / NaN in the text', false, tag+' :: '+fmt(cur)+' :: '+plain+' || '+body.slice(0,160));
        if(plain.startsWith('🔑')){ const idx=Math.min(...EMO.map(x=>{ const k=plain.indexOf(x); return k<0?1e9:k; }));
          [...plain.slice(0,idx).matchAll(/Line (\d)/g)].forEach(mm=>held.push(+mm[1]-1));
          // the temp-lock lead-in names the held lines: check those names, then judge the inner card
          const lead=body.slice(0,Math.max(0,body.indexOf('then: ')));
          [...lead.matchAll(new RegExp('('+NAMES+') on Line (\\d)','g'))].forEach(x=>add('temp-lock lead-in names the real line', cur[+x[2]-1].effect===x[1], tag+' :: '+fmt(cur)+' :: '+lead));
          plain=plain.slice(idx); const k2=body.indexOf('then: '); if(k2>=0) body=body.slice(k2+6); }
        const eff=cur.map((l,i)=>({effect:l.effect,tier:l.tier,locked:l.locked||held.includes(i)}));
        const Q=ls=>Exact.qvalues(P,ls); const near=(q,k)=>isFinite(q.Q[k])&&q.Q[k]<=q.Q[q.best]+TIE; const nearLock=q=>[1,2,3].some(k=>near(q,k));
        const where=tag+' :: '+fmt(eff)+' :: '+plain+' || '+body.slice(0,240);
        const kind=plain.startsWith('🎯')?'reset':plain.startsWith('🔁')?'change':plain.startsWith('🔒')?'lock':(plain.startsWith('🔓')||plain.startsWith('⚠'))?'unlock':'other';
        if(kind!=='other'&&!S.samples[kind+':'+tag]) S.samples[kind+':'+tag]=fmt(eff)+' → '+plain+' || '+body;
        // naming: every "EFFECT on Line n" / "EFFECT (Line n)" in a lock, unlock or reset card matches the piece
        if(kind==='lock'||kind==='unlock'||kind==='reset'){ const re=new RegExp('('+NAMES+')(?: on Line | \\(Line )(\\d)','g'); let mm; while((mm=re.exec(body))) add('named effect really is on that line', eff[+mm[2]-1].effect===mm[1], where); }
        // the "next step" sentence, checked on the piece after this card's move
        const nextClaim=s2=>{ const q=Q(s2); if(!q) return; let mm; const nb=' → solver next '+ACT_NAMES[q.best];
          if(/That finishes the piece\./.test(body)) add('next: finishes the piece', q.best===0, where+nb);
          else if((mm=body.match(/Then (?:lock|hold) [A-Za-z ]+ on Line (\d)/))) add('next: lock or hold another line', near(q,+mm[1]), where+nb);
          else if((mm=body.match(/Then unlock [A-Za-z ]+ on Line (\d)/))) add('next: unlock another line', near(q,3+ +mm[1]), where+nb);
          else if(/Then press Change Effects/.test(body)) add('next: Change Effects', near(q,7), where+nb);
          else if(/Then press Reset Attributes/.test(body)) add('next: Reset Attributes', near(q,8), where+nb);
          else if(/Then update the piece here/.test(body)) add('next: no claim (update the piece)', true, '');
          else add('next: sentence missing', false, where+nb); };
        if(kind==='lock'){
          const i=+plain.match(/Lock Line (\d)/)[1]-1; const s2=eff.map(x=>({...x})); s2[i].locked=true; nextClaim(s2);
          add('lock card names its effect and line', body.startsWith('Lock '+eff[i].effect+' on Line '+(i+1)+' now'), where);
          if(/It is at its target/.test(body)) add('lock card: "at its target" is true', eff[i].tier>=goalTier(eff[i].effect), where);
          if(/at its current value/.test(body)) add('lock card: "below target" is true', eff[i].tier<goalTier(eff[i].effect), where);
        }
        else if(kind==='unlock'){
          const is=[...plain.matchAll(/Line (\d)/g)].map(x=>+x[1]-1); const s2=eff.map(x=>({...x})); is.forEach(i=>s2[i].locked=false); nextClaim(s2);
          add('unlock card names its effect and line', body.startsWith('Unlock '+eff[is[0]].effect+' on Line '+(is[0]+1)), where);
          if(/below target/.test(body)) add('unlock card: "below target" is true', is.every(i=>eff[i].tier<goalTier(eff[i].effect)), where);
          if(/not one of this piece's targets/.test(body)) add('unlock card: "not a target" is true', !tEffs.includes(eff[is[0]].effect), where);
          const mm=body.match(/Each reset then costs (\d) modules? instead of (\d)/);
          if(mm){ const q=Q(s2); add('unlock card: reset price figures', !!q&&near(q,8)&&+mm[1]===rerollCost(s2.filter(x=>x.locked).length)&&+mm[2]===rerollCost(eff.filter(x=>x.locked).length), where); }
        }
        else if(kind==='reset'){
          const mm=plain.match(/until Line ([\d, or]+?) (?:reaches|[A-Z])/); const named=mm?[...mm[1].matchAll(/\d/g)].map(x=>+x[0]-1):[];
          add('reset title does not promise a lock', !/then lock/.test(plain), where);
          const hit=(i,from)=>{ const s=(from||eff).map(x=>({...x})); s[i].tier=Math.max(s[i].tier,goalTier(s[i].effect)); return s; };
          const linesIn=txt=>txt?[...txt.matchAll(/\(Line (\d)\)/g)].map(x=>+x[1]-1):[];
          const lockSay=linesIn((body.match(/Lock ([^.]*?) as soon as it reaches its target\. If/)||[])[1]);
          const noSay=linesIn((body.match(/If ([^.]*?) gets there first, leave it unlocked/)||[])[1]);
          named.forEach(i=>{ const l=eff[i]; if(!l.effect||l.locked) return; const q=Q(hit(i)); if(!q) return; const nb=' → Line '+(i+1)+' hits → solver '+ACT_NAMES[q.best];
            if(/Lock each line as soon as|Lock it as soon as/.test(body)||lockSay.includes(i)) add('reset: says lock this line when it hits', q.best===0||near(q,1+i), where+nb);
            else if(noSay.includes(i)||/Do not lock the first line|leave it unlocked/.test(body)) add('reset: says leave this line unlocked when it hits', !near(q,1+i)||near(q,8), where+nb);
            else if(/That finishes the piece/.test(body)) add('reset: says this hit finishes the piece', q.best===0, where+nb);
            else if(/No lock is needed/.test(body)) add('reset: one target, no lock needed', q.best===0, where+nb);
            else add('reset: named line with no lock guidance', false, where+nb); });
          if(/Lock once two lines are at target/.test(body)){ const un=noSay.length?noSay:named;
            un.forEach(i=>named.filter(j=>j!==i).forEach(j=>{ const q=Q(hit(j,hit(i))); if(q) add('reset: "lock once two lines are at target"', q.best===0||nearLock(q), where+' → Lines '+(i+1)+'+'+(j+1)+' hit → solver '+ACT_NAMES[q.best]); })); }
          const om=body.match(/([A-Za-z ,]+? on Line \d(?: and [A-Za-z ]+ on Line \d)?) (?:is|are) already at target but stays? unlocked/);
          if(om) [...om[1].matchAll(/on Line (\d)/g)].forEach(x=>{ const i=+x[1]-1; add('reset: "already at target, unlocked" is true', !eff[i].locked&&eff[i].tier>=goalTier(eff[i].effect), where); });
          [...body.matchAll(/comes? up on about ([\d% and]+)% of resets/g)].forEach(x=>{ const ps=x[1].split('% and ').map(Number); const src=noSay.length?noSay:named;
            const want=[...new Set(src.map(i=>Math.round(100*pAtLeast(goalTier(eff[i].effect)))))]; add('reset: quoted hit chance matches the target', ps.every(p=>want.includes(p)), where); });
        }
        else if(kind==='change'){
          const segs=plain.replace(/^🔁 Change Effects until /,'').split(', or ').map(seg=>{ const k=seg.lastIndexOf(' lands on Line '); return {effs:seg.slice(0,k), lines:[...seg.slice(k).matchAll(/\d/g)].map(x=>+x[0]-1)}; });
          const vCur=Exact.value(P,eff); const nexts=new Set(); let allFull=true; const an=analyze(P);
          segs.forEach(seg=>{ const es=EFF_NAMES.filter(e=>new RegExp('(^|, | or | / )'+e+'($|,| or | / )').test(seg.effs));
            seg.lines.forEach(i=>es.forEach(e=>{ if(eff.some(l=>l.locked&&l.effect===e)) return;
              const s2=eff.map(l=>l.locked?{...l}:{effect:'',tier:11,locked:false}); s2[i]={effect:e,tier:1,locked:false}; const v=Exact.value(P,s2); if(v===null) return;
              // an "any of" group counts when some member lands: members are not checked one by one
              if((cfg.groupEffs||[]).includes(e)){ add('change: a group landing is named', true, ''); return; }
              add('change: named landing really is progress', vCur!==null&&v<vCur-TIE, where+' → '+e+' on Line '+(i+1)+' gives '+v.toFixed(1)+' vs '+(vCur===null?'?':vCur.toFixed(1)));
              const have=new Set(s2.filter(l=>l.effect).map(l=>keyOf(l.effect))); if(an.desired.filter(d=>have.has(d)).length<an.N) allFull=false;
              const q=Q(s2); if(q) nexts.add(q.best); })); });
          if(nexts.size===1){ const n=[...nexts][0]; const nb=' → solver '+ACT_NAMES[n];
            if(/then (?:lock|hold) (?:Line \d|the line it landed on)/.test(body)) add('change: then lock / hold the landed line', n>=1&&n<=3, where+nb);
            else if(/next step is Reset Attributes/.test(body)) add('change: then Reset Attributes', n===8, where+nb);
            else if(/That finishes the piece/.test(body)) add('change: then finished', n===0, where+nb);
            else if(/keep pressing Change Effects for the rest/.test(body)) add('change: then keep changing, no lock', n===7, where+nb);
            else if(/Then unlock [A-Za-z ]+ on Line \d \(free\)/.test(body)) add('change: then unlock a line', n>=4&&n<=6, where+nb);
            else if(/enter the new roll here/.test(body)) add('change: no next claim', true, '');
            else add('change: next sentence missing', false, where); }
          if(/Every effect is then on the piece/.test(body)) add('change: "every effect is then on the piece" is true', allFull, where);
          add('change: says to press Change to take the roll', /press Change to take the roll/.test(body), where);
          const dm=body.match(/Lines? (1 and 2|1|2) do(?:es)? not count yet/);
          if(dm) (dm[1]==='1 and 2'?[0,1]:[+dm[1]-1]).forEach(i=>{ const s2=eff.map(x=>({...x})); s2[i]={effect:'',tier:11,locked:false}; const v=Exact.value(P,s2); add('change: a "does not count yet" line is worth nothing', v!==null&&vCur!==null&&v<=vCur+TIE&&!eff[i].locked, where); });
          const lm=body.match(/Losing the (.*?) costs nothing/);
          if(lm) [...lm[1].matchAll(new RegExp('('+NAMES+') on Line (\\d)','g'))].forEach(x=>add('change: "losing X on Line n" names the real line', eff[+x[2]-1].effect===x[1], where));
        }
      }
    }
    S.done=true;
    Object.keys(state).forEach(k=>delete state[k]); Object.assign(state, JSON.parse(saved)); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); save(); if(typeof renderAll==='function') renderAll();
    return {done:true,states:S.states};
  };
  window.claimReport=function(){
    if(!S) return 'run claimCheckAll() first';
    const bad=Object.values(S.claims).reduce((n,c)=>n+c.bad,0);
    return {page:isSimple?'by gear piece':'whole unit', finished:S.done, states:S.states, errors:S.errors, wrongClaims:bad,
      claims:Object.fromEntries(Object.entries(S.claims).map(([k,v])=>[k,v.bad?{checked:v.n,bad:v.bad,examples:v.ex}:v.n]))};
  };
  window.claimSamples=function(){ return S?S.samples:null; };
})();
