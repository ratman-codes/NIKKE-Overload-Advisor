// Audit tool (not part of the site): plays the whole-unit page the way a PLAYER does and checks what
// the page says NEXT. claim_check.js and move_check.js judge each state on its own; the bugs a player
// found on 6 Nov 2026 were all about the sequence (a card promised a hold, the next card said "switch
// to Arm"; a lock was followed by a switch; a "roll until Line 3" card on a piece nobody had rolled).
// This script drives the real page: it reads the card as drawn (gate, baseline, title, rows, body),
// does what it says (switches piece, rolls with the game's odds, enters the roll in the roll guide and
// obeys its Keep / Change verdict, ticks locks), and after every step checks these rules:
//   1. "then hold that line / Line n" on a Change card: after the roll lands it, the piece's own next step
//      holds that line (lock or temp lock).
//   2. A lock or unlock is never followed by "Switch to another piece" while the piece is unfinished.
//   3. While any piece with a job has never been rolled, the card is the baseline card; otherwise never.
//   4. The roll guide says Change when a roll lands an effect the rows named on its line and nothing else
//      of value was on the piece; it does not claim a saving of a module or more for a roll that only
//      touched lines the rows called "does not count yet".
//   5. The "Then ..." sentence on a lock or unlock card is the piece's actual next step.
//   6. The gate's "X on Line n of P is safe until P is rolled" names only lines P's next step holds.
//   7. A piece shown finished is not reopened later (counted and listed; a reopening can be legitimate,
//      but the player should know it happens).
//   8. After a lock the plan's cost drops by at least the lock's price; after an unlock it does not rise.
//   9. No lock immediately undone by an unlock of the same line.
// It also records a full transcript of the first game of each setup, so a build can be read the way it
// was played.
//
// Use: serve the site folder, open advanced.html, load this file, then
//   await playCheckAll();      // call again while it returns {partial:true}
//   playReport();              // every rule with its count; bad must be 0 (rule 7 is informational)
//   playTranscript('Ele4 ATK4 Ammo2 · Tier 10+')   // one game, step by step
// Your saved state is restored when it finishes.
(function(){
  if(state && state.roles){ console.warn('play_check.js is for advanced.html (the whole-unit page)'); return; }
  const EL='Elemental Damage', CD='Critical Damage', CR='Critical Rate', AM='Max Ammo';
  const configs=[
    {name:'Ele4 ATK4 Ammo2 · Tier 10+', req:{[EL]:4,'ATK':4,[AM]:2}, goal:{[EL]:10,'ATK':10,[AM]:10}, temp:true},
    {name:'Ele4 ATK4 Ammo2 · Prydwen', req:{[EL]:4,'ATK':4,[AM]:2}, temp:true},
    {name:'Ele4 ATK4 Ammo2 · no temp locks', req:{[EL]:4,'ATK':4,[AM]:2}, temp:false},
    {name:'Ele3 ATK3 Ammo3', req:{[EL]:3,'ATK':3,[AM]:3}, temp:true},
    {name:'Ele4 ATK4 Ammo4', req:{[EL]:4,'ATK':4,[AM]:4}, temp:true},
    {name:'Ele4 ATK4 CritAny2', req:{[EL]:4,'ATK':4,[groupKey([CR,CD])]:2}, temp:true} ];
  const blank=()=>[0,1,2].map(()=>({effect:'',tier:11,locked:false}));
  const ab=x=>x.split(' ').map(w=>w.slice(0,3)).join('');
  const fmtP=p=>state.pieces[p].map(l=>l.effect?(ab(l.effect)+l.tier+(l.locked?'🔒':'')):'–').join(' | ');
  const fmtU=()=>PIECES.map(p=>p+': '+fmtP(p)).join('   ');
  const plain=s=>(s||'').replace(/<[^>]+>/g,'');
  const ready=()=>new Promise(r=>{ const t=()=>{ if(!Exact.busy()&&PIECES.every(p=>Exact.status(p)!=='pending')&&!document.body.classList.contains('calc')) r(); else setTimeout(t,25); }; t(); });
  let seed=20261107; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const bandTier=()=>{ const r=rnd(); if(r<0.6) return 1+Math.floor(rnd()*5); if(r<0.95) return 6+Math.floor(rnd()*5); return 11+Math.floor(rnd()*5); };
  const drawEffect=ex=>{ const rem=EFF_NAMES.filter(e=>!ex.includes(e)); let tot=0; rem.forEach(e=>tot+=EFF_P[e]); let r=rnd()*tot; for(const e of rem){ r-=EFF_P[e]; if(r<=0) return e; } return rem[rem.length-1]; };
  let S=null, saved=null;
  const RULES=['1 promised hold is the next step','2 lock/unlock not followed by a switch','3 baseline card exactly while a piece is unrolled','4a guide takes a named landing','4b guide claims no saving for a dead roll','5 "Then ..." on a lock/unlock card is the next step','6 gate "safe until rolled" line is held by the next step','7 finished piece reopened (informational)','8 plan cost after a lock/unlock','9 lock undone by the next card','10 no undefined / NaN / pending left on the card'];
  const R={hold:RULES[0],sw:RULES[1],base:RULES[2],take:RULES[3],dead:RULES[4],then:RULES[5],safe:RULES[6],reopen:RULES[7],cost:RULES[8],loop:RULES[9],clean:RULES[10]};
  const rule=(k,ok,ex)=>{ const b=S.rules[k]; b.n++; if(!ok){ b.bad++; if(b.ex.length<4) b.ex.push(ex); } };

  // the piece's own next step: the action, plus the lines a temp-lock card holds
  function stepOf(p){ const r=recommend(p); const t=plain(r.title); const held=[]; let inner=t;
    const m=t.match(/^🔑 Temp-lock Line (\d)(?: \+ Line (\d))?/); if(m){ held.push(+m[1]-1); if(m[2]) held.push(+m[2]-1); const k=Math.min(...['🔁','🎯','🔒','🔓','⚠'].map(x=>{ const i=t.indexOf(x,2); return i<0?1e9:i; })); inner=k<1e9?t.slice(k):t; }
    return {rec:r,title:t,act:actionOf({title:inner}),held,done:r.risk==='done'}; }
  const holds=(st,i)=>st.act===1+i||st.held.includes(i);
  // what a "Then ..." / "then ..." sentence promises
  function promiseOf(body){ let m;
    if(/That finishes the piece/.test(body)) return {kind:'done'};
    if((m=body.match(/[Tt]hen (?:hold|lock) [A-Za-z /]+? on Line (\d)/))) return {kind:'lock',line:+m[1]-1};
    if((m=body.match(/then (?:hold|lock) Line (\d)/))) return {kind:'lock',line:+m[1]-1};
    if(/then (?:hold|lock) (?:that line|the line it landed on)/.test(body)) return {kind:'lock',line:'landed'};
    if((m=body.match(/Then unlock [A-Za-z /]+? on Line (\d)/))) return {kind:'unlock',line:+m[1]-1};
    if(/Then press Change Effects|then keep pressing Change Effects/.test(body)) return {kind:'change'};
    if(/Then press Reset Attributes|next step is Reset Attributes/.test(body)) return {kind:'reset'};
    return null; }
  function promiseMet(pr,st,landed){ if(!pr) return true; if(pr.kind==='done') return st.done; if(st.done) return pr.kind==='lock';   // a roll that finishes the piece needs no hold
    // a promised hold: the landed line must not be rolled away. A reset (values first) or a lock of another line
    // that the same roll brought keeps the effect, so those count as holding it; a Change that rerolls it does not.
    if(pr.kind==='lock'){ if(st.done) return true; const ls=pr.line==='landed'?(landed||[]):[pr.line]; if(ls.some(i=>holds(st,i))) return true; if(st.act===8||(st.act>=1&&st.act<=3)) return true; return false; }
    if(pr.kind==='unlock') return st.act===4+pr.line; if(pr.kind==='change') return st.act===7; if(pr.kind==='reset') return st.act===8; return true; }

  async function draw(){ renderAll(); await ready(); let tries=0;
    while(document.querySelector('#advice .step.pending')&&tries++<30){ await new Promise(r=>setTimeout(r,80)); renderAll(); await ready(); } }
  function readCard(){ const adv=document.getElementById('advice'); const gate=adv.querySelector('.gate'); const step=gate?gate.querySelector('.next'):adv.querySelector('.step');
    const h3=step&&step.querySelector('h3'); let title=h3?h3.textContent:''; const pt=h3&&h3.querySelector('.ptag'); if(pt) title=title.replace(pt.textContent,'').trim();
    const rows=[]; const rs=step?[...step.querySelectorAll('.lrows > span')]:[];
    for(let k=0;k+1<rs.length;k+=2){ const v=rs[k+1], lab=rs[k].textContent; let m;
      if((m=lab.match(/^Lines (\d)\+(\d)$/))) rows.push({pair:[+m[1]-1,+m[2]-1], line:-1, mute:false, text:v.textContent, effects:[]});
      else{ const effects=[], floors={}; if(!v.classList.contains('mute')){ let last=null; [...v.childNodes].forEach(n=>{ if(n.nodeType===3){ last=n.textContent.trim(); if(last) effects.push(last); } else if(last&&n.classList&&n.classList.contains('mute')){ const fm=n.textContent.match(/T(\d+)\+/); if(fm) floors[last]=+fm[1]; } }); }
        rows.push({line:+lab.replace('Line ','')-1, mute:v.classList.contains('mute'), text:v.textContent, effects, floors}); } }
    return {gate:!!gate, target:gate?gate.querySelector('button').textContent.replace('Switch to ','').trim():null, safe:gate?gate.querySelector('.top .muted').textContent:'', title, rows, body:step?step.innerText:'', pending:!!adv.querySelector('.step.pending'), problem:!!adv.querySelector('.riskline')}; }

  // enter a roll in the real roll-guide popup and read its verdict
  async function askGuide(p,kind,rec,newLines){
    openRollGuide(p,kind,rec); const veil=document.getElementById('guideVeil');
    const rowsEls=()=>veil.querySelectorAll('#gNew .gl');
    for(let i=0;i<3;i++){ let sels=rowsEls()[i].querySelectorAll('select'); if(!sels.length) continue;
      if(kind==='change'){ sels[0].value=newLines[i].effect; sels[0].dispatchEvent(new Event('change')); sels=rowsEls()[i].querySelectorAll('select'); }
      if(newLines[i].effect){ const ts=sels[sels.length-1]; ts.value=String(newLines[i].tier); ts.dispatchEvent(new Event('change')); } }
    await ready(); let v=veil.querySelector('#gVerdict b').textContent, tries=0;
    while(v==='…'&&tries++<30){ await new Promise(r=>setTimeout(r,80)); await ready(); v=veil.querySelector('#gVerdict b').textContent; }
    const why=(veil.querySelector('#gVerdict .why')||{}).textContent||'';
    veil.style.display='none';
    return {v,why}; }

  // one step of play on the card as drawn; returns false when the game is over
  async function playStep(cfg,gameIdx){
    await draw(); const c=readCard(); const G=S.game; const log=s=>{ if(G.log.length<600) G.log.push(`#${G.steps} ${s}`); };
    if(c.pending){ rule(R.clean,false,{setup:cfg.name,unit:fmtU(),card:c.title}); return false; }
    if(/undefined|NaN/.test(c.title+c.body)) rule(R.clean,false,{setup:cfg.name,unit:fmtU(),card:c.title+' || '+c.body.slice(0,200)}); else rule(R.clean,true);
    if(c.title.startsWith('🎉')){ log('🎉 every target met · spent '+G.cost); return false; }
    if(c.title.startsWith('⚠️ Targets no longer fit')){ log('stuck: '+c.title); G.stuck=true; return false; }
    // rule 3: baseline exactly while a piece with a job is unrolled
    const unrolled=PIECES.filter(q=>state.pieces[q].every(l=>!l.effect)&&analyze(q).desired.length>0);
    const isBase=c.title.startsWith('🔁 Change Effects once on');
    rule(R.base, (unrolled.length>0)===isBase, {setup:cfg.name,unit:fmtU(),card:c.title,unrolled});
    // rule 7: finished pieces stay finished
    PIECES.forEach(q=>{ const d=recommend(q).risk==='done'; if(G.fin.has(q)&&!d){ rule(R.reopen,false,{setup:cfg.name,piece:q,unit:fmtU(),nowSays:plain(recommend(q).title)}); G.fin.delete(q); } else if(d){ if(!G.fin.has(q)) rule(R.reopen,true); G.fin.add(q); } });
    // rule 2 and 6: the gate
    if(c.gate){
      if(G.lastLock&&G.lastLock.p===state.active){ rule(R.sw, recommend(state.active).risk==='done', {setup:cfg.name,after:G.lastLock.what,piece:state.active,unit:fmtU(),gate:'Switch to '+c.target}); }
      if(/safe until/.test(c.safe)){ const m=c.safe.match(/(.+?) of (Head|Arm|Body|Leg) (?:is|are) safe until/); if(m){ const P=m[2], st=stepOf(P); const ls=[...m[1].matchAll(/on Line (\d)/g)].map(x=>+x[1]-1); rule(R.safe, ls.every(i=>holds(st,i)), {setup:cfg.name,gateSays:c.safe,pieceStep:st.title,unit:fmtU()}); } }
      log(`${state.active}: gate → switch to ${c.target}${c.safe?' · '+c.safe.trim():''}`);
      state.active=c.target; G.lastLock=null; return true; }
    G.lastLock=null;
    const p=state.active, lines=state.pieces[p]; const nl=lines.filter(l=>l.locked).length;
    const before=buildPlan(); const costBefore=before.exact?before.cost:null;
    let m;
    if(isBase){   // first roll on every unrolled piece
      const ps=PIECES.filter(q=>c.title.includes(q)); ps.forEach(q=>{ const used=[]; for(let i=0;i<3;i++){ if(rnd()<LINE_P[i]){ const e=drawEffect(used); used.push(e); state.pieces[q][i]={effect:e,tier:11,locked:false}; } } G.cost+=1; });
      log(`baseline: first roll on ${ps.join(', ')} → ${fmtU()}`); return true; }
    if((m=c.title.match(/^🔒 Lock Line (\d)/))){ const i=+m[1]-1; const pr=promiseOf(c.body); G.cost+=lockCost(nl); lines[i].locked=true; G.lastLock={p,i,what:c.title};
      if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); await ready();
      const st=stepOf(p); rule(R.then, promiseMet(pr,st), {setup:cfg.name,card:c.title,promise:c.body.match(/Then [^.]*\./)?.[0],nextStep:st.title,unit:fmtU()});
      const after=buildPlan(); if(costBefore!==null&&after.exact) rule(R.cost, after.cost<=costBefore-lockCost(nl)+0.3, {setup:cfg.name,card:c.title,before:+costBefore.toFixed(1),after:+after.cost.toFixed(1),lockPrice:lockCost(nl),unit:fmtU()});
      log(`${p}: ${c.title} → next ${st.title}`); G.afterLock=true; return true; }
    if(c.title.startsWith('🔓')||/^⚠️ Line \d .* is locked below/.test(c.title)){ const is=[...c.title.matchAll(/Line (\d)/g)].map(x=>+x[1]-1).filter(i=>lines[i].locked); if(!is.length){ G.stuck=true; return false; }
      const pr=promiseOf(c.body); const wasLock=G.prevLock; is.forEach(i=>lines[i].locked=false);
      rule(R.loop, !(wasLock&&wasLock.p===p&&is.includes(wasLock.i)), {setup:cfg.name,lock:wasLock&&wasLock.what,thenUnlock:c.title,unit:fmtU()});
      if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); await ready();
      const st=stepOf(p); rule(R.then, promiseMet(pr,st), {setup:cfg.name,card:c.title,promise:c.body.match(/Then [^.]*\./)?.[0],nextStep:st.title,unit:fmtU()});
      const after=buildPlan(); if(costBefore!==null&&after.exact) rule(R.cost, after.cost<=costBefore+0.3, {setup:cfg.name,card:c.title,before:+costBefore.toFixed(1),after:+after.cost.toFixed(1),unit:fmtU()});
      G.lastLock={p,i:is[0],what:c.title}; log(`${p}: ${c.title} → next ${st.title}`); return true; }
    const st0=stepOf(p);
    if(st0.act===7||st0.act===8){
      const kind=st0.act===7?'change':'reset'; const held=st0.held; const price=rerollCost(nl+held.length); G.cost+=price;
      const newL=lines.map(l=>({...l}));
      if(kind==='change'){ const used=lines.filter((l,i)=>l.locked||held.includes(i)).map(l=>l.effect); for(let i=0;i<3;i++){ if(lines[i].locked||held.includes(i)) continue; if(rnd()<LINE_P[i]){ const e=drawEffect(used); used.push(e); newL[i]={effect:e,tier:bandTier(),locked:false}; } else newL[i]={effect:'',tier:11,locked:false}; } }
      else for(let i=0;i<3;i++){ if(lines[i].locked||held.includes(i)||!lines[i].effect) continue; let nt; do{ nt=bandTier(); }while(nt===lines[i].tier); newL[i]={effect:lines[i].effect,tier:nt,locked:false}; }
      const g=await askGuide(p,kind,st0.rec,newL);
      const take=g.v==='Press CHANGE'||g.v==='Either way';
      // rule 4: the rows against the verdict (Change cards only)
      if(kind==='change'&&c.rows.length){
        const counted=i=>c.rows.find(r=>r.line===i&&r.effects.length);
        let landed=[0,1,2].filter(i=>!lines[i].locked&&!held.includes(i)&&newL[i].effect&&counted(i)&&counted(i).effects.some(n=>n.split(' / ').includes(newL[i].effect)&&newL[i].tier>=((counted(i).floors||{})[n]||1)));
        // a pair row: both effects landed on those two lines (either way round when the row says "A with B")
        c.rows.filter(r=>r.pair).forEach(r=>{ const [i,j]=r.pair; const ei=newL[i].effect, ej=newL[j].effect; if(!ei||!ej) return; const names=r.text.split(/ with | on Line \d/).filter(x=>x&&!/^\d$/.test(x)).map(x=>x.trim());
          const hit=/ on Line /.test(r.text)?(names[0].split(' / ').includes(ei)&&names[1].split(' / ').includes(ej)):((names[0].split(' / ').includes(ei)&&names[1].split(' / ').includes(ej))||(names[1].split(' / ').includes(ei)&&names[0].split(' / ').includes(ej)));
          if(hit) landed=landed.concat([i,j]); });
        const othersDead=[0,1,2].filter(i=>!lines[i].locked&&!held.includes(i)).every(i=>{ const r=c.rows.find(x=>x.line===i); return r&&(r.effects.length||r.text==='does not count yet'||r.text==='does not count alone'); });
        const rowsSayDead=!landed.length&&othersDead;
        if(landed.length&&othersDead) rule(R.take, g.v==='Press CHANGE', {setup:cfg.name,card:c.title,rows:c.rows.map(r=>`L${r.line+1}: ${r.mute?r.text:r.effects.join(' or ')}`).join(' · '),roll:newL.map(l=>l.effect?ab(l.effect)+l.tier:'–').join(' | '),verdict:g.v+' '+g.why,unit:fmtU()});
        const sm=g.why.match(/about (\d+) modules? saved/); const saved=sm?+sm[1]:0;
        if(!landed.length&&othersDead) rule(R.dead, !(g.v==='Press CHANGE'&&saved>=1), {setup:cfg.name,card:c.title,rows:c.rows.map(r=>`L${r.line+1}: ${r.mute?r.text:r.effects.join(' or ')}`).join(' · '),roll:newL.map(l=>l.effect?ab(l.effect)+l.tier:'–').join(' | '),verdict:g.v+' '+g.why,unit:fmtU()});
        if(take){ state.pieces[p]=newL; if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); await ready();
          // rule 1: the promised hold
          const pr=promiseOf(c.body); if(pr&&pr.kind==='lock'&&landed.length){ const st=stepOf(p); rule(R.hold, promiseMet(pr,st,landed), {setup:cfg.name,card:c.title,promise:c.body.match(/then (?:hold|lock) [^.]*\./)?.[0],roll:newL.map(l=>l.effect?ab(l.effect)+l.tier:'–').join(' | '),nextStep:st.title,unit:fmtU()}); } }
      } else if(take){ state.pieces[p]=newL; if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); await ready(); }
      log(`${p}: ${c.title}${c.rows.length?' ['+c.rows.map(r=>`L${r.line+1}: ${r.mute?r.text:r.effects.join(' or ')}`).join(' · ')+']':''} · roll ${newL.map(l=>l.effect?ab(l.effect)+l.tier:'–').join(' | ')} → ${g.v}${g.why?' ('+g.why.replace(/\s+/g,' ').trim().slice(0,90)+')':''} · spent ${G.cost}`);
      return true; }
    if(st0.done){ log(`${p}: finished but shown as the move: ${c.title}`); G.stuck=true; return false; }
    log(`${p}: card not understood: ${c.title}`); G.stuck=true; return false;
  }

  window.playCheckAll=async function(budgetMs,gamesPerConfig,only){
    budgetMs=budgetMs||30000; gamesPerConfig=gamesPerConfig||4;
    if(!S){ S={ci:0,gi:0,game:null,games:0,steps:0,done:false,rules:{},logs:{},costs:{},stuckEx:[],only:only||null}; RULES.forEach(k=>S.rules[k]={n:0,bad:0,ex:[]}); saved=JSON.stringify(state);
      // the cost strip's Monte Carlo (2,400 trials per piece, every redraw) is not part of any card: stub it while playing
      S.realSim=window.simPieceCost; window.simPieceCost=()=>({ev:0,sd:0,keys:0}); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); }
    const t0=Date.now();
    for(;S.ci<configs.length;S.ci++,S.gi=0){
      const cfg=configs[S.ci]; if(S.only&&!cfg.name.includes(S.only)) continue;
      for(;S.gi<gamesPerConfig;S.gi++,S.game=null){
        if(!S.game){ state.req=Object.assign({},cfg.req); state.goalTierBy=Object.assign({},cfg.goal||{}); state.tempLocks=!!cfg.temp; delete state.keep; delete state.rareOk; PIECES.forEach(p=>state.pieces[p]=blank()); state.active='Head'; if(typeof EV_CACHE!=='undefined') EV_CACHE.clear();
          S.game={cost:0,steps:0,log:[],fin:new Set(),lastLock:null,prevLock:null,stuck:false}; await draw(); const tg=totalRemainingEV(); S.game.predicted=tg?tg.ev:null; if(S.gi===0) S.game.log.push(`setup ${cfg.name} · page predicts ~${S.game.predicted} modules`); }
        while(S.game.steps<2500){
          if(Date.now()-t0>budgetMs) return {partial:true,setup:S.ci+1,of:configs.length,game:S.gi+1,steps:S.steps};
          S.game.steps++; S.steps++; S.game.prevLock=S.game.lastLock&&S.game.lastLock.what.startsWith('🔒')?S.game.lastLock:null;
          let r; try{ r=await playStep(cfg,S.gi); }catch(e){ S.game.log.push('error: '+e.message); S.game.stuck=true; r=false; }
          if(r===false) break;
        }
        S.games++; (S.costs[cfg.name]=S.costs[cfg.name]||[]).push({spent:S.game.cost,predicted:S.game.predicted,steps:S.game.steps,stuck:S.game.stuck});
        if(S.game.stuck&&S.stuckEx.length<6) S.stuckEx.push({setup:cfg.name,game:S.gi+1,unit:fmtU(),tail:S.game.log.slice(-5)});
        if(S.gi===0) S.logs[cfg.name]=S.game.log.slice();
      }
    }
    S.done=true; if(S.realSim) window.simPieceCost=S.realSim;
    Object.keys(state).forEach(k=>delete state[k]); Object.assign(state, JSON.parse(saved)); if(typeof EV_CACHE!=='undefined') EV_CACHE.clear(); save(); renderAll();
    return {done:true,games:S.games,steps:S.steps};
  };
  window.playReport=function(){ if(!S) return 'run playCheckAll() first';
    const bad=Object.entries(S.rules).filter(([k])=>!/informational/.test(k)).reduce((n,[,v])=>n+v.bad,0);
    return {finished:S.done,games:S.games,steps:S.steps,wrong:bad,stuck:S.stuckEx,
      rules:Object.fromEntries(Object.entries(S.rules).map(([k,v])=>[k,v.bad?{checked:v.n,bad:v.bad,examples:v.ex}:v.n])),
      cost:Object.fromEntries(Object.entries(S.costs).map(([k,v])=>[k,{games:v.length,avgSpent:Math.round(v.reduce((s,x)=>s+x.spent,0)/v.length),pagePredicted:v[0].predicted,stuck:v.filter(x=>x.stuck).length}]))}; };
  window.playTranscript=function(name){ if(!S) return 'run playCheckAll() first'; const k=name?Object.keys(S.logs).find(x=>x.includes(name)):Object.keys(S.logs)[0]; return k?S.logs[k].join('\n'):'no transcript for '+name; };
})();
