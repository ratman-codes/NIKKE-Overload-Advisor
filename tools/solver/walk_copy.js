// TEMPORARY: walk the live advisor through simulated builds and collect every distinct piece of
// text a player would see (step titles/bodies, badges, tiles, notes), so the copy can be
// reviewed as a whole rather than one state at a time.
(function(){
  const rngF=()=>Math.random();
  const bandTier=()=>{const r=rngF(); if(r<0.6) return 1+Math.floor(rngF()*5); if(r<0.95) return 6+Math.floor(rngF()*5); return 11+Math.floor(rngF()*5);};
  const bandTierEx=held=>{ let t; do{ t=bandTier(); }while(t===held); return t; };
  function drawEffect(exclude){ const rem=EFF_NAMES.filter(e=>!exclude.includes(e)); let tot=0; rem.forEach(e=>tot+=EFF_P[e]); let r=rngF()*tot; for(const e of rem){ r-=EFF_P[e]; if(r<=0) return e; } return rem[rem.length-1]; }
  const strip=t=>(t||'').replace(/<[^>]+>/g,'');
  const gen=t=>strip(t).replace(/\d+(\.\d+)?%/g,'N%').replace(/Tier \d+\+?/g,'Tier T').replace(/T\d+/g,'TN').replace(/\b\d+(\.\d+)?\b/g,'N');
  function parse(t){ t=strip(t); let m;
    if((m=t.match(/^🔒 Lock Line (\d)/))) return ['lock',+m[1]-1];
    if((m=t.match(/^🔑 Temp-lock Line (\d)/))) return ['lock',+m[1]-1];
    if((m=t.match(/^🔓 Unlock Line (\d)/))) return ['unlock',+m[1]-1];
    if(t.startsWith('🔁')) return ['change'];
    if(t.startsWith('🎯')) return ['reset'];
    if(t.startsWith('✅')||t.startsWith('🎉')) return ['stop'];
    return ['other',t]; }
  function effScore(p){ const a=analyze(p); let s=0; a.desired.forEach(tg=>{ const l=state.pieces[p].findIndex(x=>keyOf(x.effect)===tg); if(l>=0) s+=10+(l===2?2:(l===1?1:0)); }); (a.optional||[]).forEach(tg=>{ const l=state.pieces[p].findIndex(x=>keyOf(x.effect)===tg); if(l>=0) s+=5; }); return s; }
  function valScore(p){ const a=analyze(p); let s=0; state.pieces[p].forEach((l,i)=>{ if(!l.effect||l.locked||!a.desired.includes(keyOf(l.effect))) return; s+= l.tier>=goalTier(l.effect)?100:(l.tier<=5?2:(l.tier<=10?1:0)); }); return s; }
  const seen=new Map(); const add=(kind,txt,ex)=>{ const k=kind+'|'+gen(txt); if(!seen.has(k)) seen.set(k,{kind,text:strip(txt),n:0,ex}); seen.get(k).n++; };
  function snapshot(target){
    renderAll();
    const t=document.querySelector('#advice .step h3'); if(t) add('title',t.textContent);
    const b=document.querySelector('#advice .step > div'); if(b&&!b.querySelector('.pill')) add('body',b.textContent);
    document.querySelectorAll('#advice .riskline,#advice .secured').forEach(x=>add('cardnote',x.textContent));
    document.querySelectorAll('#advice .why .wb > div').forEach(x=>add('why',x.textContent));
    document.querySelectorAll('#advice > .muted').forEach(x=>add('nudge',x.textContent));
    document.querySelectorAll('.lbadges .badge').forEach(x=>add('badge',x.textContent));
    document.querySelectorAll('.ptile .sub').forEach(x=>add('tile',x.textContent));
    const pm=document.getElementById('pieceMeta'); if(pm) add('meta',pm.textContent);
    const aa=document.getElementById('activeAdvice'); if(aa&&aa.textContent) add('later',aa.textContent);
    const up=document.getElementById('unitProgText'); if(up) add('progress',up.textContent);
    document.querySelectorAll('#advice .pill').forEach(x=>add('pill',x.textContent));
  }
  window.walk=function(req,goals,trials,maxSteps){
    localStorage.removeItem('nikkeOL2'); state=load(); state.req=req; state.goalTierBy=goals||{}; state.tempLocks=true;
    let steps=0;
    for(let t=0;t<(trials||3);t++){
      PIECES.forEach(p=>state.pieces[p]=[0,1,2].map(()=>({effect:'',tier:11,locked:false})));
      for(let k=0;k<(maxSteps||400);k++){
        const plan=buildPlan(); const allMet=reqEffects().every(e=>plan.ua.remaining[e]===0&&!(plan.ua.stuck[e]));
        const np=nextPiece(); const target=(allMet||!np||np.need<=0)?state.active:np.p;
        state.active=(k%7===0)?PIECES[k%4]:target;   // sometimes look at a different piece, like a player would
        snapshot(target); steps++;
        if(allMet) break;
        state.active=target; const rec=recommend(target); const lines=state.pieces[target]; const [act,arg]=parse(rec.title); const nl=lines.filter(l=>l.locked).length;
        if(act==='stop') break;
        if(act==='lock'){ lines[arg].locked=true; }
        else if(act==='unlock'){ lines[arg].locked=false; }
        else if(act==='change'){ const before=lines.map(l=>({...l})); const b0=effScore(target); const lockedEffs=lines.filter(l=>l.locked).map(l=>l.effect); const drawn=[]; for(let i=0;i<3;i++){ if(lines[i].locked) continue; if(rngF()<LINE_P[i]){ const e=drawEffect(lockedEffs.concat(drawn)); drawn.push(e); lines[i]={effect:e,tier:bandTier(),locked:false}; } else lines[i]={effect:'',tier:11,locked:false}; } if(effScore(target)<=b0) state.pieces[target]=before; }
        else if(act==='reset'){ const before=lines.map(l=>({...l})); const b0=valScore(target); for(let i=0;i<3;i++){ if(lines[i].locked||!lines[i].effect) continue; lines[i]={effect:lines[i].effect,tier:bandTierEx(lines[i].tier),locked:false}; } if(valScore(target)<=b0) state.pieces[target]=before; }
        else { add('OTHER',rec.title); break; }
        EV_CACHE.clear();
      }
    }
    const out={}; [...seen.values()].forEach(v=>{ (out[v.kind]=out[v.kind]||[]).push(v.text+(v.n>1?`  [×${v.n}]`:'')); });
    return {steps, distinct:seen.size, out};
  };
})();
