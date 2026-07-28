/* =========================================================
   GENESIS DEUS — world3d.js
   Three.js による3D世界描画:地形・川・海・火山・時代ごとの町並み・
   クリック可能な著名人物・個別に歩き回る一般人口
   ========================================================= */

window.GenesisDeus3D = (function(){

let renderer, scene, camera, controls, clock;
let terrainMesh;
let figureMeshes = new Map(); // figureId -> THREE.Group
let settlementGroup;
let builtSettlements = {}; // key -> buildingCount built so far
let volcanoMesh, volcanoLight, smokeGroup;
let seaMesh, seaTexture;
let sunLight, ambientLight;
let landmarkMesh, landmarkTier = -1;
let focusTarget = new THREE.Vector3(0,0,0);
let noiseGrid = [];
const NOISE_N = 28;
let R = 80;
let SETTLEMENTS = [];

let villagerMesh = null;
let villagerState = []; // {x,z,tx,tz,speed}
let villagerCount = 0;
const villagerDummy = new THREE.Object3D();

const ROLE_COLOR = { '指導者':0xd4af6a, '大祭司':0x7fd1d9, '学者':0x9adba0, '戦士':0xa6392e, '商人':0xc9a0dc };

/* ---------- ノイズ地形 ---------- */
function seedNoise(){
  noiseGrid = [];
  for (let i=0;i<=NOISE_N;i++){ const row=[]; for (let j=0;j<=NOISE_N;j++) row.push(Math.random()); noiseGrid.push(row); }
}
function clampIdx(i){ return Math.max(0, Math.min(NOISE_N, i)); }
function rawNoise(x,z){
  const gx = ((x+R)/(2*R))*NOISE_N, gz=((z+R)/(2*R))*NOISE_N;
  const x0=Math.floor(gx), z0=Math.floor(gz), x1=clampIdx(x0+1), z1=clampIdx(z0+1);
  const sx=gx-x0, sz=gz-z0;
  const n00=noiseGrid[clampIdx(x0)][clampIdx(z0)], n10=noiseGrid[x1][clampIdx(z0)];
  const n01=noiseGrid[clampIdx(x0)][z1], n11=noiseGrid[x1][z1];
  const nx0=n00+(n10-n00)*sx, nx1=n01+(n11-n01)*sx;
  return nx0+(nx1-nx0)*sz;
}
function heightAt(x,z){
  const d = Math.sqrt(x*x+z*z)/R;
  const flatten = Math.min(1, d*1.6);
  let h = (rawNoise(x,z)-0.5)*22 + (rawNoise(x*0.4+40,z*0.4+40)-0.5)*8;
  h *= flatten;
  const edge = Math.max(0, d-0.82)/0.18;
  h -= edge*edge*30;
  return h;
}
function biomeColor(h){
  if (h < -2) return new THREE.Color(0x1a3a4a);
  if (h < 1)  return new THREE.Color(0x3f6b3a);
  if (h < 6)  return new THREE.Color(0x5c6b3a);
  if (h < 12) return new THREE.Color(0x6b5a42);
  return new THREE.Color(0xcfd4d8);
}
function buildTerrain(){
  const seg = 90;
  const geo = new THREE.PlaneGeometry(R*2, R*2, seg, seg);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i);
    const h = heightAt(x, y);
    pos.setZ(i, h);
    const c = biomeColor(h);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.95, metalness:0.02, flatShading:true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  return mesh;
}

/* ---------- 海(手続き的テクスチャで揺らぎを表現) ---------- */
function makeWaveTexture(){
  const c = document.createElement('canvas'); c.width=128; c.height=128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2f6a86'; ctx.fillRect(0,0,128,128);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth=2;
  for (let y=8;y<128;y+=16){
    ctx.beginPath();
    for (let x=0;x<=128;x+=4){ const yy=y+Math.sin((x/128)*Math.PI*4)*4; if (x===0) ctx.moveTo(x,yy); else ctx.lineTo(x,yy); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8,8);
  return tex;
}
function buildSea(){
  seaTexture = makeWaveTexture();
  const geo = new THREE.PlaneGeometry(R*4, R*4);
  const mat = new THREE.MeshStandardMaterial({ map:seaTexture, color:0x6f9bb0, transparent:true, opacity:0.85, roughness:0.25, metalness:0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.position.y = -3;
  return mesh;
}

/* ---------- 川・火山 ---------- */
function buildRiver(){
  const paths = [
    [[-10,-5],[-6,10],[2,28],[10,48],[16,68]],
    [[8,-2],[20,-14],[34,-22],[48,-30],[62,-40]],
  ];
  const group = new THREE.Group();
  paths.forEach(pts=>{
    const vecs = pts.map(([x,z])=> new THREE.Vector3(x, heightAt(x,z)+0.35, z));
    const curve = new THREE.CatmullRomCurve3(vecs);
    const geo = new THREE.TubeGeometry(curve, 40, 1.1, 6, false);
    const mat = new THREE.MeshStandardMaterial({ color:0x3a7fa8, roughness:0.3, metalness:0.1, transparent:true, opacity:0.9, map:seaTexture });
    group.add(new THREE.Mesh(geo, mat));
  });
  return group;
}
function buildVolcano(){
  const vx=-38, vz=42;
  const base = heightAt(vx,vz);
  const geo = new THREE.ConeGeometry(14, 26, 7);
  const mat = new THREE.MeshStandardMaterial({ color:0x3a2e2a, roughness:0.9, emissive:0x000000 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(vx, base+11, vz);
  volcanoLight = new THREE.PointLight(0xff5522, 0, 60);
  volcanoLight.position.set(vx, base+22, vz);
  mesh.add(volcanoLight);

  smokeGroup = new THREE.Group();
  const smokeMat = new THREE.PointsMaterial({ color:0x8a8478, size:3.5, transparent:true, opacity:0 });
  const smokePos = [];
  for (let i=0;i<24;i++) smokePos.push((Math.random()-0.5)*4, i*1.2, (Math.random()-0.5)*4);
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(smokePos,3));
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.position.set(vx, base+24, vz);
  smokeGroup.add(smoke);
  smokeGroup.userData.mat = smokeMat;
  smokeGroup.userData.base = base;
  return mesh;
}

/* ---------- 世界の中心にある祭壇/都(時代とともに姿を変える) ---------- */
function buildLandmark(tier){
  const group = new THREE.Group();
  const h = heightAt(0,6);
  if (tier === 0){ // 石器〜狩猟: 石の輪と焚き火の跡
    const ringMat = new THREE.MeshStandardMaterial({ color:0x7a7468, roughness:1.0 });
    for (let i=0;i<8;i++){
      const ang = (i/8)*Math.PI*2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8,0), ringMat);
      stone.position.set(Math.cos(ang)*4, 0.6, 6+Math.sin(ang)*4);
      group.add(stone);
    }
  } else if (tier === 1){ // 農耕〜村落: 土の祠
    const mound = new THREE.Mesh(new THREE.ConeGeometry(3.2,3,10), new THREE.MeshStandardMaterial({ color:0x8a6a42, roughness:1.0 }));
    mound.position.set(0,1.5,6); group.add(mound);
  } else if (tier === 2){ // 都市〜王国: 神殿(列柱)
    const base = new THREE.Mesh(new THREE.BoxGeometry(9,1,7), new THREE.MeshStandardMaterial({ color:0xcfc7b6, roughness:0.8 }));
    base.position.set(0,0.5,6); group.add(base);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(9.6,0.6,7.6), new THREE.MeshStandardMaterial({ color:0xb8ae98, roughness:0.8 }));
    roof.position.set(0,5.6,6); group.add(roof);
    const colMat = new THREE.MeshStandardMaterial({ color:0xe4dcc8, roughness:0.6 });
    [[-3.8,3.2],[3.8,3.2],[-3.8,8.8],[3.8,8.8]].forEach(([dx,dz])=>{
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.45,5,10), colMat);
      col.position.set(dx,3,dz); group.add(col);
    });
  } else if (tier === 3){ // 帝国〜大航海: 宮殿(ドーム)
    const base = new THREE.Mesh(new THREE.BoxGeometry(11,6,9), new THREE.MeshStandardMaterial({ color:0x9a8f7a, roughness:0.75 }));
    base.position.set(0,3,6); group.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4,16,12,0,Math.PI*2,0,Math.PI/2), new THREE.MeshStandardMaterial({ color:0xd4af6a, roughness:0.4, metalness:0.4 }));
    dome.position.set(0,6,6); group.add(dome);
  } else if (tier === 4){ // 産業革命〜近代: 議事堂ふうの建物+尖塔
    const base = new THREE.Mesh(new THREE.BoxGeometry(12,7,10), new THREE.MeshStandardMaterial({ color:0x6f6a62, roughness:0.6, metalness:0.2 }));
    base.position.set(0,3.5,6); group.add(base);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3,1.2,8,8), new THREE.MeshStandardMaterial({ color:0x9a9488, roughness:0.5 }));
    spire.position.set(0,11,6); group.add(spire);
  } else { // 現代: ガラスの尖塔
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8,3,22,12), new THREE.MeshStandardMaterial({ color:0x3d5266, roughness:0.2, metalness:0.6, emissive:0x1a2430, emissiveIntensity:0.5 }));
    tower.position.set(0,11,6); group.add(tower);
    const beacon = new THREE.PointLight(0xffffff, 1.2, 30);
    beacon.position.set(0,23,6); group.add(beacon);
  }
  group.position.y = h;
  return group;
}
function ensureLandmark(eraIdx){
  const tier = eraIdx<=1?0 : eraIdx<=3?1 : eraIdx<=6?2 : eraIdx<=9?3 : 4;
  if (tier === landmarkTier) return;
  if (landmarkMesh) scene.remove(landmarkMesh);
  landmarkMesh = buildLandmark(tier);
  scene.add(landmarkMesh);
  landmarkTier = tier;
}

/* ---------- 時代ごとに様式が変わる建物 ---------- */
function buildBuilding(eraIdx, x, z){
  const h = heightAt(x,z);
  const group = new THREE.Group();
  const size = 1.1 + Math.random()*1.3;
  if (eraIdx <= 1){ // 竪穴住居・テント
    const geo = new THREE.ConeGeometry(size*1.1, size*1.6, 7);
    const mat = new THREE.MeshStandardMaterial({ color:0x7a5f3a, roughness:1.0 });
    const m = new THREE.Mesh(geo, mat); m.position.y = size*0.8;
    group.add(m);
  } else if (eraIdx <= 4){ // 木造+茅葺屋根
    const body = new THREE.Mesh(new THREE.BoxGeometry(size,size,size), new THREE.MeshStandardMaterial({ color:0xb08a5a, roughness:0.9 }));
    body.position.y = size*0.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(size*0.85, size*0.8, 4), new THREE.MeshStandardMaterial({ color:0x6b4530, roughness:1.0 }));
    roof.position.y = size+size*0.4; roof.rotation.y = Math.PI/4;
    group.add(body, roof);
  } else if (eraIdx <= 6){ // 石造+塔(王国・帝国)
    const body = new THREE.Mesh(new THREE.BoxGeometry(size*1.1,size*1.6,size*1.1), new THREE.MeshStandardMaterial({ color:0x8f8a80, roughness:0.85 }));
    body.position.y = size*0.8;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(size*0.4,size*0.45,size*2.2,8), new THREE.MeshStandardMaterial({ color:0x736e64, roughness:0.85 }));
    tower.position.set(size*0.7, size*1.1, 0);
    group.add(body, tower);
  } else if (eraIdx <= 8){ // 煉瓦・煙突(大航海〜産業革命)
    const body = new THREE.Mesh(new THREE.BoxGeometry(size*1.3,size*1.5,size*1.1), new THREE.MeshStandardMaterial({ color:0x8a4a3a, roughness:0.8 }));
    body.position.y = size*0.75;
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(size*0.15,size*0.15,size*1.4,6), new THREE.MeshStandardMaterial({ color:0x4a3a32, roughness:0.8 }));
    chimney.position.set(size*0.4, size*1.6, size*0.3);
    group.add(body, chimney);
  } else { // 近代・現代:ガラス張りの高層ビル
    const height = size*2.6 + Math.random()*size*1.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(size,height,size), new THREE.MeshStandardMaterial({ color:0x3d5266, roughness:0.25, metalness:0.5, emissive:0x1a2430, emissiveIntensity:0.4 }));
    body.position.y = height*0.5;
    group.add(body);
  }
  group.position.set(x, h, z);
  group.rotation.y = Math.random()*Math.PI*2;
  return group;
}

function initSettlements(){
  SETTLEMENTS = [
    { key:'capital', pos:{x:0,z:6},  minLevel:1 },
    { key:'riverA',  pos:{x:4,z:30}, minLevel:2 },
    { key:'riverB',  pos:{x:36,z:-24},minLevel:3 },
    { key:'foothill',pos:{x:-30,z:34},minLevel:4 },
    { key:'far',     pos:{x:52,z:20}, minLevel:6 },
  ];
  builtSettlements = {};
}
function ensureSettlements(eraIdx, CONFIG){
  const level = CONFIG.ERAS[eraIdx].settlement;
  SETTLEMENTS.forEach(st=>{
    if (level < st.minLevel) return;
    const desired = Math.min(14, (level - st.minLevel + 1) * 3);
    const have = builtSettlements[st.key] || 0;
    if (have >= desired) return;
    for (let i=have;i<desired;i++){
      const ox = st.pos.x + (Math.random()-0.5)*10;
      const oz = st.pos.z + (Math.random()-0.5)*10;
      settlementGroup.add(buildBuilding(eraIdx, ox, oz));
    }
    builtSettlements[st.key] = desired;
  });
}

/* ---------- 著名な人物(役職ごとの装飾つき) ---------- */
function addRoleAccessory(group, role, color){
  const accMat = new THREE.MeshStandardMaterial({ color:0xd4af6a, roughness:0.4, metalness:0.5 });
  if (role==='指導者'){
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.55,0.7,6), accMat);
    crown.position.y = 4.7; group.add(crown);
  } else if (role==='大祭司'){
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,3.4,6), new THREE.MeshStandardMaterial({ color:0x5c4a2e }));
    staff.position.set(1.2,2.2,0); staff.rotation.z = 0.15; group.add(staff);
  } else if (role==='学者'){
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.15,0.45), new THREE.MeshStandardMaterial({ color:0x9adba0 }));
    book.position.set(0.6,2.0,0.5); group.add(book);
  } else if (role==='戦士'){
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.15,1.7,0.15), new THREE.MeshStandardMaterial({ color:0xcfd4d8, metalness:0.7, roughness:0.3 }));
    sword.position.set(1.1,2.0,0); sword.rotation.z = 0.5; group.add(sword);
  } else if (role==='商人'){
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.75,0.85,0.5), new THREE.MeshStandardMaterial({ color:0x6b4530 }));
    pack.position.set(0,2.0,-0.9); group.add(pack);
  }
}
function makeFigureMesh(fig){
  const group = new THREE.Group();
  const color = ROLE_COLOR[fig.role] || 0xaaaaaa;
  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.1,3.2,8), bodyMat);
  body.position.y = 1.8;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.0,10,10), bodyMat);
  head.position.y = 4.0;
  group.add(body, head);
  addRoleAccessory(group, fig.role, color);
  group.userData.figureId = fig.id;
  group.userData.bodyMat = bodyMat;
  group.userData.baseColor = color;
  return group;
}
function syncFigures(state){
  const present = new Set();
  state.figures.forEach(fig=>{
    present.add(fig.id);
    let g = figureMeshes.get(fig.id);
    if (!g){ g = makeFigureMesh(fig); scene.add(g); figureMeshes.set(fig.id, g); }
    const h = heightAt(fig.pos.x, fig.pos.z);
    g.position.set(fig.pos.x, h, fig.pos.z);
    if (fig.corruption>0){
      const t = Math.min(1, fig.corruption/100);
      g.userData.bodyMat.color.copy(new THREE.Color(g.userData.baseColor)).lerp(new THREE.Color(0x6b3a8a), t);
    }
  });
  for (const [id, g] of figureMeshes){
    if (!present.has(id)){ scene.remove(g); figureMeshes.delete(id); }
  }
}

/* ---------- 一般人口:個別に歩き回るInstancedMesh ---------- */
function randomVillagerState(){
  const ang = Math.random()*Math.PI*2, r = Math.random()*R*0.75;
  return { x:Math.cos(ang)*r, z:Math.sin(ang)*r, tx:Math.cos(ang)*r, tz:Math.sin(ang)*r, speed:1.2+Math.random()*1.6 };
}
function rebuildVillagerMesh(){
  if (villagerMesh){ scene.remove(villagerMesh); villagerMesh.geometry.dispose(); villagerMesh.material.dispose(); }
  if (villagerCount<=0){ villagerMesh=null; return; }
  const geo = new THREE.CylinderGeometry(0.4,0.55,2.0,6);
  const mat = new THREE.MeshStandardMaterial({ color:0xcbbfa8, roughness:0.95 });
  villagerMesh = new THREE.InstancedMesh(geo, mat, villagerCount);
  scene.add(villagerMesh);
}
function setVillagerCount(count){
  count = Math.max(6, Math.min(70, count));
  if (count === villagerCount) return;
  while (villagerState.length < count) villagerState.push(randomVillagerState());
  while (villagerState.length > count) villagerState.pop();
  villagerCount = count;
  rebuildVillagerMesh();
}
function stepVillagers(dt){
  if (!villagerMesh) return;
  villagerState.forEach((v,i)=>{
    const dx=v.tx-v.x, dz=v.tz-v.z, d=Math.hypot(dx,dz);
    if (d<1.5){
      const ang=Math.random()*Math.PI*2, r=Math.random()*R*0.75;
      v.tx=Math.cos(ang)*r; v.tz=Math.sin(ang)*r;
    } else {
      v.x += (dx/d)*v.speed*dt;
      v.z += (dz/d)*v.speed*dt;
    }
    villagerDummy.position.set(v.x, heightAt(v.x,v.z)+1.05, v.z);
    villagerDummy.rotation.y = Math.atan2(dx,dz);
    villagerDummy.updateMatrix();
    villagerMesh.setMatrixAt(i, villagerDummy.matrix);
  });
  villagerMesh.instanceMatrix.needsUpdate = true;
}

/* ---------- public API ---------- */
function setup(canvas, CONFIG){
  R = CONFIG.WORLD_RADIUS;
  seedNoise();
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0e14, 0.0075);

  const parent = canvas.parentElement;
  camera = new THREE.PerspectiveCamera(48, parent.clientWidth/parent.clientHeight, 0.1, 1000);
  camera.position.set(0, 95, 130);

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(parent.clientWidth, parent.clientHeight);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 40;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI*0.49;
  controls.target.set(0,0,0);

  ambientLight = new THREE.AmbientLight(0x445566, 0.7);
  scene.add(ambientLight);
  sunLight = new THREE.DirectionalLight(0xffe8c0, 1.0);
  sunLight.position.set(70, 110, 40);
  scene.add(sunLight);

  seaMesh = buildSea();
  scene.add(seaMesh);
  terrainMesh = buildTerrain();
  scene.add(terrainMesh);
  scene.add(buildRiver());
  volcanoMesh = buildVolcano();
  scene.add(volcanoMesh);
  scene.add(smokeGroup);
  settlementGroup = new THREE.Group();
  scene.add(settlementGroup);
  initSettlements();
  ensureLandmark(0);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('click', onClick);

  animate();
}

function onResize(){
  const parent = renderer.domElement.parentElement;
  camera.aspect = parent.clientWidth/parent.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(parent.clientWidth, parent.clientHeight);
}
function onClick(ev){
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((ev.clientX-rect.left)/rect.width)*2-1,
    -((ev.clientY-rect.top)/rect.height)*2+1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, camera);
  const targets = [...figureMeshes.values()].flatMap(g=>g.children);
  const hits = ray.intersectObjects(targets, false);
  if (hits.length){
    const group = hits[0].object.parent;
    const state = window.GenesisDeus.getState();
    const fig = state.figures.find(f=>f.id===group.userData.figureId);
    if (fig) window.GenesisDeus.selectFigure(fig);
  }
}

const SEASON_LIGHT = [
  { sun:0xffe8c0, sunI:1.0,  amb:0.7,  fog:0x0b0e14 }, // 春
  { sun:0xfff2d0, sunI:1.15, amb:0.75, fog:0x10130f }, // 夏
  { sun:0xffb870, sunI:0.9,  amb:0.6,  fog:0x14100a }, // 秋
  { sun:0xcfd8e8, sunI:0.75, amb:0.55, fog:0x0d1018 }, // 冬
];
function applySeasonLight(season){
  const cfg = SEASON_LIGHT[season] || SEASON_LIGHT[0];
  if (sunLight){ sunLight.color.setHex(cfg.sun); sunLight.intensity = cfg.sunI; }
  if (ambientLight){ ambientLight.intensity = cfg.amb; }
  if (scene && scene.fog){ scene.fog.color.setHex(cfg.fog); }
}

function update(state, eraIdx, CONFIG){
  ensureSettlements(eraIdx, CONFIG);
  ensureLandmark(eraIdx);
  syncFigures(state);
  setVillagerCount(Math.round(state.population/50));
  applySeasonLight(state.season);

  const erupting = (state.volcanoActiveUntil||-1) > (state._tickCount||0);
  if (volcanoLight) volcanoLight.intensity = erupting ? 3.5 : 0;
  if (smokeGroup) smokeGroup.userData.mat.opacity = erupting ? 0.6 : 0.12;

  const selId = window.GenesisDeus.getSelectedId && window.GenesisDeus.getSelectedId();
  const selFig = selId ? state.figures.find(f=>f.id===selId) : null;
  if (selFig) focusTarget.set(selFig.pos.x, heightAt(selFig.pos.x, selFig.pos.z), selFig.pos.z);
  else focusTarget.set(0,0,0);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, clock.getDelta());
  controls.target.lerp(focusTarget, 0.03);
  controls.update();
  stepVillagers(dt);
  if (seaTexture){ seaTexture.offset.x += dt*0.015; seaTexture.offset.y += dt*0.01; }
  if (smokeGroup){
    const pts = smokeGroup.children[0];
    const arr = pts.geometry.attributes.position.array;
    for (let i=0;i<arr.length;i+=3){ arr[i+1] += dt*1.2; if (arr[i+1] > 30) arr[i+1] = 0; }
    pts.geometry.attributes.position.needsUpdate = true;
  }
  renderer.render(scene, camera);
}

return { setup, update };

})();
