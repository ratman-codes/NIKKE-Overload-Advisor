// TEMPORARY test harness (not part of the site): diff the live advisor against the solver tables.
(function(){
  const isSimple=!!(state && state.roles);
  if(typeof simPieceCost==='function'){ const simOrig=simPieceCost; simPieceCost=function(a,b,c,t){ return simOrig(a,b,c,200); }; }
  function mapAction(t){
    t=(t||'').replace(/<[^>]+>/g,''); let m;
    if((m=t.match(/^🔒 Lock Line (\d)/))) return 'lock'+m[1];
    if((m=t.match(/^🔑 Temp-lock Line (\d)/))) return 'lock'+m[1];   // temp mode: the hold is the action
    if((m=t.match(/^🔓 Unlock Line (\d)/))) return 'unlock'+m[1];
    if(t.startsWith('🔁')) return 'change';
    if(t.startsWith('🎯')) return 'reset';
    if(t.startsWith('✅')||t.startsWith('🎉')) return 'stop';
    if((m=t.match(/^⚠️ Line (\d) .* is locked below/))) return 'unlock'+m[1];
    return 'other:'+t.slice(0,60);
  }
  window.__pols={}; window.__sums={};
  window.diffLoad=async function(name){
    const data=await fetch('_solved_'+name+'.json',{cache:'reload'}).then(r=>r.json());
    if(isSimple){
      localStorage.removeItem('nikkeOL'); state=load();
      EFF_NAMES.forEach(e=>state.roles[e]='Off'); state.goalTierBy={}; state.tempLocks=false;
      data.targets.forEach(t=>{ state.roles[t.effect]='Target'; state.goalTierBy[t.effect]=t.goal; });
      state.N=data.targets.length;
    }else{
      localStorage.removeItem('nikkeOL2'); state=load();
      state.req={}; state.goalTierBy={}; state.tempLocks=/_temp$/.test(name);
      data.targets.forEach(t=>{ state.req[t.effect]=4; state.goalTierBy[t.effect]=t.goal; });
      if(typeof EV_CACHE!=='undefined') EV_CACHE.clear();
    }
    PIECES.forEach(p=>state.pieces[p]=[0,1,2].map(()=>({effect:'',tier:11,locked:false})));
    state.active='Head'; save();
    window.__diff={name,data,i:0,rows:[],actA:[],actB:[],t0:Date.now()};
  };
  window.diffRun=function(budgetMs){
    const D=window.__diff, data=D.data, t0=Date.now();
    for(;D.i<data.states.length && Date.now()-t0<budgetMs;D.i++){
      const st=data.states[D.i];
      const repLists=st.lines.map(l=>l.kind==='target'?l.reps:[null]);
      const combos=[]; (function rec(i,cur){ if(i===3){combos.push(cur.slice());return;} repLists[i].forEach(r=>{cur[i]=r;rec(i+1,cur);}); })(0,[null,null,null]);
      const acts=[];
      combos.forEach(combo=>{
        let j=0;
        state.pieces.Head=st.lines.map((l,i)=> l.kind==='empty'?{effect:'',tier:11,locked:false} : (l.kind==='junk'?{effect:data.junk[j++],tier:5,locked:!!l.locked}:{effect:l.effect,tier:combo[i],locked:!!l.locked}));
        let a; try{ a=mapAction((state.tempLocks?recommend('Head'):recommendCore('Head')).title); }catch(e){ a='error:'+e.message; } acts.push(a);
      });
      D.actA.push(acts[0]); D.actB.push(acts[acts.length-1]);
      acts.forEach((a,ci)=>{ const q=st.Q[a]; D.rows.push({id:st.id,combo:combos[ci],adv:a,best:st.best,V:st.V,gap:(q===undefined)?null:+(q-st.V).toFixed(2),agree:st.best.includes(a),done:st.done}); });
    }
    return {done:D.i>=data.states.length,i:D.i,of:data.states.length};
  };
  window.diffSummary2=function(topN,filterFn){
    const D=window.__diff; const rows=D.rows.filter(r=>{ const st=D.data.states[r.id]; return !r.done && (!filterFn||filterFn(st,r)); }); const dis=rows.filter(r=>!r.agree);
    const fmt=r=>D.data.states[r.id].lines.map((l,i)=>l.kind==='target'?`${l.effect.replace('Elemental Damage','Ele').replace('Max Ammo','Ammo')}@T${r.combo[i]}${l.locked?'🔒':''}`:(l.kind==='junk'?('junk'+(l.locked?'🔒':'')):'empty')).join(' | ');
    const byPair={};
    dis.forEach(r=>{ const k=r.adv+' → '+r.best.join('|'); const b=byPair[k]=byPair[k]||{n:0,gapSum:0,maxGap:-1,ex:null}; b.n++; if(r.gap!==null&&r.gap<1e9){ b.gapSum+=r.gap; if(r.gap>b.maxGap){ b.maxGap=r.gap; b.ex=r; } } });
    const pairs=Object.entries(byPair).map(([k,b])=>({pair:k,n:b.n,avgGap:+(b.gapSum/b.n).toFixed(2),maxGap:b.maxGap,ex:b.ex?{V:b.ex.V,gap:b.ex.gap,lines:fmt(b.ex)}:null})).sort((a,b)=>b.n*b.avgGap-a.n*a.avgGap).slice(0,topN||15);
    const gaps=dis.map(r=>r.gap).filter(g=>g!==null&&g<1e9);
    return {rowsChecked:rows.length,disagree:dis.length,pct:+(100*dis.length/rows.length).toFixed(1),gapMean:+(gaps.reduce((s,g)=>s+g,0)/Math.max(1,gaps.length)).toFixed(2),gapOver1:gaps.filter(g=>g>1).length,gapOver3:gaps.filter(g=>g>3).length,gapOver10:gaps.filter(g=>g>10).length,gapMax:Math.max(...gaps),errors:rows.filter(r=>/^(other|error)/.test(r.adv)).length,pairs};
  };
  window.noLockedJunk=(st)=>!st.lines.some(l=>l.kind==='junk'&&l.locked);
  window.diffPolicy=function(){ const names=window.__diff.data.actions; const code=a=>{const i=names.indexOf(a); return i<0?'?':String.fromCharCode(48+i);}; return {A:window.__diff.actA.map(code).join(''), B:window.__diff.actB.map(code).join('')}; };
  window.diffNext=async function(queue){
    const t0=Date.now();
    while(Date.now()-t0<30000){
      if(!window.__diff||window.__diff.finished){ if(!queue.length) return {all:true}; await diffLoad(queue.shift()); }
      const r=diffRun(30000-(Date.now()-t0));
      if(r.done){ const D=window.__diff; D.finished=true; window.__sums[D.name]=diffSummary2(6,noLockedJunk); window.__pols[D.name]=diffPolicy(); }
      else return {name:window.__diff.name,i:r.i,of:r.of};
    }
    return {name:window.__diff.name,i:window.__diff.i,of:window.__diff.data.states.length};
  };
  window.diffReport=function(){ const o={}; for(const [k,v] of Object.entries(window.__sums)){ o[k]={rows:v.rowsChecked,disagree:v.disagree,pct:v.pct,gapMean:v.gapMean,gapMax:v.gapMax,over3:v.gapOver3,over10:v.gapOver10,errors:v.errors,pairs:v.pairs.map(p=>`${p.pair}  n=${p.n} avg=${p.avgGap} max=${p.maxGap}  e.g. ${p.ex?p.ex.lines:''}`)}; } return o; };
  window.__queue=['prydwen3','prydwen2','blue3','blue2','black3','black1'];
})();
