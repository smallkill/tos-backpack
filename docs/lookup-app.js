// 查詢頁的 UI 邏輯(獨立檔案,讓 CSP 的 script-src 只需 'self')
import { login, getProfile, aggregate } from './lookup.js'
// 資料與圖片的相對路徑(部署於 docs/(與本頁同資料夾)):只讀卡池清單,不讀擁有者的背包資料
const DATA_BASE = './', IMG = './img/'
const $=s=>document.querySelector(s), PAGE=180;
let OWN=new Map(), ALL=[], MONS=null, state={q:'',own:'all',att:'',race:'',star:'',shown:PAGE};
const UID_KEY='tos-lookup-uid';

const norm=s=>String(s).normalize('NFKC').replace(/[\s‧·．.・]/g,'').toLowerCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showErr(m){const e=$('#err');e.textContent=m;e.classList.add('on')}
function hideErr(){const e=$('#err');e.textContent='';e.classList.remove('on')}

async function loadMonsters(){
  if(MONS)return MONS;
  let r;
  try{r=await fetch(DATA_BASE+'monsters.json')}catch{throw new Error('卡池資料載入失敗(網路問題),請稍後再試')}
  if(!r.ok)throw new Error('卡池資料載入失敗(HTTP '+r.status+')');
  try{MONS=await r.json()}catch{throw new Error('卡池資料格式錯誤')}
  return MONS;
}
function buildAll(m,agg){
  OWN=new Map(agg.cards.map(x=>[x.id,x]));
  const seen=new Set();
  ALL=m.map(([id,name,att,race,star])=>{seen.add(id);return{id,name,att,race,star,n:norm(name),o:OWN.get(id)||null}});
  agg.cards.forEach(x=>{ if(!seen.has(x.id)) ALL.push({id:x.id,name:'未知卡號',att:'',race:'',star:0,n:norm('未知卡號'),o:x}) });
  ALL.sort((a,b)=>a.id-b.id); IDX=null;
}
function chipSet(el,key,vals,fmt){
  el.innerHTML=['',...vals].map(v=>`<button type="button" class="chip ${state[key]===String(v)?'on':''}" data-k="${key}" data-v="${esc(v)}">${v===''?'全部':esc(fmt(v))}</button>`).join('');
}
function buildChips(){
  const uniq=k=>[...new Set(ALL.map(x=>x[k]).filter(v=>v!==''&&v!==0))];
  chipSet($('#fa'),'att',['火','水','木','光','暗'].filter(a=>uniq('att').includes(a)),v=>v);
  chipSet($('#fr'),'race',uniq('race').sort(),v=>v);
  chipSet($('#fs'),'star',uniq('star').sort((a,b)=>a-b),v=>v+'★');
}
function statusHtml(x){
  if(!x.o) return '❌ 沒有';
  const o=x.o; return `✅ 有 ×${o.count}(最高 Lv${o.maxLevel})`;
}
// 圖片載入失敗改顯示占位(error 不冒泡,用 capture;CSP 不允許行內 onerror)
document.addEventListener('error',e=>{const t=e.target;if(t&&t.tagName==='IMG'&&t.closest('#list,#hero'))t.outerHTML='<div class=ph>?</div>'},true);
function imgHtml(x,w){
  return `<img loading="lazy" decoding="async" width="${w}" height="${w}" src="${esc(IMG)}${esc(x.id)}.webp" alt="" class="${x.o?'':'gray'}">`;
}
function infoLine(x){
  const a=[]; if(x.att)a.push(`<span class="att">${esc(x.att)}</span>`); if(x.race)a.push(esc(x.race)); if(x.star)a.push(esc(x.star)+'★');
  return a.join(' ');
}
function item(x){
  const lab=`${x.id} ${x.name} ${x.o?'有':'沒有'}`;
  return `<button type="button" class="cell ${x.o?'own':'no'}" data-id="${esc(x.id)}" aria-label="${esc(lab)}" aria-describedby="pop">${imgHtml(x,64)}${x.o?`<span class="n">×${esc(x.o.count)}</span>`:''}</button>`;
}
function popHtml(x){
  const o=x.o, extra=o?`<div class="info">技能 Lv${esc(o.maxSkillLevel)} · 強化 ${esc(o.maxEnhanceLevel)}</div>`:'';
  return `<div class="id">No.${esc(x.id)}</div><div class="nm">${esc(x.name)}</div><div class="info">${infoLine(x)}</div><div class="st">${esc(statusHtml(x))}</div>${extra}`;
}
function rawQ(){return state.q.normalize("NFKC").trim()}
function search(){
  const raw=rawQ();
  let list=ALL, exact=null;
  if(raw){
    if(/^\d+$/.test(raw)){
      const d=raw.replace(/^0+(?=\d)/,''), n=+d; exact=ALL.find(x=>x.id===n)||null;
      list=ALL.filter(x=>String(x.id).startsWith(d));
      list.sort((a,b)=>(b.id===n)-(a.id===n)||a.id-b.id);
    }else{
      const toks=raw.split(/\s+/).map(norm).filter(Boolean);
      list=ALL.filter(x=>toks.every(t=>x.n.includes(t)));
    }
  }
  list=list.filter(x=>
    (state.own==='all'||(state.own==='yes')===!!x.o)&&
    (!state.att||x.att===state.att)&&(!state.race||x.race===state.race)&&(!state.star||x.star===+state.star));
  return {list,exact};
}
function render(){
  hidePop();
  const hero=$('#hero'); hero.innerHTML='';
  if(!ALL.length){$('#count').textContent='';$('#list').innerHTML='';return}
  const {list,exact}=search();
  if(/^\d+$/.test(rawQ())){
    const n=+rawQ();
    if(exact){
      hero.innerHTML=`<div class="big ${exact.o?'yes':'no'}">${imgHtml(exact,96)}
        <div style="min-width:0"><div class="id" style="color:var(--accent2);font-weight:700">No.${exact.id}</div>
        <div class="nm">${esc(exact.name)}</div><div class="info">${infoLine(exact)}</div>
        <div class="st">${esc(statusHtml(exact))}</div></div></div>`;
    }else{
      hero.innerHTML=`<div class="big no"><div class="ph">?</div><div><div class="nm">No.${esc(n)}</div><div class="info">卡池資料中查無此卡號</div><div class="st">❌ 沒有</div></div></div>`;
    }
  }
  $('#count').textContent=`符合 ${list.length} 種`+(list.length>state.shown?`(顯示前 ${state.shown} 筆)`:'');
  const el=$('#list');
  if(!list.length){el.innerHTML='<div class="empty">找不到符合的卡片</div>';return}
  el.innerHTML='<div class="grid">'+list.slice(0,state.shown).map(item).join('')+'</div>'+
    (list.length>state.shown?'<button class="more" id="more">再顯示 '+Math.min(PAGE,list.length-state.shown)+' 筆</button>':'');
}

// ---- 表單 ----
$('#f').addEventListener('submit',async e=>{
  e.preventDefault(); hideErr();
  const uid=$('#uid').value.trim(); let code=$('#code').value.trim();
  if(!/^\d{5,12}$/.test(uid)){showErr('UID 必須是 5~12 位數字');return}
  if(!code){showErr('請輸入驗證碼');return}
  const go=$('#go'); go.disabled=true; go.textContent='查詢中…';
  try{
    const m=await loadMonsters();
    const token=await login(uid,code);
    code=''; $('#code').value='';   // 登入後立刻丟掉驗證碼
    const agg=aggregate(await getProfile(uid,token));
    buildAll(m,agg);
    state={q:'',own:'all',att:'',race:'',star:'',shown:PAGE}; $('#q').value='';
    [...$('#own').children].forEach(c=>c.classList.toggle('on',c.dataset.o==='all'));
    buildChips();
    $('#res').hidden=false;
    $('#sub').textContent=`持有 ${agg.uniqueCards} 種 / 共 ${agg.totalCards} 張 · 全卡池 ${ALL.length} 種`;
    try{ if($('#rem').checked) localStorage.setItem(UID_KEY,uid); else localStorage.removeItem(UID_KEY) }catch{}
    render();
  }catch(err){
    showErr(err&&err.message?err.message:'發生未知錯誤,請稍後再試');
  }finally{
    code=''; $('#code').value=''; go.disabled=false; go.textContent='查詢';
  }
});
$('#clear').addEventListener('click',()=>{
  OWN=new Map(); ALL=[]; IDX=null; state={q:'',own:'all',att:'',race:'',star:'',shown:PAGE};
  $('#f').reset(); $('#q').value=''; $('#res').hidden=true; hideErr();
  $('#sub').textContent='已清除。輸入 UID 與互助檢視驗證碼,在這個瀏覽器內查看你自己的卡片持有狀況';
  try{localStorage.removeItem(UID_KEY)}catch{}
  render();
});
try{const u=localStorage.getItem(UID_KEY); if(u&&/^\d{5,12}$/.test(u)){$('#uid').value=u;$('#rem').checked=true}}catch{}

let timer;
$('#q').addEventListener('input',e=>{state.q=e.target.value;state.shown=PAGE;clearTimeout(timer);timer=setTimeout(render,80)});
document.addEventListener('click',e=>{
  const t=e.target;
  if(t.id==='more'){state.shown+=PAGE;render();return}
  if(t.dataset&&t.dataset.o){state.own=t.dataset.o;[...$('#own').children].forEach(c=>c.classList.toggle('on',c===t));state.shown=PAGE;render();return}
  if(t.dataset&&t.dataset.k){state[t.dataset.k]=t.dataset.v;t.parentElement.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c===t));state.shown=PAGE;render()}
});
// ---- 浮動詳細卡:桌機 hover / 鍵盤 focus / 手機 tap ----
const pop=$('#pop'); let pinned=null;
let IDX=null;const byId=id=>(IDX||(IDX=new Map(ALL.map(x=>[x.id,x])))).get(+id);
function showPop(cell){
  const x=byId(cell.dataset.id); if(!x)return;
  pop.className='on '+(x.o?'yes':'no'); pop.innerHTML=popHtml(x);
  const r=cell.getBoundingClientRect(), w=pop.offsetWidth, h=pop.offsetHeight;
  let l=Math.min(Math.max(8,r.left+r.width/2-w/2),innerWidth-w-8);
  let t=r.top-h-8; if(t<8)t=r.bottom+8;
  pop.style.left=l+'px'; pop.style.top=t+'px';
}
function hidePop(){pop.className='';pinned&&pinned.classList.remove('sel');pinned=null}
const cellOf=e=>e.target.closest&&e.target.closest('.cell');
const canHover=matchMedia('(hover:hover)').matches;
$('#list').addEventListener('mouseover',e=>{const c=cellOf(e);if(c&&canHover&&!pinned)showPop(c)});
$('#list').addEventListener('mouseout',e=>{const c=cellOf(e);if(c&&canHover&&!pinned&&!c.contains(e.relatedTarget))hidePop()});
$('#list').addEventListener('focusin',e=>{const c=cellOf(e);if(!c)return;if(pinned&&pinned!==c)hidePop();if(!pinned)showPop(c)});
$('#list').addEventListener('focusout',e=>{if(cellOf(e)&&!pinned)hidePop()});
document.addEventListener('click',e=>{
  const c=cellOf(e);
  if(c){ if(pinned===c){hidePop();return} hidePop(); pinned=c; c.classList.add('sel'); showPop(c); return }
  hidePop();
},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hidePop()});
addEventListener('scroll',()=>{if(!canHover)hidePop();else if(pinned)showPop(pinned)},{passive:true});
