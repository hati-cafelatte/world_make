/* =========================================================
   GENESIS DEUS — game.js
   シミュレーション本体 + 2Dパネル描画(年代記・恵み/災害リスト・人物パネル)
   3D世界の描画は world3d.js が担当し、ここから STATE を渡して呼び出す。
   ========================================================= */

window.GenesisDeus = (function(){

const SEASON_NAMES = ['春','夏','秋','冬'];
const FIGURE_NAME_POOL = ['アシュ','ヴェル','トラン','ミラ','ケイン','ソル','エダ','ロウ','ニカ','ハル','ゼン','イリス','コウ','サラ','ドム','フェイ'];

const CONFIG = {
  TICK_MS: 4000,
  MAX_CATCHUP_TICKS: 2000,
  SAVE_KEY: 'save_v2',
  WORLD_RADIUS: 80,
  LANGUAGE_THRESHOLD: 40,
  ERAS: [
    { name:'石器時代',     sub:'火もまだ、ない。',                 threshold:0,    settlement:0 },
    { name:'狩猟採集の時代', sub:'獣を追い、洞窟に眠る。',            threshold:60,   settlement:0 },
    { name:'農耕の始まり',  sub:'土に種を蒔くことを知った。',         threshold:160,  settlement:1 },
    { name:'村落の時代',   sub:'人々が寄り添い、村ができた。',        threshold:340,  settlement:2 },
    { name:'都市の時代',   sub:'石の壁が、村を都市に変えた。',        threshold:640,  settlement:3 },
    { name:'王国の時代',   sub:'王冠が、初めて頭上に輝いた。',        threshold:1100, settlement:4 },
    { name:'帝国の時代',   sub:'版図は広がり、法と軍が世界を縛る。',   threshold:1800, settlement:5 },
    { name:'大航海の時代',  sub:'海の向こうに、もう一つの世界がある。', threshold:2800, settlement:6 },
    { name:'産業革命',     sub:'蒸気が、神話に代わる力となった。',     threshold:4200, settlement:7 },
    { name:'近代',        sub:'電気が夜を灯し、国家が科学を競う。',    threshold:6200, settlement:8 },
    { name:'現代',        sub:'彼らはもう、空の彼方にまで手を伸ばす。', threshold:9000, settlement:9 },
  ],
  BLESSINGS: [
    { id:'rain',    name:'実りの雨',       cost:8,  min:0,   fx:s=>{ bumpPop(s,0.03); addFaithFlat(s,2); } },
    { id:'climate', name:'安定した気候',    cost:16, min:0,   fx:s=>{ s.stability=Math.min(100,s.stability+8); addFaithFlat(s,3); } },
    { id:'harvest', name:'豊作',           cost:20, min:0,   fx:s=>{ bumpPop(s,0.06); } },
    { id:'cure',    name:'病気の治療',      cost:26, min:0,   fx:s=>{ s.plague=false; bumpPop(s,0.02); addFaithFlat(s,5); } },
    { id:'farming', name:'農耕技術を授ける', cost:22, min:0,   fx:s=>{ s.progress+=24; } },
    { id:'fire',    name:'火の知識',       cost:14, min:0,   fx:s=>{ s.progress+=14; } },
    { id:'iron',    name:'製鉄技術',       cost:42, min:160, fx:s=>{ s.progress+=55; } },
    { id:'medicine',name:'医療知識',       cost:38, min:340, fx:s=>{ s.progress+=40; bumpPop(s,0.04); } },
    { id:'science', name:'科学の啓示',      cost:65, min:1100,fx:s=>{ s.progress+=110; } },
    { id:'greatone',name:'偉人の誕生',      cost:85, min:0,   fx:s=>{ spawnFigure(s, pickFigureRole(s), true); } },
  ],
  DISASTERS: [
    { id:'downpour', name:'大雨',   cost:5,  fx:s=>{ bumpPop(s,-0.02); } },
    { id:'drought',  name:'干ばつ', cost:11, fx:s=>{ bumpPop(s,-0.05); s.progress=Math.max(0,s.progress-8); } },
    { id:'eruption', name:'噴火',   cost:22, fx:s=>{ bumpPop(s,-0.12); s.volcanoActiveUntil = s._tickCount+3; } },
    { id:'quake',    name:'地震',   cost:16, fx:s=>{ bumpPop(s,-0.07); s.progress=Math.max(0,s.progress-15); } },
    { id:'wildfire', name:'山火事', cost:11, fx:s=>{ bumpPop(s,-0.05); } },
    { id:'tsunami',  name:'津波',   cost:20, fx:s=>{ bumpPop(s,-0.1); } },
    { id:'plague',   name:'疫病',   cost:28, fx:s=>{ bumpPop(s,-0.15); s.plague=true; } },
    { id:'meteor',   name:'隕石',   cost:55, fx:s=>{ bumpPop(s,-0.25); log(s,'天より炎の石が降り、世界が震撼した。','disaster'); } },
    { id:'lightning',name:'雷',     cost:6,  fx:s=>{ if (Math.random()<0.3 && s.figures.length) killFigure(s, s.figures[Math.floor(Math.random()*s.figures.length)], '落雷'); else bumpPop(s,-0.01); } },
  ],
  // 個人へ向けた干渉(3D世界で人物をクリックして選択した時に使う)
  INDIVIDUAL_ACTIONS: [
    { id:'boon',       name:'加護を与える',  cost:15, cls:'', fx:(s,f)=>{ const k=randomStatKey(); f.stats[k]=clamp(f.stats[k]+18,5,99); log(s,`${f.name}に加護が与えられ、${k}が高まった。`,'event'); } },
    { id:'blessing',   name:'祝福を与える',  cost:12, cls:'', fx:(s,f)=>{ f.lifespan+=6; addFaithFlat(s,2); log(s,`${f.name}が祝福を受けた。`,'event'); } },
    { id:'revelation', name:'天啓を授ける',  cost:32, cls:'', fx:(s,f)=>{ f.stats.知力=clamp(f.stats.知力+20,5,99); f.stats.好奇心=clamp(f.stats.好奇心+15,5,99); s.progress+=18; log(s,`${f.name}に天啓が降りた。世界の知はまた一歩進んだ。`,'event'); } },
    { id:'corrupt',    name:'邪知を授ける',  cost:20, cls:'corrupt', fx:(s,f)=>{ f.corruption=Math.min(100,(f.corruption||0)+30); log(s,`${f.name}の心に、禁じられた知識が忍び込んだ。`,'corrupt'); } },
  ],
  FIGURE_ROLES: ['指導者','大祭司','学者','戦士','商人'],
  DIVINE_NAME_POOL: ['ソル','ルナ','アシュタル','ヴェリオン','エルダ','オリジン','ケイオス','ニルヴァ','テララ','イグナ'],
  RELIGION_TEMPLATES: [
    { maxEra:1, forms:['大いなる{X}の精霊信仰','{X}の祖霊崇拝','{X}への焚火の祈り'] },
    { maxEra:3, forms:['豊穣の{X}教','{X}神への収穫祭儀','大地母神{X}信仰'] },
    { maxEra:6, forms:['{X}教団','聖{X}教会','{X}神殿の教え'] },
    { maxEra:8, forms:['{X}国教会','{X}正教','{X}聖座'] },
    { maxEra:10, forms:['新{X}主義','{X}教(合理主義派)','{X}精神財団'] },
  ],
  SOCIETY_LABELS: ['原始共同体','部族社会','氏族制の萌芽','身分制の村落','都市国家','絶対王政','帝国官僚制','重商主義','産業資本主義','独占資本主義','情報化社会'],
  HISTORICAL_EVENTS: [
    { id:'hero', minEra:0, w:3, fx:s=>{ spawnFigure(s,'戦士',true); log(s,'一人の英雄が民の間に生まれた。','event'); } },
    { id:'genius', minEra:2, w:2, fx:s=>{ spawnFigure(s,'学者',true); s.progress+=30; log(s,'類まれな知性を持つ者が現れ、知を大きく前進させた。','event'); } },
    { id:'assassination', minEra:4, w:1, fx:s=>{ if(s.figures.length){ killFigure(s, s.figures[0], '暗殺'); } } },
    { id:'revolution', minEra:5, w:1, fx:s=>{ s.faithLevel=Math.max(0,s.faithLevel-10); log(s,'民衆が蜂起し、旧き秩序が崩れ去った。','event'); } },
    { id:'dynasty', minEra:5, w:1, fx:s=>{ const l=s.figures.find(f=>f.role==='指導者'); if(l) killFigure(s,l,'王朝交代'); } },
    { id:'civilwar', minEra:4, w:1, fx:s=>{ bumpPop(s,-0.08); log(s,'国は二つに割れ、同胞が争った。','event'); } },
    { id:'worldwar', minEra:8, w:0.6, fx:s=>{ bumpPop(s,-0.2); log(s,'諸国が入り乱れ、かつてない規模の戦火が広がった。','event'); } },
    { id:'golden', minEra:3, w:1.2, fx:s=>{ s.progress+=25; bumpPop(s,0.08); log(s,'文化と繁栄が絶頂を迎えた。','event'); } },
    { id:'depression', minEra:8, w:0.6, fx:s=>{ bumpPop(s,-0.05); s.faithLevel=Math.min(100,s.faithLevel+6); log(s,'経済が崩壊し、人々は再び神にすがった。','event'); } },
    { id:'reformation', minEra:4, w:0.8, fx:s=>{ log(s,'信仰のあり方を巡り、新たな教えが分かれ出た。','event'); } },
    // 邪知(corruption)の蓄積による負のイベント
    { id:'crimewave', minEra:2, w:0, corrupt:true, fx:s=>{ bumpPop(s,-0.04); s.stability=Math.max(0,s.stability-10); log(s,'闇に染まった者の教唆により、犯罪と裏切りが広がった。','corrupt'); } },
    { id:'cult', minEra:3, w:0, corrupt:true, fx:s=>{ s.faithLevel=Math.max(0,s.faithLevel-8); log(s,'邪神を崇める秘密結社が、民の間に根を張った。','corrupt'); } },
    // 恵み偏重(無神論・科学信仰)/災害偏重(狂信・邪神信仰)による負のイベント
    { id:'apostasy', minEra:2, w:0, pressureType:'atheism', fx:s=>{ s.faithLevel=Math.max(0,s.faithLevel-15); log(s,'かつての信者たちが、公然と神の存在を否定し始めた。','event'); } },
    { id:'sciencecult', minEra:7, w:0, pressureType:'atheism', fx:s=>{ s.secularized=true; log(s,'科学こそが真の神であるという思想が、知識人の間に広まった。','event'); } },
    { id:'witchhunt', minEra:4, w:0, pressureType:'cult', fx:s=>{ bumpPop(s,-0.03); log(s,'異端審問の炎が、村々を焼いた。','disaster'); } },
    { id:'holywar', minEra:5, w:0, pressureType:'cult', fx:s=>{ bumpPop(s,-0.06); log(s,'聖戦の名のもと、多くの血が流れた。','disaster'); } },
    { id:'darkgod', minEra:3, w:0, pressureType:'cult', once:true, fx:s=>{ if(s.faithTarget==='player'){ s.faithTarget='rival'; log(s,'闇の中から名もなき邪神への信仰が生まれ、あなたへの信仰は静かに分たれ始めた。','corrupt'); } } },
  ],
};

let STATE = null;
let selectedFigureId = null;
let tickTimer = null;

/* ---------- ヘルパー ---------- */
function bumpPop(s, ratio){ s.population = Math.max(20, Math.round(s.population*(1+ratio))); }
function addFaithFlat(s, n){ s.faithLevel = Math.min(100, s.faithLevel+n); }
function log(s, text, cls){ s.chronicle.push({ t:`${s.year}年 ${SEASON_NAMES[s.season]}`, text, cls:cls||'' }); if (s.chronicle.length>200) s.chronicle.shift(); }
function rnd(){ return Math.floor(Math.random()*70)+15; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, Math.round(v))); }
function randomName(){ return FIGURE_NAME_POOL[Math.floor(Math.random()*FIGURE_NAME_POOL.length)] + (Math.random()<0.4?'・'+FIGURE_NAME_POOL[Math.floor(Math.random()*FIGURE_NAME_POOL.length)]:''); }
function randomStatKey(){ const keys=['知力','信仰心','勇敢さ','好奇心','社交性','指導力','戦闘力','労働力']; return keys[Math.floor(Math.random()*keys.length)]; }
function uid(){ return 'f'+Math.random().toString(36).slice(2,10); }

function pickFigureRole(s){
  const roles = CONFIG.FIGURE_ROLES.filter(r=>!s.figures.find(f=>f.role===r));
  return roles.length ? roles[Math.floor(Math.random()*roles.length)] : CONFIG.FIGURE_ROLES[Math.floor(Math.random()*CONFIG.FIGURE_ROLES.length)];
}

function assignReligionName(s, eraIdx){
  const group = CONFIG.RELIGION_TEMPLATES.find(t=>eraIdx<=t.maxEra) || CONFIG.RELIGION_TEMPLATES[CONFIG.RELIGION_TEMPLATES.length-1];
  const form = group.forms[Math.floor(Math.random()*group.forms.length)];
  const x = (s.faithTarget==='player' && s.godName) ? s.godName : CONFIG.DIVINE_NAME_POOL[Math.floor(Math.random()*CONFIG.DIVINE_NAME_POOL.length)];
  s.religionName = form.replace('{X}', x);
  log(s, `民は自らの信仰に名を与えた──「${s.religionName}」。`, 'event');
}

function spawnFigure(s, role, announce){
  const predecessor = s.figures.find(f=>f.role===role);
  let stats;
  if (predecessor){
    stats={}; Object.keys(predecessor.stats).forEach(k=>{ stats[k]=clamp(predecessor.stats[k]+(Math.random()*30-15),5,99); });
    s.figures = s.figures.filter(f=>f!==predecessor);
  } else {
    stats = { 知力:rnd(), 信仰心:rnd(), 勇敢さ:rnd(), 好奇心:rnd(), 社交性:rnd(), 指導力:rnd(), 戦闘力:rnd(), 労働力:rnd() };
  }
  const ang = Math.random()*Math.PI*2, r = Math.random()*CONFIG.WORLD_RADIUS*0.55;
  const fig = {
    id: uid(), name:randomName(), role, stats, corruption:0,
    age: 15+Math.floor(Math.random()*10), lifespan: 45+Math.floor(Math.random()*35),
    pos:{x:Math.cos(ang)*r, z:Math.sin(ang)*r}, target:null,
  };
  s.figures.push(fig);
  if (announce) log(s, `${fig.name}(${role})が頭角を現した。`, 'event');
  return fig;
}

function killFigure(s, fig, cause){
  s.figures = s.figures.filter(f=>f!==fig);
  if (selectedFigureId === fig.id) selectedFigureId = null;
  log(s, `${fig.name}(${fig.role})が世を去った。(${cause})`, 'death');
}

function currentEraIndex(s){ let idx=0; for (let i=0;i<CONFIG.ERAS.length;i++){ if (s.progress>=CONFIG.ERAS[i].threshold) idx=i; } return idx; }

function faithGainMultiplier(s){
  const recent = s.recentActions.slice(-20);
  let base = 1.0;
  if (recent.length>=4){
    const blessRatio = recent.filter(a=>a==='bless').length/recent.length;
    const dist = Math.abs(blessRatio-0.65);
    base = Math.max(0.35, 1.15-dist*1.6);
  }
  const pressurePenalty = ((s.atheismPressure||0) + (s.cultPressure||0)) / 260; // 最大約77%減
  return Math.max(0.15, base * (1-pressurePenalty));
}

/* ---------- 状態初期化 ---------- */
function defaultState(){
  return {
    year:1, season:0, population:40, progress:0,
    faithLevel:4, faithPoints:18, stability:50, plague:false,
    figures:[], chronicle:[], recentActions:[],
    religionName:null, secularized:false,
    godName:null, languageAcquired:false, faithTarget:'player',
    atheismPressure:0, cultPressure:0, entitlementStreak:0, fearStreak:0, _firedOnce:{},
    volcanoActiveUntil:-1, _tickCount:0,
    lastTimestamp: Date.now(),
  };
}

/* ---------- シミュレーション ---------- */
function simulateTick(s){
  s._tickCount = (s._tickCount||0)+1;
  s.season++; if (s.season>=4){ s.season=0; s.year++; }
  const eraIdx = currentEraIndex(s);

  s.progress += 0.6 + eraIdx*0.15;
  const mult = faithGainMultiplier(s);
  s.faithPoints += (1+s.faithLevel/6) * mult;
  s.faithLevel = Math.max(0, s.faithLevel - (0.08 + eraIdx*0.01));

  if (!s.languageAcquired && s.progress >= CONFIG.LANGUAGE_THRESHOLD){
    s.languageAcquired = true;
    log(s, s.godName ? `人々は言葉を得た。彼らはやがて、汝の名──「${s.godName}」──を語り継ぐだろう。` : '人々は言葉を得た。', 'event');
  }
  if (!s.religionName && s.faithLevel >= 20 && s.languageAcquired) assignReligionName(s, eraIdx);
  if (!s.secularized && eraIdx>=7 && s.faithLevel < 12){
    s.secularized = true;
    log(s, '国家は次第に、神への祈りより科学の言葉を信じ始めている。', 'event');
  }

  let popDelta = 0.01 + eraIdx*0.004;
  if (s.plague) popDelta -= 0.05;
  if (s.stability < 30) popDelta -= 0.02;
  s.population = Math.max(15, Math.round(s.population*(1+popDelta)));
  s.stability = Math.max(0, s.stability-0.3);

  // 著名人物: 加齢・死亡・徘徊
  s.figures.forEach(f=>{
    f.age += 0.25;
    if (!f.target || (Math.abs(f.pos.x-f.target.x)<1 && Math.abs(f.pos.z-f.target.z)<1)){
      const ang=Math.random()*Math.PI*2, r=Math.random()*CONFIG.WORLD_RADIUS*0.55;
      f.target = { x:Math.cos(ang)*r, z:Math.sin(ang)*r };
    }
    f.pos.x += (f.target.x-f.pos.x)*0.08;
    f.pos.z += (f.target.z-f.pos.z)*0.08;
  });
  s.figures.filter(f=>f.age>=f.lifespan).forEach(f=>killFigure(s,f,'寿命'));

  if (!s.figures.find(f=>f.role==='指導者') && Math.random()<0.05) spawnFigure(s,'指導者',true);

  // 邪知(corruption)が蓄積した人物がいれば、負の歴史イベントの重みを上げる
  const maxCorruption = s.figures.reduce((m,f)=>Math.max(m,f.corruption||0),0);

  // 恵み/災害の偏り継続を監視 → 無神論(恵み過多)/邪神信仰(災害過多)の圧力を蓄積
  const recent20 = s.recentActions.slice(-20);
  const blessRatio = recent20.length ? recent20.filter(a=>a==='bless').length/recent20.length : 0.5;
  if (recent20.length>=8 && blessRatio>0.85) s.entitlementStreak=(s.entitlementStreak||0)+1; else s.entitlementStreak=0;
  if (recent20.length>=8 && blessRatio<0.25) s.fearStreak=(s.fearStreak||0)+1; else s.fearStreak=0;
  if (s.entitlementStreak===12){
    s.atheismPressure = Math.min(100,(s.atheismPressure||0)+15);
    log(s, '「神は助けて当然」という思想が広まり、無神論者が現れ始めた。', 'event');
    s.entitlementStreak=0;
  }
  if (s.fearStreak===12){
    s.cultPressure = Math.min(100,(s.cultPressure||0)+15);
    log(s, '生贄の風習と邪神への囁きが、闇の中で広がり始めた。', 'event');
    s.fearStreak=0;
  }

  CONFIG.HISTORICAL_EVENTS.forEach(e=>{
    if (eraIdx < e.minEra) return;
    if (e.once && s._firedOnce && s._firedOnce[e.id]) return;
    let chance;
    if (e.corrupt){
      if (maxCorruption < 50) return;
      chance = (maxCorruption/100) * 0.01;
    } else if (e.pressureType==='atheism'){
      if ((s.atheismPressure||0) < 40) return;
      chance = (s.atheismPressure/100) * 0.015;
    } else if (e.pressureType==='cult'){
      if ((s.cultPressure||0) < 40) return;
      chance = (s.cultPressure/100) * 0.015;
    } else {
      chance = (e.w/1000) * (1+eraIdx*0.05);
    }
    if (Math.random() < chance){
      e.fx(s);
      if (e.once){ s._firedOnce = s._firedOnce||{}; s._firedOnce[e.id]=true; }
    }
  });

  if (eraIdx !== s._lastEraIdx){ log(s, `── ${CONFIG.ERAS[eraIdx].name}へ ──`, 'event'); s._lastEraIdx = eraIdx; }
}

function doMiracle(list, id){
  const def = list.find(d=>d.id===id);
  if (!def || STATE.faithPoints<def.cost) return;
  if (def.min && STATE.progress<def.min) return;
  STATE.faithPoints -= def.cost;
  def.fx(STATE);
  STATE.recentActions.push(list===CONFIG.BLESSINGS?'bless':'disaster');
  if (STATE.recentActions.length>40) STATE.recentActions.shift();
  log(STATE, `神の御業「${def.name}」が行われた。`, list===CONFIG.BLESSINGS?'':'disaster');
  renderAll();
}

function doIndividualAction(id){
  const fig = STATE.figures.find(f=>f.id===selectedFigureId);
  if (!fig) return;
  const def = CONFIG.INDIVIDUAL_ACTIONS.find(d=>d.id===id);
  if (!def || STATE.faithPoints<def.cost) return;
  STATE.faithPoints -= def.cost;
  def.fx(STATE, fig);
  renderAll();
}

function selectFigure(fig){ selectedFigureId = fig ? fig.id : null; renderAll(); }

/* ---------- 保存/読込/オフライン進行 ---------- */
/* GitHub Pages等の通常のブラウザ環境で動かすため、localStorageを使用する */
async function saveGame(silent){
  STATE.lastTimestamp = Date.now();
  try{
    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(STATE));
    if (!silent) document.getElementById('autosave-note').textContent = '保存しました — '+new Date().toLocaleTimeString();
  }catch(e){ console.error('save failed', e); if (!silent) document.getElementById('autosave-note').textContent = '保存に失敗しました(ブラウザの設定をご確認ください)'; }
}
async function loadGame(){
  try{
    const raw = localStorage.getItem(CONFIG.SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function catchUp(state){
  const elapsedMs = Date.now()-(state.lastTimestamp||Date.now());
  let ticks = Math.floor(elapsedMs/CONFIG.TICK_MS);
  if (ticks<=0) return { ticks:0 };
  const capped = Math.min(ticks, CONFIG.MAX_CATCHUP_TICKS);
  const popBefore=state.population, eraBefore=currentEraIndex(state);
  for (let i=0;i<capped;i++) simulateTick(state);
  const eraAfter=currentEraIndex(state);
  return { ticks:capped, totalTicks:ticks, popBefore, popAfter:state.population, eraBefore, eraAfter };
}

/* ---------- 2D UI描画 ---------- */
function renderAll(){
  const s = STATE;
  const eraIdx = currentEraIndex(s);
  const era = CONFIG.ERAS[eraIdx];

  document.getElementById('s-time').textContent = `${s.year}年 ${SEASON_NAMES[s.season]}`;
  document.getElementById('s-pop').textContent = s.population.toLocaleString();
  document.getElementById('s-faith-pt').textContent = Math.floor(s.faithPoints);
  document.getElementById('era-badge').textContent = era.name;
  document.getElementById('era-sub').textContent = era.sub;
  const societyLabel = CONFIG.SOCIETY_LABELS[eraIdx] || '';
  const metaParts = [societyLabel];
  if (s.religionName) metaParts.push(`信仰:「${s.religionName}」`);
  document.getElementById('era-meta').textContent = metaParts.filter(Boolean).join(' ・ ');
  document.getElementById('faith-bar').style.width = s.faithLevel+'%';

  const recent20 = s.recentActions.slice(-20);
  const blessRatio = recent20.filter(a=>a==='bless').length/Math.max(1,recent20.length);
  let balanceText = '民はまだ、あなたの存在に気づいていない。';
  if (recent20.length>=4){
    if (blessRatio>0.85) balanceText = '「神は助けて当然」— 感謝は薄れつつある。';
    else if (blessRatio<0.25) balanceText = '恐怖政治の兆し — 民は怯え、あるいは神を憎み始めている。';
    else balanceText = '恵みと試練の均衡が、信仰を確かなものにしている。';
  }
  const extra = [];
  if ((s.atheismPressure||0) >= 20) extra.push(`無神論の兆し(${Math.floor(s.atheismPressure)})`);
  if ((s.cultPressure||0) >= 20) extra.push(`邪神信仰の兆し(${Math.floor(s.cultPressure)})`);
  if (s.faithTarget==='rival') extra.push('一部の民は、あなたではない何かを崇めている');
  if (extra.length) balanceText += ' ／ ' + extra.join(' ・ ');
  document.getElementById('balance-note').textContent = balanceText;

  const bl = document.getElementById('blessing-list'); bl.innerHTML='';
  CONFIG.BLESSINGS.forEach(d=>{
    const locked = d.min && s.progress<d.min;
    const btn = document.createElement('button');
    btn.className='miracle-btn'; btn.disabled = s.faithPoints<d.cost || locked;
    btn.innerHTML = `<span>${locked?'？？？':d.name}</span><span class="cost">${d.cost}</span>`;
    btn.onclick = ()=>doMiracle(CONFIG.BLESSINGS, d.id);
    bl.appendChild(btn);
  });
  const dl = document.getElementById('disaster-list'); dl.innerHTML='';
  CONFIG.DISASTERS.forEach(d=>{
    const btn = document.createElement('button');
    btn.className='miracle-btn disaster'; btn.disabled = s.faithPoints<d.cost;
    btn.innerHTML = `<span>${d.name}</span><span class="cost">${d.cost}</span>`;
    btn.onclick = ()=>doMiracle(CONFIG.DISASTERS, d.id);
    dl.appendChild(btn);
  });

  // 選択中人物パネル
  const fp = document.getElementById('figure-panel');
  const fig = s.figures.find(f=>f.id===selectedFigureId);
  if (fig){
    fp.style.display = 'block';
    const detail = document.getElementById('figure-detail');
    detail.innerHTML = `<div class="figure-detail-name">${fig.name}</div><div class="figure-detail-role">${fig.role} ・ ${Math.floor(fig.age)}歳</div>` +
      Object.entries(fig.stats).map(([k,v])=>`<div class="stat-bar-row"><div class="k">${k}</div><div class="stat-bar-outer"><div class="stat-bar-inner" style="width:${v}%"></div></div><div class="v">${v}</div></div>`).join('') +
      (fig.corruption>0 ? `<div class="corruption-note">邪知の蓄積: ${fig.corruption}</div>` : '');
    const ia = document.getElementById('individual-actions'); ia.innerHTML='';
    CONFIG.INDIVIDUAL_ACTIONS.forEach(d=>{
      const btn = document.createElement('button');
      btn.className = 'miracle-btn '+(d.cls||''); btn.disabled = s.faithPoints<d.cost;
      btn.innerHTML = `<span>${d.name}</span><span class="cost">${d.cost}</span>`;
      btn.onclick = ()=>doIndividualAction(d.id);
      ia.appendChild(btn);
    });
  } else {
    fp.style.display = 'none';
  }

  const chron = document.getElementById('chronicle');
  chron.innerHTML = s.chronicle.slice(-60).map(e=>`<div class="chron-entry ${e.cls}"><span class="tm">${e.t}</span>${e.text}</div>`).reverse().join('');

  if (window.GenesisDeus3D){
    try{ window.GenesisDeus3D.update(s, eraIdx, CONFIG); }
    catch(e){ console.error('3D world update failed:', e); }
  }
}

function promptGodName(){
  return new Promise(resolve=>{
    const modal = document.getElementById('god-name-modal');
    const input = document.getElementById('god-name-input');
    const btn = document.getElementById('god-name-confirm');
    modal.style.display = 'flex';
    input.value = '';
    setTimeout(()=>input.focus(), 50);
    const onConfirm = ()=>{
      const val = input.value.trim();
      STATE.godName = val || '名もなき神';
      modal.style.display = 'none';
      btn.removeEventListener('click', onConfirm);
      input.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e)=>{ if (e.key==='Enter') onConfirm(); };
    btn.addEventListener('click', onConfirm);
    input.addEventListener('keydown', onKey);
  });
}

/* ---------- 初期化 ---------- */
async function init(){
  document.getElementById('reset-btn').addEventListener('click', onReset);
  document.getElementById('deselect-btn').addEventListener('click', ()=>selectFigure(null));

  if (window.GenesisDeus3D){
    try{ window.GenesisDeus3D.setup(document.getElementById('world3d-canvas'), CONFIG); }
    catch(e){ console.error('3D world failed to initialize, continuing without it:', e); }
  }

  const loaded = await loadGame();
  if (loaded){
    STATE = loaded;
    STATE._lastEraIdx = currentEraIndex(STATE);
    // 旧セーブ互換: 座標/腐敗値が無ければ補完
    STATE.figures.forEach(f=>{ if(!f.id) f.id=uid(); if(!f.pos) f.pos={x:(Math.random()-0.5)*80,z:(Math.random()-0.5)*80}; if(f.corruption===undefined) f.corruption=0; });
    if (STATE.volcanoActiveUntil===undefined) STATE.volcanoActiveUntil=-1;
    if (STATE._tickCount===undefined) STATE._tickCount=0;
    if (STATE.faithTarget===undefined) STATE.faithTarget='player';
    if (STATE.languageAcquired===undefined) STATE.languageAcquired = STATE.progress>=CONFIG.LANGUAGE_THRESHOLD;
    if (STATE.religionName===undefined) STATE.religionName=null;
    if (STATE.atheismPressure===undefined) STATE.atheismPressure=0;
    if (STATE.cultPressure===undefined) STATE.cultPressure=0;
    if (STATE._firedOnce===undefined) STATE._firedOnce={};
    const cu = catchUp(STATE);
    if (cu.ticks>0){
      const wb = document.getElementById('welcome-back');
      wb.style.display='block';
      const eraChanged = cu.eraAfter>cu.eraBefore;
      wb.innerHTML = `<b>お帰りなさい。</b> あなたが不在の間に世界は動き続けた。人口は ${cu.popBefore.toLocaleString()} → ${cu.popAfter.toLocaleString()}。`
        + (eraChanged ? ` 文明は<b>${CONFIG.ERAS[cu.eraAfter].name}</b>へ進んだ。` : '')
        + (cu.totalTicks>cu.ticks ? ` (計算負荷のため、進行の一部は圧縮されました)` : '');
    }
  } else {
    STATE = defaultState();
    STATE._lastEraIdx = 0;
    log(STATE, '世界は生まれたばかりで、まだ何もない。', 'event');
  }

  if (!STATE.godName) await promptGodName();

  renderAll();
  startLoop();
  saveGame(true);
}

function startLoop(){
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(()=>{
    try{ simulateTick(STATE); renderAll(); }
    catch(e){ console.error('tick failed:', e); }
  }, CONFIG.TICK_MS);
  setInterval(()=>saveGame(true), 15000);
}

async function onReset(){
  if (!confirm('本当に世界を終わらせますか?この行為は取り消せません。')) return;
  STATE = defaultState();
  STATE._lastEraIdx = 0;
  selectedFigureId = null;
  log(STATE, '古い世界は終わり、新たな世界が生まれた。', 'event');
  await promptGodName();
  await saveGame(true);
  renderAll();
}

return { init, selectFigure, getState:()=>STATE, getSelectedId:()=>selectedFigureId, CONFIG };

})();
