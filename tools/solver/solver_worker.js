// Exact optimal-policy solver for ONE gear piece, browser edition (runs in a Web Worker).
// Port of tools/solver/solver.py: same state reduction, same value iteration with an exact
// Keep/Change fixed point per state. Message in: {id, spec}; message out: {id, V, codes, L, nS}.
//   spec = { targets:[{name, goal, weight}], junkWeight, tempLocks }
//   targets: one entry per requirement slot; an "any of" group is one entry whose weight is the
//   sum of its members' weights and whose name is the group key.
'use strict';
const ROLL=[1,2,3,4], LOCK=[2,3,4,4], LINE_P=[1,0.5,0.3], TEMP_LOCK_ROCKS=0.05;
const BIN=t=>t<=5?0.12:(t<=10?0.07:0.01);
function classesFor(goal){
  const groups=new Map();
  for(let t=1;t<=15;t++){ const band=t<=5?1:(t<=10?2:3); const key=band*10+(t>=goal?1:0); if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(t); }
  return [...groups.keys()].sort((a,b)=>a-b).map(key=>{ const tiers=groups.get(key); return {band:Math.floor(key/10), meets:key%10, tiers, mass:tiers.reduce((s,t)=>s+BIN(t),0), m:BIN(tiers[0])}; });
}
function solve(spec){
  const T=spec.targets, nT=T.length, WJ=spec.junkWeight, aJ=WJ/Math.max(1,spec.junkCount||6), temp=!!spec.tempLocks;
  const cls=T.map(t=>classesFor(t.goal));
  // line codes
  const codes=[{kind:0,tgt:-1,cls:-1,locked:0,meets:0},{kind:1,tgt:-1,cls:-1,locked:0,meets:0},{kind:1,tgt:-1,cls:-1,locked:1,meets:0}];
  const codeOf=new Map();
  for(let k=0;k<nT;k++) for(let ci=0;ci<cls[k].length;ci++) for(let lk=0;lk<2;lk++){ codeOf.set(k+':'+ci+':'+lk,codes.length); codes.push({kind:2,tgt:k,cls:ci,locked:lk,meets:cls[k][ci].meets}); }
  const L=codes.length;
  const idx3=new Int32Array(L*L*L).fill(-1); const states=[];
  for(let a=0;a<L;a++) for(let b=0;b<L;b++) for(let c=0;c<L;c++){
    const tg=[a,b,c].filter(x=>codes[x].kind===2).map(x=>codes[x].tgt); if(new Set(tg).size!==tg.length) continue;
    idx3[(a*L+b)*L+c]=states.length; states.push([a,b,c]);
  }
  const nS=states.length, sidx=tri=>idx3[(tri[0]*L+tri[1])*L+tri[2]];
  const done=new Int8Array(nS), nlock=new Int8Array(nS), lockNext=new Int32Array(nS*3).fill(-1), lockFree=new Int8Array(nS*3), unlockNext=new Int32Array(nS*3).fill(-1);
  const ctxOf=new Int32Array(nS); const ctxIds=new Map(); const chOff=[], chLen=[]; const chStates=[], chProbs=[];
  const rsOff=new Int32Array(nS), rsLen=new Int32Array(nS); const rsStates=[], rsProbs=[];
  function changeOutcomes(ctx){
    const lockedT=new Set(), out=[]; let lockedJ=0;
    ctx.forEach(c=>{ if(c>=0){ if(codes[c].kind===2) lockedT.add(codes[c].tgt); else lockedJ++; } });
    const cur=[0,0,0];
    (function rec(i,p,used,jcnt){
      if(i===3){ out.push([cur.slice(),p]); return; }
      if(ctx[i]>=0){ cur[i]=ctx[i]; rec(i+1,p,used,jcnt); return; }
      const pa=LINE_P[i];
      if(pa<1){ cur[i]=0; rec(i+1,p*(1-pa),used,jcnt); }
      const pool=[]; for(let k=0;k<nT;k++) if(!used.has(k)) pool.push(k);
      const wj=Math.max(0,WJ-aJ*jcnt); let tot=wj; pool.forEach(k=>tot+=T[k].weight);
      pool.forEach(k=>{ const u=new Set(used); u.add(k); cls[k].forEach((c,ci)=>{ cur[i]=codeOf.get(k+':'+ci+':0'); rec(i+1,p*pa*(T[k].weight/tot)*c.mass,u,jcnt); }); });
      if(wj>0){ cur[i]=1; rec(i+1,p*pa*(wj/tot),used,jcnt+1); }
    })(0,1,lockedT,lockedJ);
    return out;
  }
  for(let s=0;s<nS;s++){
    const tri=states[s];
    // done: every slot has a line at goal
    let ok=true; for(let k=0;k<nT;k++){ if(!tri.some(x=>codes[x].kind===2&&codes[x].tgt===k&&codes[x].meets)) { ok=false; break; } } done[s]=ok?1:0;
    const nl=tri.reduce((n,x)=>n+codes[x].locked,0); nlock[s]=nl;
    for(let i=0;i<3;i++){
      const cd=codes[tri[i]];
      if(cd.kind===2&&!cd.locked&&nl<2){ const t=tri.slice(); t[i]=codeOf.get(cd.tgt+':'+cd.cls+':1'); lockNext[s*3+i]=sidx(t); if(temp&&!cd.meets) lockFree[s*3+i]=1; }
      if(cd.locked){ const t=tri.slice(); t[i]=cd.kind===2?codeOf.get(cd.tgt+':'+cd.cls+':0'):1; unlockNext[s*3+i]=sidx(t); }
    }
    const ctx=tri.map(x=>codes[x].locked?x:-1); const ck=ctx.join(',');
    if(!ctxIds.has(ck)){ ctxIds.set(ck,chOff.length); const outs=changeOutcomes(ctx); chOff.push(chStates.length); chLen.push(outs.length); outs.forEach(([t,p])=>{ chStates.push(sidx(t)); chProbs.push(p); }); }
    ctxOf[s]=ctxIds.get(ck);
    // reset outcomes
    const free=[]; for(let i=0;i<3;i++) if(codes[tri[i]].kind===2&&!codes[tri[i]].locked) free.push(i);
    rsOff[s]=rsStates.length;
    if(free.length){
      const per=free.map(i=>{ const cd=codes[tri[i]], cl=cls[cd.tgt], m=cl[cd.cls].m; const d=[]; cl.forEach((c2,cj)=>{ const mass=c2.mass-(cj===cd.cls?m:0); if(mass>1e-12) d.push([codeOf.get(cd.tgt+':'+cj+':0'),mass/(1-m)]); }); return d; });
      (function rec(j,t,p){ if(j===free.length){ rsStates.push(sidx(t)); rsProbs.push(p); return; } per[j].forEach(([code,pr])=>{ const t2=t.slice(); t2[free[j]]=code; rec(j+1,t2,p*pr); }); })(0,tri.slice(),1);
    }
    rsLen[s]=rsStates.length-rsOff[s];
  }
  const CS=Int32Array.from(chStates), CP=Float64Array.from(chProbs), RS=Int32Array.from(rsStates), RP=Float64Array.from(rsProbs);
  const CO=Int32Array.from(chOff), CL=Int32Array.from(chLen);
  const V=new Float64Array(nS); for(let s=0;s<nS;s++) V[s]=done[s]?0:1e5;
  function fixedPoint(v0,cost,off,n,S,P){
    let v=v0;
    for(let it=0;it<12;it++){
      let acc=0,prej=0;
      for(let j=0;j<n;j++){ const vt=V[S[off+j]]; if(vt<v) acc+=P[off+j]*vt; else prej+=P[off+j]; }
      if(prej>=1-1e-12) return 1e18;
      const nv=(cost+acc)/(1-prej); if(Math.abs(nv-v)<1e-9) return nv; v=nv;
    }
    return v;
  }
  function q(s,a){
    const nl=nlock[s];
    if(a<=3){ const t=lockNext[s*3+a-1]; return t>=0?(lockFree[s*3+a-1]?TEMP_LOCK_ROCKS:LOCK[nl])+V[t]:Infinity; }
    if(a<=6){ const t=unlockNext[s*3+a-4]; return t>=0?V[t]:Infinity; }
    if(a===7){ if(nl>=3) return Infinity; const c=ctxOf[s]; return fixedPoint(V[s],ROLL[nl],CO[c],CL[c],CS,CP); }
    if(rsLen[s]>0) return fixedPoint(V[s],ROLL[nl],rsOff[s],rsLen[s],RS,RP); return Infinity;
  }
  let sweeps=0;
  for(;sweeps<600;sweeps++){
    let maxd=0;
    for(let s=0;s<nS;s++){
      if(done[s]){ V[s]=0; continue; }
      let best=1e18; for(let a=1;a<=8;a++){ const v=q(s,a); if(v<best) best=v; }
      const d=Math.abs(best-V[s]); if(d>maxd) maxd=d; V[s]=best;
    }
    if(maxd<1e-3) break;
  }
  return {V,idx3,L,nS,sweeps,cls:cls.map(c=>c.map(x=>({lo:x.tiers[0],hi:x.tiers[x.tiers.length-1]})))};
}
self.onmessage=ev=>{ const {id,spec}=ev.data; try{ const t0=Date.now(); const r=solve(spec); self.postMessage({id,ok:true,V:r.V,idx3:r.idx3,L:r.L,nS:r.nS,sweeps:r.sweeps,cls:r.cls,ms:Date.now()-t0},[r.V.buffer,r.idx3.buffer]); }catch(e){ self.postMessage({id,ok:false,error:String(e)}); } };
