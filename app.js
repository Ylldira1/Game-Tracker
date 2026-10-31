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
  editId: null, editGameId: null,
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

  const api={
    saveGame:g=>fs.setDoc(fs.doc(db,'users',user.uid,'games',g.id),clean(g)).catch(fail),
    deleteGame:id=>fs.deleteDoc(fs.doc(db,'users',user.uid,'games',id)).catch(fail),
    saveEvent:e=>fs.setDoc(fs.doc(db,'users',user.uid,'events',e.id),clean(e)).catch(fail),
    deleteEvent:id=>fs.deleteDoc(fs.doc(db,'users',user.uid,'events',id)).catch(fail),
  };
  function fail(e){ console.error(e); toast('Could not save: '+(e.code||'error')); }

  onAuthStateChanged(auth,u=>{
    unsubs.forEach(f=>f()); unsubs=[];
    user=u;
    if(!u){
      state.games={}; state.events={};
      $('app').hidden=true; $('signin').hidden=false; $('userBox').innerHTML='';
      setSync('','Signed out');
      return;
    }
    $('signin').hidden=true; $('app').hidden=false;
    $('userBox').innerHTML=`${u.photoURL?`<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`:''}<span>${esc(u.displayName||u.email||'')}</span><button class="chip" id="signOutBtn">Sign out</button>`;
    $('signOutBtn').onclick=()=>signOut(auth);
    setSync('warn','Connecting…');
    const sub=(name,target)=>fs.onSnapshot(fs.collection(db,'users',u.uid,name),snap=>{
      const out={}; snap.forEach(d=>{ out[d.id]={...d.data(),id:d.id}; });
      state[target]=out;
      setSync(snap.metadata.fromCache?'warn':'ok', snap.metadata.fromCache?'Offline — will sync later':'Synced');
      renderAll();
    },err=>{ console.error(err); setSync('warn','Sync error: '+err.code); });
    unsubs.push(sub('games','games'), sub('events','events'));
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
function occ(e,now){
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
const fmtDate = t => new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function toLocalInput(t){ const d=new Date(t), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
const gamesSorted = () => Object.values(state.games).sort((a,b)=>(a.created||0)-(b.created||0));
const repeatLabel = r => ({1:'Daily',7:'Weekly',14:'Every 2 wks',21:'Every 3 wks',28:'Every 4 wks',42:'Every 6 wks'}[r] || `Every ${r}d`);

/* ---------------- Render ---------------- */
function renderGames(){
  const now=Date.now(), counts={};
  Object.values(state.events).forEach(e=>{ const o=occ(e,now); if(!o.ended&&!isDone(e,o)) counts[e.game]=(counts[e.game]||0)+1; });
  const gs=gamesSorted();
  $('gameList').innerHTML = gs.length ? gs.map(g=>`
    <div class="game" data-editgame="${esc(g.id)}" title="Edit game">
      <span class="sw" style="background:${esc(g.color)}"></span><span class="nm">${esc(g.name)}</span>
      <span class="cnt">${counts[g.id]||0} active</span><span class="cnt">✎</span>
    </div>`).join('') : '<div class="hint" style="margin:0">Add the games you play first.</div>';
  const sel=$('fGame'), cur=sel.value;
  sel.innerHTML = gs.length ? gs.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('') : '<option value="">— add a game first —</option>';
  if(cur && state.games[cur]) sel.value=cur;
  updateServerTz();
}

function renderResets(){
  const now=Date.now();
  const gs=gamesSorted().filter(g=>nextDaily(g,now)||nextWeekly(g,now));
  if(!gs.length){ $('resets').innerHTML=''; return; }
  $('resets').innerHTML = `<div class="section">Resets</div><div class="resets">` + gs.map(g=>{
    const dl=nextDaily(g,now), wk=nextWeekly(g,now), done=dl&&g.dailyDoneFor===dl;
    return `<div class="reset" style="--c:${esc(g.color)}">
      <div class="rn"><span>${esc(g.name)}</span>${dl?`<button class="daily ${done?'on':''}" data-daily="${esc(g.id)}">${done?'Dailies ✓':'Dailies'}</button>`:''}</div>
      ${dl?`<div class="rl"><span>Daily</span><b data-t="${dl}">${fmtLeft(dl-now)}</b></div>`:''}
      ${wk?`<div class="rl"><span>Weekly</span><b data-t="${wk}">${fmtLeft(wk-now)}</b></div>`:''}
    </div>`;}).join('') + `</div>`;
}

function renderToolbar(){
  if(state.filter!=='all' && !state.games[state.filter]) state.filter='all';
  const now=Date.now(), anyEnded=Object.values(state.events).some(e=>occ(e,now).ended);
  $('toolbar').innerHTML =
    `<button class="chip ${state.filter==='all'?'on':''}" data-filter="all">All games</button>` +
    gamesSorted().map(g=>`<button class="chip ${state.filter===g.id?'on':''}" data-filter="${esc(g.id)}"><span class="sw" style="background:${esc(g.color)}"></span>${esc(g.name)}</button>`).join('') +
    `<span class="spacer"></span><label class="toggle"><input type="checkbox" id="showDone" ${state.showDone?'checked':''}> Show done & ended</label>` +
    (anyEnded?`<button class="chip" id="clearEnded">Clear ended</button>`:'');
}

function evHtml(e,now){
  const g=state.games[e.game]||{name:'Unknown game',color:'#8b91a7'};
  const o=occ(e,now), left=o.end-now, done=isDone(e,o), u=urgency(left);
  const total=o.end-o.start, pct=total>0?Math.max(0,Math.min(100,(1-left/total)*100)):100;
  const cls=['ev',done?'done':'',o.ended?'ended':'',(!done&&!o.ended&&u==='red')?'soon':''].join(' ');
  const goal=+e.goal||0, cnt=getCount(e,o), checks=getChecks(e,o), list=e.checklist||[];
  let extra='';
  if(goal>0) extra+=`<div class="counter"><button data-cnt="${esc(e.id)}" data-d="-1">−</button><b>${cnt}/${goal}</b><button data-cnt="${esc(e.id)}" data-d="1">+</button><span class="pbar"><i style="width:${Math.round(cnt/goal*100)}%"></i></span></div>`;
  if(list.length) extra+=`<div class="cl">${list.map((t,i)=>{const on=checks.includes(i);return `<label class="${on?'ck':''}"><input type="checkbox" data-chk="${esc(e.id)}" data-i="${i}" ${on?'checked':''}><span>${esc(t)}</span></label>`;}).join('')}</div>`;
  if(e.note) extra+=`<div class="note">${esc(e.note)}</div>`;
  if(!o.ended&&!done) extra+=`<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  return `<div class="${cls}" style="--c:${esc(g.color)}">
    <button class="chk ${done?'on':''}" data-toggle="${esc(e.id)}" title="Mark done">${done?'✓':''}</button>
    <div>
      <div class="t"><span class="nm">${esc(e.name)}</span>
        ${e.prio==='must'?'<span class="tag must">Must-do</span>':''}${e.prio==='low'?'<span class="tag low">Low</span>':''}
        ${+e.repeat?`<span class="tag rep">↻ ${repeatLabel(+e.repeat)}</span>`:''}</div>
      <div class="meta"><span class="gname">${esc(g.name)}</span><span>${o.ended?'Ended':'Ends'} ${esc(fmtDate(o.end))}</span></div>
    </div>
    <div class="right">
      <span class="cd ${done?'gray':u}" ${done?'':`data-t="${o.end}"`}>${done&&!o.ended?'Done ✓':fmtLeft(left)}</span>
      <div class="acts"><button data-edit="${esc(e.id)}">Edit</button><button class="del" data-del="${esc(e.id)}">Delete</button></div>
    </div>
    ${extra?`<div class="extra">${extra}</div>`:''}
  </div>`;
}

function renderList(){
  const now=Date.now();
  const evs=Object.values(state.events).filter(e=>state.filter==='all'||e.game===state.filter).map(e=>({e,o:occ(e,now)}));
  const byEnd=(a,b)=>a.o.end-b.o.end;
  const open=evs.filter(x=>!x.o.ended&&!isDone(x.e,x.o)).sort(byEnd);
  const must=open.filter(x=>x.e.prio==='must'), rest=open.filter(x=>x.e.prio!=='must');
  const doneOpen=evs.filter(x=>!x.o.ended&&isDone(x.e,x.o)).sort(byEnd);
  const ended=evs.filter(x=>x.o.ended).sort((a,b)=>b.o.end-a.o.end);
  const draw=arr=>arr.map(x=>evHtml(x.e,now)).join('');
  let html='';
  if(!open.length) html+=`<div class="empty">${gamesSorted().length?'Nothing left to do. Add an event on the left.':'Start by adding your games, then add their events.'}</div>`;
  else if(must.length) html+=`<div class="section">🔥 Must-do</div>${draw(must)}${rest.length?`<div class="section">Other events</div>${draw(rest)}`:''}`;
  else html+=`<div class="section">Events</div>${draw(rest)}`;
  if(state.showDone){
    if(doneOpen.length) html+=`<div class="section">Done (still running)</div>${draw(doneOpen)}`;
    if(ended.length) html+=`<div class="section">Ended</div>${draw(ended)}`;
  }else if(doneOpen.length||ended.length){
    html+=`<div class="hint" style="text-align:center;margin-top:10px">${doneOpen.length} done · ${ended.length} ended — tick “Show done & ended” to see them.</div>`;
  }
  $('list').innerHTML=html;
}

function renderStats(){
  const now=Date.now(), all=Object.values(state.events).map(e=>({e,o:occ(e,now)}));
  const open=all.filter(x=>!x.o.ended&&!isDone(x.e,x.o));
  $('sToday').textContent=open.filter(x=>x.o.end-now<D).length;
  $('sWeek').textContent=open.filter(x=>x.o.end-now<3*D).length;
  $('sActive').textContent=open.length;
  $('sDone').textContent=all.filter(x=>!x.o.ended&&isDone(x.e,x.o)).length;
}

function renderAll(){ renderGames(); renderResets(); renderToolbar(); renderList(); renderStats(); }

function tick(){
  const now=Date.now(); let crossed=false;
  document.querySelectorAll('[data-t]').forEach(el=>{
    const left=+el.dataset.t-now;
    if(left<=0){ crossed=true; return; }
    el.textContent=fmtLeft(left);
    if(el.classList.contains('cd')) el.className='cd '+urgency(left);
  });
  if(crossed) renderAll();
}

/* ---------------- Event form ---------------- */
function setMode(m){
  state.mode=m;
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  $('modeLeft').hidden=m!=='left'; $('modeDate').hidden=m!=='date';
}
function setPrio(p){ state.prio=p; document.querySelectorAll('#prioSeg button').forEach(b=>b.classList.toggle('on',b.dataset.p===p)); }
function updateServerTz(){ const g=state.games[$('fGame').value]; $('fServerTz').textContent=g?`(${fmtOffset(+g.offset||0)})`:''; }
function setRepeatField(r){
  const std=['0','1','7','14','21','28','42'];
  if(std.includes(String(r||0))){ $('fRepeat').value=String(r||0); $('customRepeat').hidden=true; }
  else{ $('fRepeat').value='custom'; $('customRepeat').hidden=false; $('fRepeatDays').value=r; }
}
function resetForm(){
  state.editId=null;
  ['fName','fNote','fD','fH','fM','fEnd','fGoal','fChecklist','fRepeatDays'].forEach(id=>$(id).value='');
  $('fServer').checked=false; setRepeatField(0); setPrio('normal'); setMode('left');
  $('fErr').textContent=''; $('formTitle').textContent='Add event'; $('fSubmit').textContent='Add event'; $('fCancel').hidden=true;
  $('moreOpts').open=false;
}
function startEdit(id){
  const e=state.events[id]; if(!e) return;
  const o=occ(e,Date.now());
  state.editId=id;
  $('fGame').value=e.game; $('fName').value=e.name; $('fNote').value=e.note||'';
  $('fGoal').value=+e.goal||''; $('fChecklist').value=(e.checklist||[]).join('\n');
  setRepeatField(+e.repeat||0); setPrio(e.prio||'normal');
  setMode('date'); $('fEnd').value=toLocalInput(o.end); $('fServer').checked=false; updateServerTz();
  $('moreOpts').open = !!(+e.repeat||+e.goal||(e.checklist||[]).length||e.note);
  $('formTitle').textContent='Edit event'; $('fSubmit').textContent='Save changes'; $('fCancel').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'}); $('fName').focus();
}

$('modeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setMode(b.dataset.m); });
$('prioSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setPrio(b.dataset.p); });
$('fGame').addEventListener('change',updateServerTz);
$('fRepeat').addEventListener('change',()=>{ $('customRepeat').hidden=$('fRepeat').value!=='custom'; });
$('fCancel').addEventListener('click',resetForm);

$('evForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!store) return toast('Still loading…');
  const err=m=>{ $('fErr').textContent=m; };
  const game=$('fGame').value, name=$('fName').value.trim();
  if(!game) return err('Add a game first.');
  if(!name) return err('Give the event a name.');
  let end;
  if(state.mode==='left'){
    const ms=(((+$('fD').value||0)*24+(+$('fH').value||0))*60+(+$('fM').value||0))*60000;
    if(ms<=0) return err('Enter how much time is left.');
    end=Date.now()+ms;
  }else{
    const v=$('fEnd').value; if(!v) return err('Pick the end date and time.');
    if($('fServer').checked){
      const [d,t]=v.split('T'), [y,mo,da]=d.split('-').map(Number), [hh,mm]=t.split(':').map(Number);
      end=Date.UTC(y,mo-1,da,hh,mm)-(+state.games[game].offset||0)*H;
    }else end=new Date(v).getTime();
    if(isNaN(end)) return err('That date looks invalid.');
  }
  let repeat=$('fRepeat').value==='custom' ? Math.round(+$('fRepeatDays').value||0) : +$('fRepeat').value;
  if($('fRepeat').value==='custom' && repeat<1) return err('Enter how many days between repeats.');
  const goal=Math.max(0,Math.round(+$('fGoal').value||0));
  const checklist=$('fChecklist').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,30);
  const old=state.editId?state.events[state.editId]:null;
  end=Math.round(end);
  const e={
    ...(old||{}), id:old?old.id:'ev_'+uid(), game, name, end, repeat, goal, checklist,
    prio:state.prio, note:$('fNote').value.trim(),
    created: old && old.created < end ? old.created : Date.now(),
  };
  if(old && JSON.stringify(old.checklist||[])!==JSON.stringify(checklist)) e.checks=[];
  state.events[e.id]=e;
  const wasEdit=!!old; resetForm(); $('fGame').value=game; renderAll();
  await store.saveEvent(e);
  toast(wasEdit?'Event updated':'Event added');
});

/* ---------------- Game editor ---------------- */
(function fillGameSelects(){
  let h=''; for(let o=-12;o<=14;o++) h+=`<option value="${o}">${fmtOffset(o)}</option>`;
  $('gOffset').innerHTML=h;
  h='<option value="">No daily reset</option>';
  for(let i=0;i<24;i++){ const hr=i%12||12; h+=`<option value="${i}">${hr}:00 ${i<12?'AM':'PM'}</option>`; }
  $('gDaily').innerHTML=h;
  $('gWeekly').innerHTML='<option value="">No weekly reset</option>'+DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
})();

function openGame(id){
  const g=id?state.games[id]:null;
  state.editGameId=id||null;
  $('gmTitle').textContent=g?'Edit game':'Add game';
  $('gName').value=g?g.name:'';
  $('gColor').value=g?g.color:PALETTE[Object.keys(state.games).length%PALETTE.length];
  $('gOffset').value=String(g?(+g.offset||0):Math.round(-new Date().getTimezoneOffset()/60));
  $('gDaily').value=g?(g.dailyHour??''):'4';
  $('gWeekly').value=g?(g.weeklyDay??''):'1';
  $('gErr').textContent=''; $('gDelete').hidden=!g;
  $('gameModal').classList.add('show'); $('gName').focus();
}
const closeGame=()=>$('gameModal').classList.remove('show');
$('addGameBtn').onclick=()=>openGame(null);
$('gCancel').onclick=closeGame;
$('gForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!store) return toast('Still loading…');
  const name=$('gName').value.trim();
  if(!name) return $('gErr').textContent='Enter the game name.';
  if(Object.values(state.games).some(g=>g.id!==state.editGameId&&g.name.toLowerCase()===name.toLowerCase())) return $('gErr').textContent='That game is already on the list.';
  const old=state.editGameId?state.games[state.editGameId]:null;
  const num=v=>v===''?null:+v;
  const g={...(old||{}), id:old?old.id:'g_'+uid(), name, color:$('gColor').value,
    offset:+$('gOffset').value, dailyHour:num($('gDaily').value), weeklyDay:num($('gWeekly').value),
    created:old?.created||Date.now()};
  state.games[g.id]=g; closeGame(); renderAll(); if(!old) $('fGame').value=g.id; updateServerTz();
  await store.saveGame(g);
});
$('gDelete').onclick=()=>{
  const g=state.games[state.editGameId]; if(!g) return;
  const evs=Object.values(state.events).filter(e=>e.game===g.id);
  closeGame();
  ask('Remove game?',`“${g.name}”${evs.length?` and its ${evs.length} event(s)`:''} will be removed.`,async()=>{
    delete state.games[g.id]; evs.forEach(e=>delete state.events[e.id]); renderAll();
    await store.deleteGame(g.id); for(const e of evs) await store.deleteEvent(e.id);
  });
};

/* ---------------- Confirm dialog ---------------- */
let confirmFn=null;
function ask(title,msg,fn,yes='Delete'){ $('cTitle').textContent=title; $('cMsg').textContent=msg; $('cYes').textContent=yes; confirmFn=fn; $('confirm').classList.add('show'); }
$('cNo').onclick=()=>{ $('confirm').classList.remove('show'); confirmFn=null; };
$('cYes').onclick=async()=>{ $('confirm').classList.remove('show'); const f=confirmFn; confirmFn=null; if(f) await f(); };

/* ---------------- Clicks on the list ---------------- */
async function updateEvent(id,fn){ const e=state.events[id]; if(!e) return; const n=fn({...e},occ(e,Date.now())); state.events[id]=n; renderAll(); await store.saveEvent(n); }

document.addEventListener('click',async ev=>{
  const t=ev.target.closest('[data-toggle],[data-edit],[data-del],[data-filter],[data-editgame],[data-daily],[data-cnt],#clearEnded');
  if(!t) return;
  if(!store && !t.dataset.filter) return toast('Still loading…');
  const d=t.dataset;
  if(d.toggle) await updateEvent(d.toggle,(e,o)=>{ e.doneFor=isDone(e,o)?null:o.end; return e; });
  else if(d.cnt) await updateEvent(d.cnt,(e,o)=>{ e.count=Math.max(0,Math.min(+e.goal||0,getCount(e,o)+(+d.d))); e.countFor=o.end; return e; });
  else if(d.edit) startEdit(d.edit);
  else if(d.del){ const e=state.events[d.del]; if(!e) return;
    ask('Delete event?',`“${e.name}” will be removed.`,async()=>{ delete state.events[e.id]; if(state.editId===e.id) resetForm(); renderAll(); await store.deleteEvent(e.id); }); }
  else if(d.filter){ state.filter=d.filter; renderToolbar(); renderList(); }
  else if(d.editgame) openGame(d.editgame);
  else if(d.daily){ const g=state.games[d.daily]; if(!g) return; const dl=nextDaily(g,Date.now());
    const n={...g, dailyDoneFor: g.dailyDoneFor===dl?null:dl}; state.games[g.id]=n; renderAll(); await store.saveGame(n); }
  else if(t.id==='clearEnded'){ const now=Date.now(), ended=Object.values(state.events).filter(e=>occ(e,now).ended);
    ask('Clear ended events?',`${ended.length} ended event(s) will be removed.`,async()=>{ ended.forEach(e=>delete state.events[e.id]); renderAll(); for(const e of ended) await store.deleteEvent(e.id); }); }
});
document.addEventListener('change',async ev=>{
  const t=ev.target;
  if(t.id==='showDone'){ state.showDone=t.checked; renderList(); }
  else if(t.dataset.chk){ const i=+t.dataset.i;
    await updateEvent(t.dataset.chk,(e,o)=>{ const c=new Set(getChecks(e,o)); t.checked?c.add(i):c.delete(i); e.checks=[...c].sort((a,b)=>a-b); e.checkFor=o.end; return e; }); }
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeGame(); $('confirm').classList.remove('show'); } });

/* ---------------- Backup ---------------- */
$('exportBtn').onclick=()=>{
  const data=JSON.stringify({app:'game-event-tracker',version:2,exported:new Date().toISOString(),games:state.games,events:state.events},null,2);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download=`game-events-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('importFile').addEventListener('change',async ev=>{
  const file=ev.target.files[0]; ev.target.value=''; if(!file) return;
  let d; try{ d=JSON.parse(await file.text()); }catch(e){ return toast('That file is not a valid backup.'); }
  if(!d || d.app!=='game-event-tracker' || typeof d.games!=='object' || typeof d.events!=='object') return toast('That file is not a tracker backup.');
  const gs=Object.values(d.games), es=Object.values(d.events);
  ask('Import backup?',`Adds ${gs.length} game(s) and ${es.length} event(s). Items with the same ID are replaced.`,async()=>{
    gs.forEach(g=>state.games[g.id]=g); es.forEach(e=>state.events[e.id]=e); renderAll();
    for(const g of gs) await store.saveGame(g);
    for(const e of es) await store.saveEvent(e);
    toast('Backup imported');
  },'Import');
});

/* ---------------- Start ---------------- */
setMode('left');
setInterval(tick,1000);
setInterval(renderAll,60000);
(async()=>{
  if(firebaseConfig){
    try{ store=await firebaseStore(); return; }
    catch(e){ console.error(e); toast('Could not reach Firebase — using browser storage.'); }
  }
  store=localStore();
  $('app').hidden=false;
  renderAll();
})();
