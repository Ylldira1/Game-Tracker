import { firebaseConfig } from './firebase-config.js';

/* =========================================================
   Game Event Tracker
   - Works offline in "browser only" mode when firebaseConfig is null
   - Syncs through Firebase (Google sign-in + Firestore) when configured
   ========================================================= */

const FB_VERSION = '10.12.2';
const H = 3600000, D = 86400000;
const PALETTE = ['#7c5cff','#ff5d8f','#3ecf8e','#ffb547','#4cc9f0','#f77f00','#c77dff','#90be6d'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const state = {
  games: {}, events: {},
  filter: 'all', showDone: false,
  mode: 'left', prio: 'normal',
  editId: null, editGameId: null, quick: null,
};
let store = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = o => JSON.parse(JSON.stringify(o));

function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',2600); }
function setSync(cls,text){ $('syncDot').className='dot '+cls; $('syncText').textContent=text; }

/* ---------------- Storage: browser only ---------------- */
function localStore(){
  const KEY='gameEventTracker.v2';
  let ok=true;
  try{
    const raw=localStorage.getItem(KEY);
    if(raw){ const d=JSON.parse(raw); state.games=d.games||{}; state.events=d.events||{}; }
  }catch(e){ ok=false; }
  const persist=()=>{ try{ localStorage.setItem(KEY, JSON.stringify({games:state.games, events:state.events})); }catch(e){ toast('Could not save in this browser.'); } };
  setSync(ok?'warn':'', ok?'Saved in this browser only':'Not saving (storage blocked)');
  return {
    async saveGame(){ persist(); }, async deleteGame(){ persist(); },
    async saveEvent(){ persist(); }, async deleteEvent(){ persist(); },
  };
}

/* ---------------- Sharing (Super Admin → followers) ---------------- */
// The Super Admin can share games. Everyone else can follow them: shared quests then
// appear in their tracker automatically, while done/progress stays private per person.
const ADMIN_EMAIL='darrebpphwork99@gmail.com';
const PROG_E=['doneFor','count','countFor','checks','checkFor'];  // per-person quest progress
const PROG_G=['dailyDoneFor'];                                   // per-person game progress
let myEmail='';
const raw={games:{},events:{},progress:{},follow:{games:[],hidden:[],left:[]},sGames:{},sQuests:{},profiles:{}};
const parts={};   // shared data arrives from several queries; merged into raw.sGames / raw.sQuests
const audienceOf=g=>({audience:(g&&g.audience)||'all', emails:(g&&g.emails)||[]});
let isAdmin=false, sharingOn=false;
const pick=(o,keys)=>{ const r={}; keys.forEach(k=>{ if(o&&o[k]!==undefined) r[k]=o[k]; }); return r; };
const omit=(o,keys)=>{ const r={...o}; keys.forEach(k=>delete r[k]); return r; };
const canEdit=x=>!x||!x.shared||isAdmin;

function compose(){
  const f=raw.follow, games={}, events={};
  Object.values(raw.games).forEach(g=>{ games[g.id]=g; });
  Object.values(raw.sGames).forEach(g=>{
    if(isAdmin || isFollowing(g)) games[g.id]={...g, ...pick(raw.progress[g.id],PROG_G), id:g.id, shared:true};
  });
  Object.values(raw.events).forEach(e=>{
    events[e.id]=e;
    // A followed game that was removed or unshared: keep the person's own quests visible
    if(!games[e.game]) games[e.game]={id:e.game,name:'Removed game',color:'#8b91a7',created:0,offset:8,dailyHour:4,weeklyDay:1,monthlyDay:1};
  });
  Object.values(raw.sQuests).forEach(q=>{
    const g=games[q.game]; if(!g||!g.shared) return;
    if(!isAdmin && f.hidden.includes(q.id)) return;
    events[q.id]={...q, ...pick(raw.progress[q.id],PROG_E), id:q.id, shared:true};
  });
  state.games=games; state.events=events;
}
function isFollowing(g){
  const f=raw.follow;
  if(f.games.includes(g.id)) return true;
  return g.audience==='some' && (g.emails||[]).includes(myEmail) && !f.left.includes(g.id);
}
const sharedAvailable=()=>Object.values(raw.sGames).filter(g=>!isFollowing(g)).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
const hiddenCount=gid=>raw.follow.hidden.filter(id=>raw.sQuests[id]&&raw.sQuests[id].game===gid).length;

/* ---------------- Storage: Firebase ---------------- */
async function firebaseStore(){
  const base=`https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [{initializeApp},{getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,onAuthStateChanged,signOut},fs] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)
  ]);
  const app=initializeApp(firebaseConfig);
  const auth=getAuth(app);
  let db;
  try{ db=fs.initializeFirestore(app,{localCache:fs.persistentLocalCache()}); }catch(e){ db=fs.getFirestore(app); }

  let user=null, unsubs=[];
  const provider=new GoogleAuthProvider();

  $('googleBtn').onclick=async()=>{
    $('signErr').textContent='';
    try{ await signInWithPopup(auth,provider); }
    catch(e){
      if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth,provider);
      else if(e.code!=='auth/popup-closed-by-user') $('signErr').textContent='Sign-in failed: '+(e.code||e.message);
    }
  };

  function fail(e){ console.error(e); toast('Could not save: '+(e.code||'error')); }
  const U=(...p)=>fs.doc(db,'users',user.uid,...p);
  const S=(col,id)=>fs.doc(db,col,id);
  const set=(ref,data)=>fs.setDoc(ref,clean(data));
  const del=ref=>fs.deleteDoc(ref);
  const saveFollow=()=>set(U('meta','follow'),raw.follow).catch(fail);

  const api={
    sharing:true,
    saveGame(g){
      if(g.shared){
        const w=[set(U('progress',g.id),{dailyDoneFor:g.dailyDoneFor??null})];
        if(isAdmin){
          const prev=raw.sGames[g.id], aud=audienceOf(g);
          w.push(set(S('sharedGames',g.id),{...omit(g,[...PROG_G,'shared']),...aud}));
          if(prev && JSON.stringify(audienceOf(prev))!==JSON.stringify(aud))
            Object.values(raw.sQuests).filter(q=>q.game===g.id).forEach(q=>w.push(set(S('sharedQuests',q.id),{...omit(q,['shared']),...aud})));
        }
        return Promise.all(w).catch(fail);
      }
      return set(U('games',g.id),omit(g,['shared'])).catch(fail);
    },
    deleteGame(id,shared){
      if(shared){
        if(isAdmin) return del(S('sharedGames',id)).catch(fail);
        return api.unfollow(id);
      }
      return del(U('games',id)).catch(fail);
    },
    saveEvent(e){
      if(e.shared){
        const w=[set(U('progress',e.id),pick(e,PROG_E))];
        if(isAdmin) w.push(set(S('sharedQuests',e.id),{...omit(e,[...PROG_E,'shared']),...audienceOf(raw.sGames[e.game]||state.games[e.game])}));
        return Promise.all(w).catch(fail);
      }
      return set(U('events',e.id),omit(e,['shared'])).catch(fail);
    },
    deleteEvent(id,shared){
      if(shared){
        if(isAdmin) return Promise.all([del(S('sharedQuests',id)),del(U('progress',id))]).catch(fail);
        if(!raw.follow.hidden.includes(id)) raw.follow.hidden.push(id);
        compose(); return saveFollow();
      }
      return del(U('events',id)).catch(fail);
    },
    follow(gid){ if(!raw.follow.games.includes(gid)) raw.follow.games.push(gid); raw.follow.left=raw.follow.left.filter(x=>x!==gid); compose(); renderAll(); return saveFollow(); },
    unfollow(gid){ raw.follow.games=raw.follow.games.filter(x=>x!==gid); if(!raw.follow.left.includes(gid)) raw.follow.left.push(gid); compose(); renderAll(); return saveFollow(); },
    unhide(gid){ raw.follow.hidden=raw.follow.hidden.filter(id=>!(raw.sQuests[id]&&raw.sQuests[id].game===gid)); compose(); renderAll(); return saveFollow(); },
    // Admin only: move a game (and its quests) between private and shared
    async shareGame(g,on){
      try{
        if(on){
          await set(S('sharedGames',g.id),{...omit(g,[...PROG_G,'shared']),...audienceOf(g)});
          await set(U('progress',g.id),{dailyDoneFor:g.dailyDoneFor??null});
          for(const e of Object.values(raw.events).filter(e=>e.game===g.id && !e.private)){
            await set(S('sharedQuests',e.id),{...omit(e,[...PROG_E,'shared','private']),...audienceOf(g)});
            await set(U('progress',e.id),pick(e,PROG_E));
            await del(U('events',e.id));
          }
          await del(U('games',g.id));
        }else{
          await set(U('games',g.id),omit(g,['shared','audience','emails']));
          for(const q of Object.values(raw.sQuests).filter(q=>q.game===g.id)){
            await set(U('events',q.id),{...omit(q,['shared','audience','emails']),...pick(raw.progress[q.id],PROG_E)});
            await del(S('sharedQuests',q.id));
          }
          await del(S('sharedGames',g.id));
        }
      }catch(e){ fail(e); }
    },
  };

  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f()); unsubs=[];
    user=u;
    Object.assign(raw,{games:{},events:{},progress:{},follow:{games:[],hidden:[],left:[]},sGames:{},sQuests:{},profiles:{}});
    Object.keys(parts).forEach(k=>delete parts[k]);
    if(!u){
      state.games={}; state.events={};
      $('app').hidden=true; $('fab').hidden=true; $('signin').hidden=false; $('userBox').innerHTML='';
      $('signOutBtn').hidden=true; $('signOutSep').hidden=true;
      setSync('','Signed out');
      return;
    }
    isAdmin=(u.email||'').toLowerCase()===ADMIN_EMAIL; sharingOn=true;
    $('signin').hidden=true; $('app').hidden=false; $('fab').hidden=false;
    const nm=u.displayName||u.email||'';
    $('userBox').innerHTML=`${u.photoURL?`<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`:`<span class="avatar">${esc(nm.charAt(0).toUpperCase())}</span>`}<span>${esc(nm)}</span>${isAdmin?'<span class="admin-badge" title="You can share games with everyone">Super Admin</span>':''}`;
    $('signOutBtn').hidden=false; $('signOutSep').hidden=false;
    $('signOutBtn').onclick=()=>{ closeMenu(); signOut(auth); };
    setSync('warn','Connecting…');
    const live={};
    const onErr=err=>{ console.error(err); setSync('warn','Sync error: '+err.code); };
    const status=()=>{
      if(live.games&&live.events) setSync('ok','Synced');
      else setSync('warn', navigator.onLine?'Connecting…':'Offline — will sync later');
    };
    const sub=(ref,key,part)=>fs.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
      const out={}; snap.forEach(d=>{ out[d.id]={...d.data(),id:d.id}; });
      if(part){ parts[part]=out; raw[key]=Object.assign({},...Object.keys(parts).filter(p=>p.startsWith(key+':')).map(p=>parts[p])); }
      else raw[key]=out;
      live[key]=!snap.metadata.fromCache;
      if(isAdmin && (key==='sGames'||key==='sQuests')) backfillAudience(key);
      compose(); status(); renderAll();
    },onErr);
    // Shared data: the Super Admin reads everything; others read what's shared with everyone or with their email
    const email=(u.email||'').toLowerCase(); myEmail=email;
    const sharedSubs=col=>{
      const key=col==='sharedGames'?'sGames':'sQuests';
      if(isAdmin) return [sub(fs.collection(db,col),key)];
      return [
        sub(fs.query(fs.collection(db,col),fs.where('audience','==','all')),key,key+':all'),
        sub(fs.query(fs.collection(db,col),fs.where('emails','array-contains',email)),key,key+':me'),
      ];
    };
    // Shared items created before audiences existed: mark them "everyone" once
    const backfilled=new Set();
    function backfillAudience(key){
      const col=key==='sGames'?'sharedGames':'sharedQuests';
      Object.values(raw[key]).forEach(d=>{
        if(d.audience||backfilled.has(d.id)) return;
        backfilled.add(d.id);
        const g=key==='sGames'?d:raw.sGames[d.game];
        set(S(col,d.id),{...omit(d,['id']),...audienceOf(g)}).catch(fail);
      });
    }
    // Let the Super Admin see who has signed in (for picking people to share with)
    set(fs.doc(db,'profiles',u.uid),{email,name:u.displayName||'',photo:u.photoURL||'',lastSeen:Date.now()}).catch(()=>{});
    unsubs.push(
      sub(fs.collection(db,'users',u.uid,'games'),'games'),
      sub(fs.collection(db,'users',u.uid,'events'),'events'),
      sub(fs.collection(db,'users',u.uid,'progress'),'progress'),
      ...sharedSubs('sharedGames'),
      ...sharedSubs('sharedQuests'),
      ...(isAdmin?[sub(fs.collection(db,'profiles'),'profiles')]:[]),
      fs.onSnapshot(U('meta','follow'),snap=>{
        const d=snap.exists()?snap.data():{};
        raw.follow={games:d.games||[],hidden:d.hidden||[],left:d.left||[]};
        compose(); renderAll();
      },onErr),
    );
    renderAll();
  });
  return api;
}

/* ---------------- Time helpers ---------------- */
const fmtOffset = o => 'UTC' + (o>=0?'+':'−') + Math.abs(o);
function nextDaily(g,now){
  if(g.dailyHour==null || g.dailyHour==='') return null;
  const o=(+g.offset||0)*H, s=new Date(now+o);
  let t=Date.UTC(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate(),+g.dailyHour)-o;
  if(t<=now) t+=D;
  return t;
}
function nextWeekly(g,now){
  if(g.weeklyDay==null || g.weeklyDay==='') return null;
  const o=(+g.offset||0)*H, s=new Date(now+o), hr=(g.dailyHour==null||g.dailyHour==='')?0:+g.dailyHour;
  let t=Date.UTC(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate(),hr)-o + ((+g.weeklyDay - s.getUTCDay() + 7)%7)*D;
  if(t<=now) t+=7*D;
  return t;
}
// Current round of an event (handles repeating events without writing anything)
function resetCfg(g){
  g=g||{}; const blank=v=>v==null||v==='';
  return { offset: blank(g.offset)?8:+g.offset, dailyHour: blank(g.dailyHour)?4:+g.dailyHour, weeklyDay: blank(g.weeklyDay)?1:+g.weeklyDay, monthlyDay: blank(g.monthlyDay)?1:+g.monthlyDay };
}
// Monthly reset: given day of month (clamped to month length) at the daily reset hour, server time
function monthlyAt(g,y,m){
  const o=(+g.offset||0)*H, hr=(g.dailyHour==null||g.dailyHour==='')?0:+g.dailyHour;
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return Date.UTC(y,m,Math.min(+g.monthlyDay||1,last),hr)-o;
}
function nextMonthly(g,now){
  if(g.monthlyDay==null || g.monthlyDay==='') return null;
  const s=new Date(now+(+g.offset||0)*H);
  let t=monthlyAt(g,s.getUTCFullYear(),s.getUTCMonth());
  if(t<=now) t=monthlyAt(g,s.getUTCFullYear(),s.getUTCMonth()+1);
  return t;
}
function prevMonthly(g,next){
  const s=new Date(next+(+g.offset||0)*H);
  return monthlyAt(g,s.getUTCFullYear(),s.getUTCMonth()-1);
}
function occ(e,now){
  if(e.type==='monthly'){
    const g=resetCfg(state.games[e.game]); if(+e.monthDay) g.monthlyDay=+e.monthDay;
    const end=nextMonthly(g,now);
    return { end, start: prevMonthly(g,end), ended:false };
  }
  if(e.type==='daily'||e.type==='weekly'){
    const g=resetCfg(state.games[e.game]), wk=e.type==='weekly';
    const end = wk ? nextWeekly(g,now) : nextDaily(g,now);
    return { end, start: end-(wk?7*D:D), ended:false };
  }
  const P=(+e.repeat||0)*D;
  let end=e.end;
  if(P>0 && end<=now) end += (Math.floor((now-end)/P)+1)*P;
  const start = P>0 ? end-P : (e.created||end);
  return { end, start, ended: P===0 && end<=now };
}
const isDone   = (e,o)=> e.doneFor===o.end;
const getCount = (e,o)=> e.countFor===o.end ? (+e.count||0) : 0;
const getChecks= (e,o)=> e.checkFor===o.end ? (e.checks||[]) : [];

function fmtLeft(ms){
  if(ms<=0) return 'Ended';
  const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60), sec=s%60;
  const p=n=>String(n).padStart(2,'0');
  return d>0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
}
function urgency(ms){ if(ms<=0)return'gray'; if(ms<D)return'red'; if(ms<3*D)return'amber'; return'green'; }
// Countdowns from the game hide seconds, so "time left" is slightly early.
// Round to the most likely real end: the game's reset time (e.g. 4:00 / 3:59 AM),
// otherwise the nearest :00 or :59 when it's within a few minutes.
function snapEnd(t,g){
  const c=resetCfg(g), o=c.offset*H, s=new Date(t+o);
  const dayStart=Date.UTC(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate())-o;
  let best=null;
  const consider=(x,tol,why)=>{ const d=Math.abs(x-t); if(d<=tol && (!best||d<best.d)) best={t:x,d,why}; };
  for(let k=-1;k<=1;k++){ const r=dayStart+k*D+c.dailyHour*H; consider(r,15*60000,'reset'); consider(r-60000,15*60000,'reset'); }
  if(!best){ const hs=t-(t%H); [hs,hs+H].forEach(x=>{ consider(x,3*60000,'hour'); consider(x-60000,3*60000,'hour'); }); }
  return best ? {t:best.t, snapped:best.t!==t, why:best.why} : {t, snapped:false};
}
function fmtShort(ms){
  if(ms<=0) return 'now';
  const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
  return d>0 ? `${d}d ${h}h` : h>0 ? `${h}h ${m}m` : `${m}m`;
}
const fmtDate = t => new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function toLocalInput(t){ const d=new Date(t), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
const gamesSorted = () => Object.values(state.games).sort((a,b)=>(a.created||0)-(b.created||0));
const repeatLabel = r => ({1:'Daily',7:'Weekly',14:'Every 2 wks',21:'Every 3 wks',28:'Every 4 wks',42:'Every 6 wks'}[r] || `Every ${r}d`);

/* ---------------- Render ---------------- */
const TYPES = {
  limited:{label:'Limited-time', icon:'⏳'},
  daily:  {label:'Daily', icon:'☀️'},
  weekly: {label:'Weekly', icon:'📅'},
  monthly:{label:'Monthly', icon:'🗓️'},
};
const ROUTINES=['daily','weekly','monthly'];
const typeOf = e => TYPES[e.type] ? e.type : 'limited';
const isLimitedOpen = (x)=> typeOf(x.e)==='limited' && !x.o.ended && !isDone(x.e,x.o);
const QUICK = {
  '24h': {label:'Limited-time ending within 24h', test:(x,now)=>isLimitedOpen(x)&&x.o.end-now<D},
  '3d':  {label:'Limited-time ending within 3 days', test:(x,now)=>isLimitedOpen(x)&&x.o.end-now<3*D},
  'open':{label:'To do', test:(x)=>!x.o.ended&&!isDone(x.e,x.o)},
  'done':{label:'Done', test:(x)=>!x.o.ended&&isDone(x.e,x.o)},
};
const prefGet=(k,d)=>{ try{ const v=localStorage.getItem('get.'+k); return v===null?d:JSON.parse(v); }catch(e){ return d; } };
const prefSet=(k,v)=>{ try{ localStorage.setItem('get.'+k,JSON.stringify(v)); }catch(e){} };
state.resetsOpen = prefGet('resetsOpen', true);
state.cat = 'all';

function scoped(now){
  return Object.values(state.events).filter(e=>state.filter==='all'||e.game===state.filter).map(e=>({e,o:occ(e,now)}));
}

function openCounts(now){
  const c={}, hot={};
  Object.values(state.events).forEach(e=>{ const o=occ(e,now); if(!o.ended&&!isDone(e,o)){ c[e.game]=(c[e.game]||0)+1; if(typeOf(e)==='limited'&&o.end-now<D) hot[e.game]=1; } });
  return {c,hot};
}

function renderGameSelect(){
  const gs=gamesSorted(), sel=$('fGame'), cur=sel.value;
  sel.innerHTML = gs.length ? gs.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}${g.shared&&isAdmin?' 📢':''}</option>`).join('') : '<option value="">— add a game first —</option>';
  if(cur && state.games[cur]) sel.value=cur;
  updateTypeInfo();
}

function renderTabs(){
  if(state.filter!=='all' && !state.games[state.filter]) state.filter='all';
  const gs=gamesSorted(), {c,hot}=openCounts(Date.now());
  const total=Object.values(c).reduce((a,b)=>a+b,0);
  $('tabs').innerHTML = (gs.length?
    `<button class="tab all ${state.filter==='all'?'on':''}" data-filter="all">All games <span class="n">${total}</span></button>` +
    gs.map(g=>`<button class="tab ${state.filter===g.id?'on':''}" style="--c:${esc(g.color)}" data-filter="${esc(g.id)}">
      <span class="sw"></span>${esc(g.name)}${g.shared?`<span class="shared-ic" title="${!isAdmin?'Followed from the Super Admin':g.audience==='some'?'Shared with selected people':'Shared with everyone'}">${!isAdmin?'🔗':g.audience==='some'?'👥':'📢'}</span>`:''}<span class="n ${hot[g.id]?'hot':''}" ${hot[g.id]?'title="A limited-time quest ends within 24h"':''}>${c[g.id]||0}</span>
      <span class="gear" data-editgame="${esc(g.id)}" title="Game settings">⚙</span></button>`).join('') : '') +
    `<button class="tab add" data-action="addgame">+ Add game</button>`;
}

function renderResets(){
  const now=Date.now();
  const gs=gamesSorted().filter(g=>(state.filter==='all'||g.id===state.filter)&&(nextDaily(g,now)||nextWeekly(g,now)));
  if(!gs.length){ $('resets').innerHTML=''; return; }
  const cards = gs.map(g=>{
    const dl=nextDaily(g,now), wk=nextWeekly(g,now);
    const hasMo=Object.values(state.events).some(e=>e.game===g.id&&e.type==='monthly');
    const mo=hasMo?nextMonthly(resetCfg(g),now):null;
    const dq=Object.values(state.events).filter(e=>e.game===g.id&&typeOf(e)==='daily');
    let badge='';
    if(dq.length){
      const done=dq.filter(e=>isDone(e,occ(e,now))).length, all=done===dq.length;
      badge=`<span class="daily ${all?'on':''}" title="Daily quests done">${all?'✓ ':''}${done}/${dq.length}</span>`;
    }else if(dl){
      const done=g.dailyDoneFor===dl;
      badge=`<button class="daily ${done?'on':''}" data-daily="${esc(g.id)}" title="Tick when you've done today's dailies">${done?'Dailies ✓':'Dailies'}</button>`;
    }
    return `<div class="reset" style="--c:${esc(g.color)}">
      <div class="rn"><span class="sw"></span><span class="rname">${esc(g.name)}</span>${badge}</div>
      ${[['Daily',dl],['Weekly',wk],['Monthly',mo]].filter(r=>r[1]).map(([l,t])=>`<div class="rl"><span>${l}</span><b data-t="${t}" data-fmt="${t-now<D?'':'s'}">${t-now<D?fmtLeft(t-now):fmtShort(t-now)}</b></div>`).join('')}
    </div>`;}).join('');
  $('resets').innerHTML = `<button class="section toggle-sec" data-collapse="resets" aria-expanded="${state.resetsOpen}">
      <span class="caret">${state.resetsOpen?'▾':'▸'}</span> Resets</button>
    ${state.resetsOpen?`<div class="resets">${cards}</div>`:''}`;
}

/* Big card for limited-time quests */
function evHtml(e,now){
  const g=state.games[e.game]||{name:'Unknown game',color:'#8b91a7'};
  const o=occ(e,now), left=o.end-now, done=isDone(e,o), u=urgency(left);
  const total=o.end-o.start, pct=total>0?Math.max(0,Math.min(100,(1-left/total)*100)):100;
  const cls=['ev',done?'done':'',o.ended?'ended':'',(!done&&!o.ended&&u==='red')?'soon':''].join(' ');
  const extra=progressHtml(e,o) + (e.note?`<div class="note">${esc(e.note)}</div>`:'');
  return `<div class="${cls}" style="--c:${esc(g.color)}">
    <button class="chk ${done?'on':''}" data-toggle="${esc(e.id)}" title="${done?'Mark as not done':'Mark as done'}">${done?'✓':''}</button>
    <div class="body">
      <div class="t"><span class="nm">${esc(e.name)}</span>${privTag(e)}
        ${e.prio==='must'?'<span class="tag must">🔥 Must-do</span>':''}${e.prio==='low'?'<span class="tag low">Low</span>':''}
        ${+e.repeat?`<span class="tag rep">↻ ${repeatLabel(+e.repeat)}</span>`:''}</div>
      <div class="meta"><span class="gname">${esc(g.name)}</span><span>${o.ended?'Ended':'Ends'} ${esc(fmtDate(o.end))}</span></div>
      ${extra}
    </div>
    <div class="right">
      <span class="cd ${done?'gray':u}" ${done?'':`data-t="${o.end}"`}>${done&&!o.ended?'Done ✓':fmtLeft(left)}</span>
      ${actsHtml(e)}
    </div>
    ${!o.ended&&!done?`<i class="tbar" style="width:${pct.toFixed(1)}%" title="Time passed"></i>`:''}
  </div>`;
}

function progressHtml(e,o){
  const goal=+e.goal||0, cnt=getCount(e,o), checks=getChecks(e,o), list=e.checklist||[];
  let h='';
  if(goal>0) h+=`<div class="counter"><button data-cnt="${esc(e.id)}" data-d="-1" aria-label="Minus one">−</button><b>${cnt}/${goal}</b><button data-cnt="${esc(e.id)}" data-d="1" aria-label="Plus one">+</button><span class="pbar"><i style="width:${Math.round(cnt/goal*100)}%"></i></span></div>`;
  if(list.length) h+=`<div class="cl">${list.map((t,i)=>{const on=checks.includes(i);return `<label class="${on?'ck':''}"><input type="checkbox" data-chk="${esc(e.id)}" data-i="${i}" ${on?'checked':''}><span>${esc(t)}</span></label>`;}).join('')}</div>`;
  return h;
}

/* Compact row for daily / weekly quests */
function rowHtml(x,showGame,showWhen){
  const e=x.e, o=x.o, g=state.games[e.game]||{name:'?',color:'#8b91a7'}, done=isDone(e,o);
  const extra=progressHtml(e,o)+(e.note?`<div class="note">${esc(e.note)}</div>`:'');
  return `<div class="qrow ${done?'done':''}" style="--c:${esc(g.color)}">
    <button class="chk sm ${done?'on':''}" data-toggle="${esc(e.id)}" title="${done?'Mark as not done':'Mark as done'}">${done?'✓':''}</button>
    <div class="body">
      <div class="t"><span class="nm">${esc(e.name)}</span>${privTag(e)}${showGame?`<span class="gpill"><span class="sw"></span>${esc(g.name)}</span>`:''}</div>
      ${extra}
    </div>
    <div class="rright">
      ${showWhen?timeChip(o.end, done, typeOf(e)):''}
      ${actsHtml(e)}
    </div>
  </div>`;
}

function privTag(e){
  const g=state.games[e.game];
  return isAdmin && e.private && g && g.shared ? '<span class="tag priv" title="Not shared with followers">🔒 Only me</span>' : '';
}
function actsHtml(e){
  if(!canEdit(e)) return `<div class="acts"><button class="del" data-del="${esc(e.id)}" title="Hide for me" aria-label="Hide for me">🙈</button></div>`;
  return `<div class="acts"><button data-edit="${esc(e.id)}" title="Edit" aria-label="Edit">✎</button><button class="del" data-del="${esc(e.id)}" title="Delete" aria-label="Delete">🗑</button></div>`;
}
// Readable countdown chip, coloured by how soon it is
// Daily timers are always under 24h, so they only warn in the last few hours
function chipUrgency(left,kind){
  if(kind==='daily') return left<2*H?'red':left<6*H?'amber':'plain';
  return urgency(left);
}
function timeChip(t, muted, kind){
  const left=t-Date.now(), u=muted?'gray':chipUrgency(left,kind), short=left>=D;
  return `<span class="tchip ${u}" title="Resets ${esc(fmtDate(t))}">⟳ <b data-t="${t}" data-fmt="${short?'s':''}" data-chip="${kind||'x'}">${short?fmtShort(left):fmtLeft(left)}</b></span>`;
}

function routinePanel(type,rows,now,wide){
  const t=TYPES[type];
  const sorted=[...rows].sort((a,b)=>(isDone(a.e,a.o)-isDone(b.e,b.o)) || (a.e.created||0)-(b.e.created||0));
  const done=rows.filter(x=>isDone(x.e,x.o)).length;
  const ends=[...new Set(rows.map(x=>x.o.end))];
  const showGame = state.filter==='all';
  const mixed = ends.length>1;
  const when = !mixed ? `<span class="pwhen-l">Resets in</span> ${timeChip(ends[0],false,type)}` : `<span class="pwhen-l">Each quest has its own reset</span>`;
  const body = rows.length ? sorted.map(x=>rowHtml(x,showGame,mixed)).join('')
    : `<div class="panel-empty">No ${t.label.toLowerCase()} quests yet. <button class="linkbtn" data-action="newevent" data-type="${type}">+ Add one</button></div>`;
  return `<div class="panel ${wide?'wide':''}">
    <div class="panel-head">
      <div><span class="ptitle">${t.icon} ${t.label}</span>${rows.length?`<span class="pcount ${done===rows.length?'all':''}">${done}/${rows.length} done</span>`:''}</div>
      <div class="pwhen">${rows.length?when:''}</div>
    </div>
    ${rows.length?`<div class="pbar wide"><i style="width:${Math.round(done/rows.length*100)}%"></i></div>`:''}
    <div class="rows">${body}</div>
    ${rows.length?`<button class="linkbtn addrow" data-action="newevent" data-type="${type}">+ Add ${t.label.toLowerCase()} quest</button>`:''}
  </div>`;
}

function emptyState(){
  const hasGames=gamesSorted().length, hasQuests=Object.keys(state.events).length;
  const step=(n,txt,st)=>`<span class="${st}"><i>${st==='ok'?'✓':n}</i>${txt}</span>`;
  if(!hasGames) return `<div class="empty"><div class="emoji">🎮</div><h3>Welcome! Let's set up your games</h3>
    <p>${sharingOn&&sharedAvailable().length?'Follow a shared game to get its quests ready-made, or add your own.':'Add the games you play, then add their quests.'}</p>
    <div class="steps">${step(1,'Add a game','cur')}${step(2,'Add quests','')}${step(3,'Never miss one','')}</div>
    <button class="btn" data-action="addgame">${sharingOn&&sharedAvailable().length?'+ Follow or add a game':'+ Add your first game'}</button></div>`;
  if(!hasQuests) return `<div class="empty"><div class="emoji">📜</div><h3>Now add a quest</h3>
    <p>Track limited-time events, or your daily and weekly routines.</p>
    <div class="steps">${step(1,'Add a game','ok')}${step(2,'Add quests','cur')}${step(3,'Never miss one','')}</div>
    <button class="btn" data-action="newevent">+ New quest</button></div>`;
  return '';
}

function renderCats(now){
  const ev=scoped(now), n=t=>ev.filter(x=>typeOf(x.e)===t&&!x.o.ended&&!isDone(x.e,x.o)).length;
  const items=[['all','All',null],['limited','<span class="ic">⏳</span> Limited',n('limited')],['daily','<span class="ic">☀️</span> Daily',n('daily')],['weekly','<span class="ic">📅</span> Weekly',n('weekly')],['monthly','<span class="ic">🗓️</span> Monthly',n('monthly')]];
  $('cats').innerHTML=items.map(([k,l,c])=>`<button class="${state.cat===k?'on':''}" data-cat="${k}">${l}${c?` <span class="n">${c}</span>`:''}</button>`).join('');
}

function renderList(){
  const now=Date.now(), evs=scoped(now);
  const byEnd=(a,b)=>a.o.end-b.o.end, draw=arr=>arr.map(x=>evHtml(x.e,now)).join('');
  renderCats(now);
  $('clearEnded').hidden=!Object.values(state.events).some(e=>occ(e,now).ended);

  if(state.quick){
    const q=QUICK[state.quick], rows=evs.filter(x=>q.test(x,now)).sort(byEnd);
    $('quickInfo').innerHTML=`Showing <b>${q.label}</b> <button class="chip" data-quick="${state.quick}">✕ Clear</button>`;
    $('quickInfo').hidden=false; $('cats').hidden=true; $('showDoneWrap').hidden=true;
    $('list').innerHTML = rows.length ? draw(rows) : `<div class="empty"><p style="margin:0">Nothing here.</p></div>`;
    return;
  }
  $('quickInfo').hidden=true; $('cats').hidden=false;

  const empty=emptyState();
  if(empty){ $('list').innerHTML=empty; $('showDoneWrap').hidden=true; return; }

  const lim=evs.filter(x=>typeOf(x.e)==='limited');
  const byType={}; ROUTINES.forEach(t=>byType[t]=evs.filter(x=>typeOf(x.e)===t));
  const showLim = state.cat==='all'||state.cat==='limited';
  $('showDoneWrap').hidden=!showLim;

  let html='';
  if(state.cat==='all'){
    const used=ROUTINES.filter(t=>byType[t].length);
    if(used.length) html+=`<div class="panels n${used.length}">${used.map(t=>routinePanel(t,byType[t],now)).join('')}</div>`;
  }
  if(ROUTINES.includes(state.cat)) html+=routinePanel(state.cat,byType[state.cat],now,true);

  if(showLim){
    const open=lim.filter(x=>!x.o.ended&&!isDone(x.e,x.o)).sort(byEnd);
    const must=open.filter(x=>x.e.prio==='must'), rest=open.filter(x=>x.e.prio!=='must');
    const doneOpen=lim.filter(x=>!x.o.ended&&isDone(x.e,x.o)).sort(byEnd);
    const ended=lim.filter(x=>x.o.ended).sort((a,b)=>b.o.end-a.o.end);
    html+=`<div class="sec-head"><span class="section">⏳ Limited-time</span><button class="linkbtn" data-action="newevent" data-type="limited">+ Add</button></div>`;
    if(!open.length){
      const gname=state.filter!=='all'&&state.games[state.filter]?state.games[state.filter].name:null;
      html+=`<div class="empty slim"><span>✅ No limited-time quests left${gname?` in ${esc(gname)}`:''}.</span> <button class="linkbtn" data-action="newevent" data-type="limited">+ Add one</button></div>`;
    }else{
      if(must.length) html+=`<div class="sub">🔥 Must-do</div>${draw(must)}${rest.length?`<div class="sub">Others</div>`:''}`;
      html+=draw(rest);
    }
    if(state.showDone){
      if(doneOpen.length) html+=`<div class="sub">Done (still running)</div>${draw(doneOpen)}`;
      if(ended.length) html+=`<div class="sub">Ended</div>${draw(ended)}`;
    }else if(doneOpen.length||ended.length){
      html+=`<div class="hint center">${doneOpen.length} done · ${ended.length} ended (hidden)</div>`;
    }
  }
  $('list').innerHTML=html;
}

function renderStats(){
  const now=Date.now(), all=scoped(now);
  $('sToday').textContent=all.filter(x=>QUICK['24h'].test(x,now)).length;
  $('sWeek').textContent=all.filter(x=>QUICK['3d'].test(x,now)).length;
  $('sActive').textContent=all.filter(x=>QUICK.open.test(x,now)).length;
  $('sDone').textContent=all.filter(x=>QUICK.done.test(x,now)).length;
  document.querySelectorAll('.stat').forEach(b=>b.classList.toggle('on',b.dataset.quick===state.quick));
}

function renderAll(){ renderGameSelect(); renderTabs(); renderResets(); renderList(); renderStats(); }

function tick(){
  const now=Date.now(); let crossed=false;
  document.querySelectorAll('[data-t]').forEach(el=>{
    const left=+el.dataset.t-now;
    if(left<=0){ crossed=true; return; }
    if(el.dataset.fmt==='s' && left<D) el.dataset.fmt='';
    el.textContent = el.dataset.fmt==='s' ? fmtShort(left) : fmtLeft(left);
    if(el.dataset.chip && !el.parentNode.classList.contains('gray')) el.parentNode.className='tchip '+chipUrgency(left,el.dataset.chip);
    if(el.classList.contains('cd')) el.className='cd '+urgency(left);
  });
  if(crossed) renderAll();
}

/* ---------------- Modals & menu ---------------- */
const openModal = id => { $(id).classList.add('show'); };
const closeModal = id => { $(id).classList.remove('show'); };
function closeMenu(){ $('menu').hidden=true; }
$('menuBtn').onclick=e=>{ e.stopPropagation(); $('menu').hidden=!$('menu').hidden; };
document.addEventListener('click',e=>{ if(!e.target.closest('.menu-wrap')) closeMenu(); });
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('mousedown',e=>{ if(e.target===m && m.id!=='confirm') m.classList.remove('show'); }));

/* ---------------- Quest form ---------------- */
function setMode(m){
  state.mode=m;
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  $('modeLeft').hidden=m!=='left'; $('modeDate').hidden=m!=='date';
}
function setPrio(p){ state.prio=p; document.querySelectorAll('#prioSeg button').forEach(b=>b.classList.toggle('on',b.dataset.p===p)); }
const PLACEHOLDER={limited:'e.g. Halloween Gacha Banner', daily:'e.g. Daily commissions', weekly:'e.g. Weekly boss', monthly:'e.g. Monthly shop'};
const ordinal=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:n%10]||'th');
function setType(t){
  state.type=t;
  document.querySelectorAll('#typeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.type===t));
  $('limitedOnly').hidden=t!=='limited'; $('repeatBlock').hidden=t!=='limited'; $('monthBlock').hidden=t!=='monthly';
  $('fName').placeholder=PLACEHOLDER[t];
  updateTypeInfo();
}
function updateTypeInfo(){
  const g=state.games[$('fGame').value];
  const sh=$('shareHint'), adminShared=!!(isAdmin&&g&&g.shared);
  $('privRow').hidden=!adminShared;
  if(g&&g.shared){
    sh.hidden=false;
    if(!isAdmin) sh.innerHTML='🔗 Followed game: this quest will be just for you.';
    else if($('fPrivate').checked) sh.innerHTML='🔒 Only you will see this quest.';
    else sh.innerHTML=g.audience==='some'
      ? `👥 Shared with ${(g.emails||[]).length} selected ${(g.emails||[]).length===1?'person':'people'}: they'll get this quest.`
      : '📢 Shared with everyone who follows this game.';
  }else sh.hidden=true;
  $('fServerTz').textContent=g?`(${fmtOffset(+g.offset||0)})`:'';
  const info=$('typeInfo');
  if(!g || state.type==='limited'){ info.hidden=true; return; }
  const gg=resetCfg(g); if(state.type==='monthly' && +$('fMonthDay').value) gg.monthlyDay=+$('fMonthDay').value;
  const now=Date.now(), hr=+gg.dailyHour, hh=`${hr%12||12}:00 ${hr<12?'AM':'PM'}`;
  const nxt = state.type==='daily' ? nextDaily(gg,now) : state.type==='weekly' ? nextWeekly(gg,now) : nextMonthly(gg,now);
  const when = state.type==='daily' ? `every day at <b>${hh}</b>`
    : state.type==='weekly' ? `every <b>${DAYS[+gg.weeklyDay]}</b> at <b>${hh}</b>`
    : `on the <b>${ordinal(+gg.monthlyDay)}</b> of every month at <b>${hh}</b>`;
  info.innerHTML = `${TYPES[state.type].icon} Resets ${when} (${esc(g.name)} server time). Next reset in <b>${fmtShort(nxt-now)}</b>.`;
  info.hidden=false;
}
function setRepeatField(r){
  const std=['0','1','7','14','21','28','42'];
  if(std.includes(String(r||0))){ $('fRepeat').value=String(r||0); $('customRepeat').hidden=true; }
  else{ $('fRepeat').value='custom'; $('customRepeat').hidden=false; $('fRepeatDays').value=r; }
}
function resetForm(){
  state.editId=null;
  ['fName','fNote','fD','fH','fM','fEnd','fGoal','fChecklist','fRepeatDays'].forEach(id=>$(id).value='');
  $('fServer').checked=false; $('fMonthDay').value=''; $('fPrivate').checked=false; setRepeatField(0); setPrio('normal'); setMode('left'); setType('limited'); updateLeftPreview();
  $('fErr').textContent=''; $('formTitle').textContent='New quest'; $('fSubmit').textContent='Add quest';
  $('moreOpts').open=false;
}
function newEvent(type){
  if(!gamesSorted().length){ toast('Add a game first.'); return openGame(null); }
  fillMonthDay(); resetForm();
  const pick = state.filter!=='all' ? state.filter : state.lastGame;
  if(pick && state.games[pick]) $('fGame').value=pick;
  fillMonthDay();
  setType(TYPES[type]?type:(state.cat!=='all'?state.cat:'limited'));
  openModal('eventModal'); setTimeout(()=>{ if(!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) $('fName').focus(); },50);
}
function startEdit(id){
  const e=state.events[id]; if(!e) return;
  fillMonthDay(); resetForm();
  const o=occ(e,Date.now());
  state.editId=id;
  $('fGame').value=e.game; fillMonthDay(); $('fName').value=e.name; $('fNote').value=e.note||'';
  $('fGoal').value=+e.goal||''; $('fChecklist').value=(e.checklist||[]).join('\n');
  setRepeatField(+e.repeat||0); setPrio(e.prio||'normal');
  setMode('date'); $('fEnd').value=toLocalInput(o.end);
  $('fMonthDay').value=+e.monthDay?String(e.monthDay):'';
  $('fPrivate').checked=!!e.private;
  setType(typeOf(e));
  $('moreOpts').open = !!(+e.repeat||+e.goal||(e.checklist||[]).length||e.note);
  $('formTitle').textContent='Edit quest'; $('fSubmit').textContent='Save changes';
  openModal('eventModal');
}

$('modeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setMode(b.dataset.m); });
$('prioSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setPrio(b.dataset.p); });
$('typeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setType(b.dataset.type); });
$('fGame').addEventListener('change',()=>{ updateTypeInfo(); updateLeftPreview(); fillMonthDay(); });
$('fMonthDay').addEventListener('change',updateTypeInfo);
$('fPrivate').addEventListener('change',updateTypeInfo);
function fillMonthDay(){
  const sel=$('fMonthDay'), cur=sel.value, g=state.games[$('fGame').value];
  let h=`<option value="">Game default (${ordinal(resetCfg(g).monthlyDay)})</option>`;
  for(let i=1;i<=31;i++) h+=`<option value="${i}">${ordinal(i)} of the month</option>`;
  sel.innerHTML=h; sel.value=cur;
}
function updateLeftPreview(){
  const ms=(((+$('fD').value||0)*24+(+$('fH').value||0))*60+(+$('fM').value||0))*60000, el=$('leftPreview');
  if(ms<=0){ el.innerHTML='Copy the countdown the game shows you.'; return; }
  const r=snapEnd(Date.now()+ms, state.games[$('fGame').value]);
  el.innerHTML=`Ends <b>${esc(fmtDate(r.t))}</b>`+(r.snapped?` <span class="snap">✓ adjusted to the ${r.why==='reset'?'game\'s reset time':'exact hour'}</span>`:'');
}
['fD','fH','fM'].forEach(id=>$(id).addEventListener('input',updateLeftPreview));
$('fRepeat').addEventListener('change',()=>{ $('customRepeat').hidden=$('fRepeat').value!=='custom'; });
$('newEventBtn').onclick=()=>newEvent();
$('fab').onclick=()=>newEvent();

$('evForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!store) return toast('Still loading…');
  const err=m=>{ $('fErr').textContent=m; };
  const game=$('fGame').value, name=$('fName').value.trim(), type=state.type;
  if(!game) return err('Add a game first.');
  if(!name) return err('Give the quest a name.');
  let end, repeat=0;
  if(type==='limited'){
    if(state.mode==='left'){
      const ms=(((+$('fD').value||0)*24+(+$('fH').value||0))*60+(+$('fM').value||0))*60000;
      if(ms<=0) return err('Enter how much time is left.');
      end=snapEnd(Date.now()+ms, state.games[game]).t;
    }else{
      const v=$('fEnd').value; if(!v) return err('Pick the end date and time.');
      if($('fServer').checked){
        const [d,t]=v.split('T'), [y,mo,da]=d.split('-').map(Number), [hh,mm]=t.split(':').map(Number);
        end=Date.UTC(y,mo-1,da,hh,mm)-(+state.games[game].offset||0)*H;
      }else end=new Date(v).getTime();
      if(isNaN(end)) return err('That date looks invalid.');
    }
    repeat=$('fRepeat').value==='custom' ? Math.round(+$('fRepeatDays').value||0) : +$('fRepeat').value;
    if($('fRepeat').value==='custom' && repeat<1) return err('Enter how many days between repeats.');
  }else{
    const gg=resetCfg(state.games[game]);
    if(type==='monthly' && +$('fMonthDay').value) gg.monthlyDay=+$('fMonthDay').value;
    end = type==='daily' ? nextDaily(gg,Date.now()) : type==='weekly' ? nextWeekly(gg,Date.now()) : nextMonthly(gg,Date.now());
  }
  const goal=Math.max(0,Math.round(+$('fGoal').value||0));
  const checklist=$('fChecklist').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,30);
  const old=state.editId?state.events[state.editId]:null;
  end=Math.round(end);
  const e={
    ...(old||{}), id:old?old.id:'ev_'+uid(), type, game, name, end, repeat, goal, checklist,
    prio: type==='limited'?state.prio:'normal', note:$('fNote').value.trim(),
    monthDay: type==='monthly' ? (+$('fMonthDay').value||null) : null,
    created: old && old.created < end ? old.created : Date.now(),
  };
  if(old && JSON.stringify(old.checklist||[])!==JSON.stringify(checklist)) e.checks=[];
  const gObj=state.games[game], priv=!!(isAdmin && sharingOn && gObj && gObj.shared && $('fPrivate').checked);
  e.private=priv;
  e.shared = isAdmin && sharingOn ? !!(gObj&&gObj.shared) && !priv : false;
  if(old && !!old.shared!==e.shared){ delete state.events[old.id]; await store.deleteEvent(old.id,!!old.shared); }
  state.events[e.id]=e;
  state.lastGame=game;
  const wasEdit=!!old; closeModal('eventModal'); resetForm(); state.quick=null; renderAll();
  await store.saveEvent(e);
  toast(wasEdit?'Quest updated':'Quest added');
});

/* ---------------- Game editor ---------------- */
(function fillGameSelects(){
  let h=''; for(let o=-12;o<=14;o++) h+=`<option value="${o}">${fmtOffset(o)}</option>`;
  $('gOffset').innerHTML=h;
  h='<option value="">No daily reset</option>';
  for(let i=0;i<24;i++){ const hr=i%12||12; h+=`<option value="${i}">${hr}:00 ${i<12?'AM':'PM'}</option>`; }
  $('gDaily').innerHTML=h;
  $('gWeekly').innerHTML='<option value="">No weekly reset</option>'+DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
  h=''; for(let i=1;i<=31;i++) h+=`<option value="${i}">${ordinal(i)} of the month</option>`;
  $('gMonthly').innerHTML=h;
})();

function openGame(id){
  const g=id?state.games[id]:null;
  state.editGameId=id||null;
  const ro=!!(g && !canEdit(g));            // a follower looking at a shared game
  $('gmTitle').textContent=!g?'Add game':ro?g.name:'Edit game';
  // Follow list (Add mode only)
  const avail=(!g && sharingOn)?sharedAvailable():[];
  $('followBox').hidden=!avail.length;
  $('followList').innerHTML=avail.map(sg=>{
    const n=Object.values(raw.sQuests).filter(q=>q.game===sg.id).length;
    return `<div class="follow-row" style="--c:${esc(sg.color)}"><span class="sw"></span><span class="fname">${esc(sg.name)}</span><span class="fcount">${n} quest${n===1?'':'s'}</span><button type="button" class="btn fbtn" data-follow="${esc(sg.id)}">+ Follow</button></div>`;
  }).join('');
  // Read-only info for followers
  $('followedInfo').hidden=!ro;
  if(ro){ const hc=hiddenCount(g.id); $('unhideBtn').hidden=!hc; $('unhideBtn').textContent=`Show ${hc} hidden quest${hc===1?'':'s'} again`; }
  $('gFields').disabled=ro; $('gSave').hidden=ro; $('gCancel').textContent=ro?'Close':'Cancel';
  // Share toggle (Super Admin only)
  $('shareRow').hidden=!(isAdmin&&sharingOn);
  $('gShare').checked=!!(g&&g.shared);
  if(isAdmin&&sharingOn){
    const emails=(g&&g.emails)||[];
    const people=Object.values(raw.profiles).filter(p=>p.email&&p.email!==ADMIN_EMAIL).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));
    const known=new Set(people.map(p=>p.email));
    $('peopleList').innerHTML=people.length?people.map(p=>`<label class="person"><input type="checkbox" value="${esc(p.email)}" ${emails.includes(p.email)?'checked':''}>
      ${p.photo?`<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">`:`<span class="avatar sm">${esc((p.name||p.email).charAt(0).toUpperCase())}</span>`}
      <span><b>${esc(p.name||p.email)}</b><small>${esc(p.email)}</small></span></label>`).join('')
      :'<div class="hint" style="margin:0">No one else has signed in yet.</div>';
    $('gEmails').value=emails.filter(e=>!known.has(e)).join('\n');
    setAud((g&&g.audience)||'all');
  }
  $('audBox').hidden=!$('gShare').checked || $('shareRow').hidden;
  $('gName').value=g?g.name:'';
  $('gColor').value=g?g.color:PALETTE[Object.keys(state.games).length%PALETTE.length];
  $('gOffset').value=String(g?(+g.offset||0):Math.round(-new Date().getTimezoneOffset()/60));
  $('gDaily').value=g?(g.dailyHour??''):'4';
  $('gWeekly').value=g?(g.weeklyDay??''):'1';
  $('gMonthly').value=String(g&&g.monthlyDay!=null&&g.monthlyDay!==''?g.monthlyDay:1);
  $('gErr').textContent='';
  $('gDelete').hidden=!g;
  $('gDelete').textContent=ro?'Unfollow this game':(g&&g.shared?'Remove this shared game':'Remove this game');
  openModal('gameModal');
  if(!ro && !avail.length) setTimeout(()=>{ if(!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) $('gName').focus(); },50);
}
const closeGame=()=>closeModal('gameModal');
function setAud(a){ state.aud=a; document.querySelectorAll('#audSeg button').forEach(b=>b.classList.toggle('on',b.dataset.aud===a)); $('audSome').hidden=a!=='some'; }
$('audSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setAud(b.dataset.aud); });
$('gShare').addEventListener('change',()=>{ $('audBox').hidden=!$('gShare').checked; });
function chosenEmails(){
  const ticked=[...document.querySelectorAll('#peopleList input:checked')].map(i=>i.value);
  const typed=$('gEmails').value.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return [...new Set([...ticked,...typed])];
}
$('gForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!store) return toast('Still loading…');
  const old=state.editGameId?state.games[state.editGameId]:null;
  if(old && !canEdit(old)) return closeGame();
  const name=$('gName').value.trim();
  if(!name) return $('gErr').textContent='Enter the game name.';
  if(Object.values(state.games).some(g=>g.id!==state.editGameId&&g.name.toLowerCase()===name.toLowerCase())) return $('gErr').textContent='That game is already on the list.';
  const num=v=>v===''?null:+v;
  const g={...(old||{}), id:old?old.id:'g_'+uid(), name, color:$('gColor').value,
    offset:+$('gOffset').value, dailyHour:num($('gDaily').value), weeklyDay:num($('gWeekly').value), monthlyDay:+$('gMonthly').value,
    created:old?.created||Date.now(), shared:!!(old&&old.shared)};
  const wantShare=isAdmin&&sharingOn&&$('gShare').checked;
  if(wantShare){
    g.audience=state.aud==='some'?'some':'all';
    g.emails=g.audience==='some'?chosenEmails():[];
    if(g.audience==='some'&&!g.emails.length) return $('gErr').textContent='Pick at least one person, or choose Everyone.';
  }
  closeGame();
  if(isAdmin && sharingOn && wantShare!==g.shared){
    if(wantShare){
      state.games[g.id]={...g,shared:true}; renderAll();
      await store.shareGame(g,true); toast(`📢 “${g.name}” is now shared`);
    }else{
      ask('Stop sharing?',`Followers will no longer see “${g.name}” or its quests. You keep your copy.`,async()=>{
        state.games[g.id]={...g,shared:false}; renderAll();
        await store.shareGame({...g,shared:false},false); toast('Game is private again');
      },'Stop sharing');
    }
    return;
  }
  state.games[g.id]=g; renderAll(); if(!old) $('fGame').value=g.id; updateTypeInfo();
  toast(old?'Game updated':'Game added');
  await store.saveGame(g);
});
$('gDelete').onclick=()=>{
  const g=state.games[state.editGameId]; if(!g) return;
  const evs=Object.values(state.events).filter(e=>e.game===g.id);
  closeGame();
  if(g.shared && !isAdmin){
    const own=evs.filter(e=>!e.shared);
    ask('Unfollow game?',`“${g.name}” and its shared quests will disappear from your tracker.${own.length?` Your own ${own.length} quest(s) in it will be removed too.`:''}`,async()=>{
      for(const e of own) await store.deleteEvent(e.id,false);
      await store.unfollow(g.id); toast(`Unfollowed “${g.name}”`);
    },'Unfollow');
    return;
  }
  ask(g.shared?'Remove shared game?':'Remove game?',
    `“${g.name}”${evs.length?` and its ${evs.length} quest(s)`:''} will be removed${g.shared?' for you and everyone following it':''}.`,async()=>{
    delete state.games[g.id]; evs.forEach(e=>delete state.events[e.id]); renderAll();
    await store.deleteGame(g.id,g.shared); for(const e of evs) await store.deleteEvent(e.id,e.shared);
  });
};
$('unhideBtn').onclick=async()=>{ const id=state.editGameId; closeGame(); await store.unhide(id); toast('Hidden quests are back'); };

/* ---------------- Confirm dialog ---------------- */
let confirmFn=null;
function ask(title,msg,fn,yes='Delete'){ $('cTitle').textContent=title; $('cMsg').textContent=msg; $('cYes').textContent=yes; confirmFn=fn; $('confirm').classList.add('show'); }
$('cNo').onclick=()=>{ $('confirm').classList.remove('show'); confirmFn=null; };
$('cYes').onclick=async()=>{ $('confirm').classList.remove('show'); const f=confirmFn; confirmFn=null; if(f) await f(); };

/* ---------------- Clicks ---------------- */
async function updateEvent(id,fn){ const e=state.events[id]; if(!e) return; const n=fn({...e},occ(e,Date.now())); state.events[id]=n; renderAll(); await store.saveEvent(n); }

document.addEventListener('click',async ev=>{
  const close=ev.target.closest('[data-close]');
  if(close){ closeModal(close.dataset.close); return; }
  const t=ev.target.closest('[data-toggle],[data-edit],[data-del],[data-editgame],[data-filter],[data-daily],[data-cnt],[data-action],[data-quick],[data-cat],[data-collapse],[data-follow],#clearEnded');
  if(!t) return;
  const d=t.dataset;
  if(d.quick){ state.quick = state.quick===d.quick ? null : d.quick; renderList(); renderStats(); return; }
  if(d.cat){ state.cat=d.cat; renderList(); return; }
  if(d.collapse==='resets'){ state.resetsOpen=!state.resetsOpen; prefSet('resetsOpen',state.resetsOpen); renderResets(); return; }
  if(d.filter && !d.editgame){ state.filter=d.filter; renderTabs(); renderResets(); renderList(); renderStats(); return; }
  if(!store) return toast('Still loading…');
  if(d.follow){ const sg=raw.sGames[d.follow]; await store.follow(d.follow); toast(`🔗 Following “${sg?sg.name:'game'}”`);
    if(sharedAvailable().length) openGame(null); else closeGame(); }
  else if(d.editgame){ ev.stopPropagation(); openGame(d.editgame); }
  else if(d.action==='addgame') openGame(null);
  else if(d.action==='newevent') newEvent(d.type);
  else if(d.toggle) await updateEvent(d.toggle,(e,o)=>{ e.doneFor=isDone(e,o)?null:o.end; return e; });
  else if(d.cnt) await updateEvent(d.cnt,(e,o)=>{ e.count=Math.max(0,Math.min(+e.goal||0,getCount(e,o)+(+d.d))); e.countFor=o.end; return e; });
  else if(d.edit) startEdit(d.edit);
  else if(d.del){ const e=state.events[d.del]; if(!e) return;
    if(!canEdit(e)) ask('Hide quest?',`“${e.name}” will be hidden from your tracker. You can show it again from the game's ⚙ settings.`,async()=>{ delete state.events[e.id]; renderAll(); await store.deleteEvent(e.id,true); },'Hide');
    else ask('Delete quest?',`“${e.name}” will be removed${e.shared?' for you and everyone following this game':''}.`,async()=>{ delete state.events[e.id]; renderAll(); await store.deleteEvent(e.id,e.shared); }); }
  else if(d.daily){ const g=state.games[d.daily]; if(!g) return; const dl=nextDaily(g,Date.now());
    const n={...g, dailyDoneFor: g.dailyDoneFor===dl?null:dl}; state.games[g.id]=n; renderAll(); await store.saveGame(n); }
  else if(t.id==='clearEnded'){ const now=Date.now(), ended=Object.values(state.events).filter(e=>occ(e,now).ended);
    ask('Clear ended quests?',`${ended.length} ended quest(s) will be removed.`,async()=>{ ended.forEach(e=>delete state.events[e.id]); renderAll(); for(const e of ended) await store.deleteEvent(e.id,e.shared); }); }
});
document.addEventListener('change',async ev=>{
  const t=ev.target;
  if(t.id==='showDone'){ state.showDone=t.checked; renderList(); }
  else if(t.dataset.chk){ const i=+t.dataset.i;
    await updateEvent(t.dataset.chk,(e,o)=>{ const c=new Set(getChecks(e,o)); t.checked?c.add(i):c.delete(i); e.checks=[...c].sort((a,b)=>a-b); e.checkFor=o.end; return e; }); }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ ['eventModal','gameModal','confirm'].forEach(closeModal); closeMenu(); return; }
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(!typing && (e.key==='n'||e.key==='N') && !document.querySelector('.modal.show') && !$('app').hidden){ e.preventDefault(); newEvent(); }
});

/* ---------------- Backup ---------------- */
$('exportBtn').onclick=()=>{
  closeMenu();
  const own=o=>Object.fromEntries(Object.entries(o).filter(([k,v])=>!v.shared));
  const data=JSON.stringify({app:'game-event-tracker',version:2,exported:new Date().toISOString(),games:own(state.games),events:own(state.events)},null,2);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download=`game-events-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('importFile').addEventListener('change',async ev=>{
  closeMenu();
  const file=ev.target.files[0]; ev.target.value=''; if(!file) return;
  let d; try{ d=JSON.parse(await file.text()); }catch(e){ return toast('That file is not a valid backup.'); }
  if(!d || d.app!=='game-event-tracker' || typeof d.games!=='object' || typeof d.events!=='object') return toast('That file is not a tracker backup.');
  const gs=Object.values(d.games).map(g=>omit(g,['shared'])), es=Object.values(d.events).map(e=>omit(e,['shared']));
  ask('Import backup?',`Adds ${gs.length} game(s) and ${es.length} quest(s). Items with the same ID are replaced.`,async()=>{
    gs.forEach(g=>state.games[g.id]=g); es.forEach(e=>state.events[e.id]=e); renderAll();
    for(const g of gs) await store.saveGame(g);
    for(const e of es) await store.saveEvent(e);
    toast('Backup imported');
  },'Import');
});

/* ---------------- Start ---------------- */
setMode('left'); setType('limited');
setInterval(tick,1000);
setInterval(renderAll,60000);
(async()=>{
  if(firebaseConfig){
    try{ store=await firebaseStore(); return; }
    catch(e){ console.error(e); toast('Could not reach Firebase — using browser storage.'); }
  }
  store=localStore();
  $('app').hidden=false; $('fab').hidden=false;
  renderAll();
})();
