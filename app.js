/* DealDex MVP. All cards and daily draws here are a browser-only demonstration.
   No coupon, credit, or real-world entitlement is granted by this page. */
const ICONS = {
  ai: '<path d="m32 3 5.5 18.5L56 27l-18.5 5.5L32 51l-5.5-18.5L8 27l18.5-5.5L32 3Z"/><path d="m49 45 2.5 6.5L58 54l-6.5 2.5L49 63l-2.5-6.5L40 54l6.5-2.5L49 45Z"/>',
  cloud: '<path d="M19 47h27a13 13 0 0 0 0-26 17 17 0 0 0-32.3 3.3A11.5 11.5 0 0 0 19 47Z"/>',
  software: '<rect x="8" y="8" width="19" height="19" rx="2"/><rect x="37" y="8" width="19" height="19" rx="2"/><rect x="8" y="37" width="19" height="19" rx="2"/><rect x="37" y="37" width="19" height="19" rx="2"/>',
  education: '<path d="M3 22 32 9l29 13-29 13L3 22Zm11 8v15c12 10 24 10 36 0V30M61 22v18"/>'
};
const POOLS = [
  { id: 'cloud', label:'云服务器', title:'云服务器福利池', description:'VPS、云平台赠金与算力体验', short:'VPS · 云平台 · 赠金' },
  { id: 'ai', label:'AI 福利', title:'AI 超值福利池', description:'精选 AI 工具、模型体验和 API 额度', short:'模型 · API · 会员' },
  { id: 'software', label:'软件工具', title:'软件工具福利池', description:'开发、设计与生产力工具', short:'开发 · 设计 · 效率' },
  { id: 'education', label:'教育优惠', title:'教育优惠福利池', description:'面向学生与学习者的数字福利', short:'学生 · 教育 · 课程' }
];
const DEMO_OFFERS = [
  { id:'ai-a', pool:'ai', rarity:'A', title:'AI 模型体验包', description:'模型试用权益示例，实际以活动规则为准', icon:'✦', requirement:'可能需要注册账号' },
  { id:'ai-s', pool:'ai', rarity:'S', title:'AI 编程助手高级试用', description:'开发工具订阅权益示例', icon:'⌘', requirement:'可能限制新用户' },
  { id:'ai-ssr', pool:'ai', rarity:'SSR', title:'AI API 高价值赠金', description:'开发者 API 试用额度示例', icon:'✧', requirement:'可能需要付款方式验证' },
  { id:'cloud-a', pool:'cloud', rarity:'A', title:'VPS 新用户折扣', description:'云服务器套餐折扣示例', icon:'☁', requirement:'可能需要新用户身份' },
  { id:'cloud-s', pool:'cloud', rarity:'S', title:'云平台开发者赠金', description:'云端资源体验额度示例', icon:'◈', requirement:'可能需要支付方式验证' },
  { id:'cloud-ssr', pool:'cloud', rarity:'SSR', title:'GPU 算力体验额度', description:'高价值计算资源试用示例', icon:'⬡', requirement:'可能存在地区或资格限制' },
  { id:'software-a', pool:'software', rarity:'A', title:'设计工具会员试用', description:'设计与生产力工具福利示例', icon:'▦', requirement:'可能限制新用户' },
  { id:'software-s', pool:'software', rarity:'S', title:'开发 IDE 专业授权', description:'软件高级功能体验示例', icon:'⌘', requirement:'需核对授权范围' },
  { id:'software-ssr', pool:'software', rarity:'SSR', title:'生产力工具年度权益', description:'长期软件授权福利示例', icon:'◫', requirement:'可能限制领取名额' },
  { id:'education-a', pool:'education', rarity:'A', title:'在线课程体验资格', description:'免费课程资源示例', icon:'✎', requirement:'需核对课程报名条件' },
  { id:'education-s', pool:'education', rarity:'S', title:'学生开发工具权益', description:'开发工具教育优惠示例', icon:'♧', requirement:'需要有效学生身份' },
  { id:'education-ssr', pool:'education', rarity:'SSR', title:'教育软件套装礼包', description:'多款软件教育授权福利示例', icon:'✥', requirement:'需要资格核验' }
];
const DAILY_KEY='dealdex-daily-v1', COLLECTION_KEY='dealdex-collection-v1', FAVORITES_KEY='dealdex-favorites-v1';
const MAX_DRAWS=3;
const RARITIES=[{id:'A',chance:0.70},{id:'S',chance:0.25},{id:'SSR',chance:0.05}];
const $ = (selector) => document.querySelector(selector);
const scene=$('#packScene');
let activeIndex=1;
let opening=false;
let dialogOpener=null;
let toastTimer=null;
function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function loadJSON(key,fallback){try{const data=localStorage.getItem(key);return data?JSON.parse(data):fallback;}catch{return fallback;}}
function saveJSON(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{ /* privacy mode: demo still runs in memory */ }}
let daily=loadJSON(DAILY_KEY,{day:todayKey(),used:0});
if(!daily||daily.day!==todayKey()||!Number.isInteger(daily.used)||daily.used<0){daily={day:todayKey(),used:0};saveJSON(DAILY_KEY,daily);}
let collection=loadJSON(COLLECTION_KEY,[]);if(!Array.isArray(collection))collection=[];
let favorites=loadJSON(FAVORITES_KEY,[]);if(!Array.isArray(favorites))favorites=[];
function remaining(){if(daily.day!==todayKey()){daily={day:todayKey(),used:0};saveJSON(DAILY_KEY,daily);}return Math.max(0,MAX_DRAWS-daily.used);}
function iconSVG(name){return `<svg viewBox="0 0 64 64" aria-hidden="true" class="${name==='ai'?'fill-icon':''}">${ICONS[name]}</svg>`;}
function packHTML(pool,index){return `<button type="button" class="pack pack--${pool.id}" data-index="${index}" aria-label="选择${pool.title}" aria-pressed="false"><span class="pack-leather"><span class="pack-seam"></span><span class="pack-spine"></span><span class="pack-strap"></span><span class="pack-corner tl"></span><span class="pack-corner tr"></span><span class="pack-corner bl"></span><span class="pack-corner br"></span><span class="pack-stud s1"></span><span class="pack-stud s2"></span><span class="pack-stud s3"></span><span class="pack-stud s4"></span><span class="pack-emblem"><span class="pack-glyph">${iconSVG(pool.id)}</span></span><span class="pack-ribbon">${pool.label}</span></span></button>`;}
scene.innerHTML=POOLS.map(packHTML).join('');
scene.addEventListener('click',(e)=>{const btn=e.target.closest('.pack');if(btn&&!opening)choose(Number(btn.dataset.index));});
function positionFor(index){const d=(index-activeIndex+POOLS.length)%POOLS.length;return d===0?0:d===1?1:d===2?2:-1;}
function choose(index){activeIndex=(index+POOLS.length)%POOLS.length;for(const pack of scene.querySelectorAll('.pack')){const isSelected=Number(pack.dataset.index)===activeIndex;pack.dataset.position=String(positionFor(Number(pack.dataset.index)));pack.setAttribute('aria-pressed',String(isSelected));pack.setAttribute('aria-label',`${POOLS[Number(pack.dataset.index)].title}${isSelected?'，当前已选中':''}`);}$('#selectedDescription').textContent=POOLS[activeIndex].description;}
function cycle(dir){if(opening)return;choose(activeIndex+dir);}
$('#prevPack').addEventListener('click',()=>cycle(-1));$('#nextPack').addEventListener('click',()=>cycle(1));choose(1);
function refreshCounts(){const n=remaining();$('#headerRemaining').textContent=`${n} / ${MAX_DRAWS}`;$('#metaRemaining').textContent=`${n} / ${MAX_DRAWS}`;const button=$('#openPack');button.disabled=n<=0||opening;button.querySelector('span:nth-child(2)').textContent=n>0?'打开卡包':'明日再来';}
refreshCounts();
function uniformRandom(){if(globalThis.crypto?.getRandomValues){const v=new Uint32Array(1);globalThis.crypto.getRandomValues(v);return v[0]/4294967296;}return Math.random();}
function drawRarity(){const n=uniformRandom();return n<.05?'SSR':n<.30?'S':'A';}
function pickOffer(pool,rarity){const options=DEMO_OFFERS.filter(o=>o.pool===pool&&o.rarity===rarity);return options[Math.floor(uniformRandom()*options.length)];}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2600);}
async function draw(){if(opening)return;if(remaining()<=0){toast('今天的 3 次免费体验已用完，明天再来吧。');return;}opening=true;daily.used++;saveJSON(DAILY_KEY,daily);refreshCounts();document.body.classList.add('is-opening');const pool=POOLS[activeIndex];const rarity=drawRarity();const offer=pickOffer(pool.id,rarity);collection.unshift({id:offer.id,ts:Date.now()});collection=collection.slice(0,100);saveJSON(COLLECTION_KEY,collection);await new Promise(resolve=>setTimeout(resolve,window.matchMedia('(prefers-reduced-motion: reduce)').matches?80:1050));document.body.classList.remove('is-opening');opening=false;refreshCounts();showResult(offer);}
$('#openPack').addEventListener('click',draw);
function showDialog(content){dialogOpener=document.activeElement;$('#dialogContent').innerHTML=content;$('#overlay').hidden=false;document.body.style.overflow='hidden';$('#closeDialog').focus();}
function closeDialog(){$('#overlay').hidden=true;document.body.style.overflow='';if(dialogOpener instanceof HTMLElement)dialogOpener.focus();}
$('#closeDialog').addEventListener('click',closeDialog);
$('#overlay').addEventListener('click',(e)=>{if(e.target.closest('[data-close]'))closeDialog();});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('#overlay').hidden){closeDialog();return;}if(!$('#overlay').hidden)return;if(e.target instanceof HTMLInputElement)return;if(e.key==='ArrowLeft'){cycle(-1);}if(e.key==='ArrowRight'){cycle(1);}});
function basicDialog({kicker,title,lead,body}){return `<div class="dialog-inner"><div class="dialog-kicker">${kicker}</div><h2 id="dialogTitle" class="dialog-title">${title}</h2><p class="dialog-lead">${lead}</p>${body}</div>`;}
function showProbability(){const rows=[...RARITIES].map(r=>`<div class="prob-row"><span class="rarity-chip ${r.id.toLowerCase()}">${r.id}</span><strong>${Math.round(r.chance*100)}%</strong></div>`).join('');showDialog(basicDialog({kicker:'THE ODDS',title:'卡池概率',lead:'每次打开卡包，将随机发现一张福利卡。',body:`${rows}<p class="dialog-fineprint">四个主题卡池在当前演示版使用相同概率；不同等级只表示内容的推荐价值，不意味着已获得付费产品、会员资格或代金券。</p><div class="demo-callout">演示版概率由浏览器本地抽取。正式版将由服务端判定抽卡结果，并根据实际可抽库存与资格筛选公示真实概率。</div>`}));}
$('#probabilityButton').addEventListener('click',showProbability);
$('#headerCount').addEventListener('click',()=>showDialog(basicDialog({kicker:'YOUR DAILY PACKS',title:'每日免费开包',lead:`今天还可以打开 ${remaining()} 个卡包`,body:`<div class="prob-row"><span>每日额度</span><strong>3 次</strong></div><div class="prob-row"><span>重置时间</span><strong>设备本地零点</strong></div><div class="prob-row"><span>付费抽卡</span><strong>不提供</strong></div><p class="dialog-fineprint">正式上线后抽取次数由账户系统统一记录；当前阶段使用本地浏览器存储，清理浏览器数据可能重置演示记录。</p>`})));
function showResult(offer){const already=favorites.includes(offer.id);const label=POOLS.find(p=>p.id===offer.pool)?.label||'';const isSsr=offer.rarity==='SSR';showDialog(`<div class="dialog-inner"><div class="dialog-kicker">PACK OPENED · ${label}</div><h2 id="dialogTitle" class="dialog-title">${isSsr?'发现了一张珍稀福利卡！':'发现一张新的福利卡'}</h2><div class="result-visual rarity-${offer.rarity.toLowerCase()}"><span class="result-rank">${offer.rarity}</span><span class="result-icon" aria-hidden="true">${offer.icon}</span><span class="result-sub">${label}</span></div><div class="reward-name">${offer.title}</div><p class="reward-desc">${offer.description}</p><div class="demo-callout">这是交互演示卡片，并非已核验活动。卡牌不等于兑换码或领取资格；正式版会提供官方来源、领取条件与有效期。</div><div class="dialog-actions"><button type="button" class="modal-button" id="favoriteResult">${already?'已收藏 ✓':'☆ 收藏到图鉴'}</button><button type="button" class="modal-button primary" id="nextDraw">${remaining()>0?'继续抽卡':'返回大厅'}</button></div></div>`);$('#favoriteResult').addEventListener('click',()=>{if(favorites.includes(offer.id))favorites=favorites.filter(id=>id!==offer.id);else favorites.push(offer.id);saveJSON(FAVORITES_KEY,favorites);$('#favoriteResult').textContent=favorites.includes(offer.id)?'已收藏 ✓':'☆ 收藏到图鉴';toast(favorites.includes(offer.id)?'已加入收藏':'已取消收藏');});$('#nextDraw').addEventListener('click',closeDialog);}
function openCollection(){const seen=[...new Set(collection.map(c=>c.id))].map(id=>DEMO_OFFERS.find(o=>o.id===id)).filter(Boolean);let body='';if(!seen.length){body='<div class="empty-state">图鉴里还没有卡牌。<br/>选一个喜欢的福利池，打开你的第一个卡包吧。</div>';}else{body=`<div class="collection-grid">${seen.map(o=>`<div class="collection-item"><span class="small-rank">${o.rarity}</span><div class="small-icon">${o.icon}</div><div class="small-name">${o.title}</div><div class="small-name">${favorites.includes(o.id)?'★ 已收藏':'已发现'}</div></div>`).join('')}</div>`;}showDialog(basicDialog({kicker:'YOUR COLLECTION',title:'我的福利图鉴',lead:`已发现 ${seen.length} / ${DEMO_OFFERS.length} 张演示卡牌 · 收藏 ${favorites.length} 张`,body:body+'<p class="dialog-fineprint">收藏和抽卡记录仅保存在当前浏览器。后续将接入账号系统同步真实福利图鉴。</p>'}));}
function openDiscover(){const body=`<label for="offerSearch" class="dialog-section-title">搜索演示福利</label><input class="search-input" id="offerSearch" type="search" placeholder="输入 AI、服务器、软件、教育…" autocomplete="off"><div id="offerResults"></div><p class="dialog-fineprint">当前展示的是占位示例，并非在线领取信息。正式版的福利目录将独立提供活动核验、条件筛选与领取教程。</p>`;showDialog(basicDialog({kicker:'DISCOVER DEALS',title:'发现数字福利',lead:'除了开卡包，也能直接检索公开的福利信息。',body}));const input=$('#offerSearch'),result=$('#offerResults');function update(){const q=input.value.trim().toLowerCase();const filtered=DEMO_OFFERS.filter(o=>(o.title+o.description+POOLS.find(p=>p.id===o.pool)?.label).toLowerCase().includes(q));result.innerHTML=filtered.length?filtered.map(o=>`<div class="offer-row"><strong>${o.title} <span class="rarity-chip ${o.rarity.toLowerCase()}" style="min-width:33px;font-size:11px;padding:2px 6px">${o.rarity}</span></strong><small>${o.description} · ${o.requirement}</small></div>`).join(''):'<div class="empty-state">没有找到匹配的演示卡牌</div>';}input.addEventListener('input',update);update();}
for(const btn of document.querySelectorAll('[data-nav]'))btn.addEventListener('click',()=>{const v=btn.dataset.nav;if(v==='collection')openCollection();else if(v==='discover')openDiscover();else window.scrollTo({top:0,behavior:'smooth'});});
// Keep counts correct across tabs and across local midnight while the page stays open.
window.addEventListener('storage',(event)=>{if([DAILY_KEY,COLLECTION_KEY,FAVORITES_KEY].includes(event.key)){daily=loadJSON(DAILY_KEY,{day:todayKey(),used:0});collection=loadJSON(COLLECTION_KEY,[]);favorites=loadJSON(FAVORITES_KEY,[]);refreshCounts();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCounts();});
