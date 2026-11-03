import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { deriveTrackDimensions, stadiumPoints } from './track-geometry.js';

const noop = () => {};
const palette = {
  wall: '#deded3', side: '#a5ada8', trim: '#f1f0e5', stone: '#bbbeb0',
  glass: '#365c68', roof: '#818f92', crown: '#9eaaac', frame: '#c6cfc9',
  grass: '#a4af88', path: '#d8d4c6', court: '#5e6b6d', courtInner: '#b2674d',
  track: '#b97055', pitch: '#8d9c73', line: '#f2e8d4', dining: '#ccb58f',
  metal: '#718278', gold: '#b69b67', trunk: '#87745b',
  seating: '#5f876e', canopy: '#dfcba3',
  hedge: '#607d48', hedgeLight:'#7e9256', garden: '#a8b98a', soil:'#796d4e',
  flowerCream:'#eee5c5',flowerGold:'#c99b54',pavilionWood: '#86513d', pavilionRoof: '#78817b',
  asphalt: '#a1aaa5', roadBase: '#bdc3bb',
};

function shapeMesh(points, material, height = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const object = new THREE.Mesh(geometry, material);
  object.position.y = height;
  object.receiveShadow = true;
  return object;
}

function line(points, material, closed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
  return closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
}

function hipRoof(group, x, z, width, depth, eave, rise, material, rimMaterial) {
  const a = width / 2;
  const b = depth / 2;
  const vertices = [
    [x - a, eave, z - b], [x + a, eave, z - b],
    [x + a, eave, z + b], [x - a, eave, z + b],
    [x, eave + rise, z - depth * 0.2], [x, eave + rise, z + depth * 0.2],
  ];
  const indices = [0, 1, 4, 1, 2, 5, 1, 5, 4, 2, 3, 5, 3, 0, 4, 3, 4, 5, 0, 3, 2, 0, 2, 1];
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  const roof = new THREE.Mesh(geometry, material);
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);
  for (const [start, end] of [[0, 4], [1, 4], [2, 5], [3, 5], [4, 5]]) {
    group.add(line([vertices[start], vertices[end]], rimMaterial));
  }
  // Standing seams follow the actual sloped metal roof, never flat slabs.
  for (let i = 1; i < 10; i += 1) {
    const t = i / 10;
    for (const sign of [-1, 1]) {
      const xx = x + sign * a * (1 - t);
      const y = eave + rise * t + 0.025;
      group.add(line([[xx, y, z - b * (1 - t) - depth * 0.2 * t],
        [xx, y, z + b * (1 - t) + depth * 0.2 * t]], rimMaterial));
    }
  }
}

function ringPoints(x, z, radius, count = 64, height = 0.42) {
  return Array.from({ length: count }, (_, i) => [x + Math.cos(i * Math.PI * 2 / count) * radius,
    height, z + Math.sin(i * Math.PI * 2 / count) * radius]);
}

export async function createCampusScene({ canvas, config: suppliedConfig, onSelect = noop,
  onReady = noop, onError = noop, onLabelsChange = noop } = {}) {
  if (!canvas) throw new Error('缺少三维画布。');
  let config;
  try {
    if (suppliedConfig) config = suppliedConfig;
    else {
      const response = await fetch(`${import.meta.env.BASE_URL}campus.json`);
      if (!response.ok) throw new Error('校园资料加载失败，请刷新重试。');
      config = await response.json();
    }
  } catch (error) { onError(error); throw error; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (error) { onError(new Error('当前设备暂时无法显示三维校园。')); throw error; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eeebe2');
  scene.fog = new THREE.Fog('#eeebe2', 550, 1100);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, 0.035);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = 0.55;
  environment.dispose();
  pmrem.dispose();

  const materials = {};
  for (const [key, color] of Object.entries(palette)) {
    materials[key] = new THREE.MeshStandardMaterial({ color,
      roughness: key === 'glass' ? 0.23 : key === 'roof' || key === 'crown' ? 0.48 : 0.78,
      metalness: key === 'glass' ? 0.48 : ['roof', 'crown', 'metal', 'gold'].includes(key) ? 0.3 : 0,
    });
  }
  materials.crown.side = THREE.DoubleSide;
  materials.canopy.side = THREE.DoubleSide;
  const markings = new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.95 });
  const roofRims = new THREE.LineBasicMaterial({ color: '#d9ddd4', transparent: true, opacity: 0.8 });
  const axisLine = new THREE.LineBasicMaterial({ color: '#999e91', transparent: true, opacity: 0.85 });
  const campus = new THREE.Group();
  campus.name = '香江路校区 · 照片推定模型';
  // Canonical plan uses x/right, y/back, z/up.  Three.js uses y/up, so
  // (x, plan-y, height) must become (x, height, -plan-y).  The model is
  // assembled in a local x/height/plan-y space, then converted here once.
  campus.scale.z = -1;
  scene.add(campus);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  const box = (key, x, height, z, w, h, d, yaw = 0) => {
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push({ x, height, z, w, h, d, yaw });
  };
  const base = config.style?.base_size || [200, 132];
  const [baseWidth, baseDepth] = base;
  const [baseCenterX,baseCenterZ]=config.style?.base_center||[0,0];
  const baseMinX=baseCenterX-baseWidth/2;
  const baseMaxX=baseCenterX+baseWidth/2;
  const baseMinZ=baseCenterZ-baseDepth/2;
  const baseMaxZ=baseCenterZ+baseDepth/2;
  const roads=Object.entries(config.roads||{}).filter(([,road])=>Array.isArray(road.position)&&Array.isArray(road.size));
  const leftRoad=config.roads?.left;
  const minSiteX=Math.min(baseMinX,...roads.map(([,r])=>r.position[0]-r.size[0]/2));
  const maxSiteX=Math.max(baseMaxX,...roads.map(([,r])=>r.position[0]+r.size[0]/2));
  const minSiteZ=Math.min(baseMinZ,...roads.map(([,r])=>r.position[1]-r.size[1]/2));
  const maxSiteZ=Math.max(baseMaxZ,...roads.map(([,r])=>r.position[1]+r.size[1]/2));
  const siteWidth=maxSiteX-minSiteX;
  const siteDepth=maxSiteZ-minSiteZ;
  const siteCenterX=(minSiteX+maxSiteX)/2;
  const siteCenterZ=(minSiteZ+maxSiteZ)/2;
  box('stone', baseCenterX, -2.35, baseCenterZ, baseWidth, 4.5, baseDepth);
  box('trim', baseCenterX, -0.22, baseCenterZ, baseWidth - 0.7, 0.38, baseDepth - 0.7);
  box('grass', baseCenterX, -0.015, baseCenterZ, baseWidth - 1.7, 0.15, baseDepth - 1.7);
  for(const [,road] of roads){
    const [rx,rz]=road.position;const [rw,rd]=road.size;
    const vertical=rd>rw;
    // One metre at each long end joins the perpendicular road plates at the
    // corners. This is a simplified street junction, not a traffic survey.
    const join=roads.length>1?2:0;
    const surfaceW=rw+(vertical?0:join);
    const surfaceD=rd+(vertical?join:0);
    box('roadBase',rx,-2.35,rz,surfaceW,4.5,surfaceD);
    box('asphalt',rx,.02,rz,surfaceW,.17,surfaceD);
    if(vertical){
      const near=Math.sign(baseCenterX-rx)||1;
      box('path',rx+near*(rw/2-1.15),.15,rz,2.3,.24,surfaceD);
      box('path',rx-near*(rw/2-.55),.15,rz,1.1,.24,surfaceD);
      for(let offset=-rd/2+4;offset<rd/2-2;offset+=8){
        box('trim',rx-near*.6,.12,rz+offset,.14,.025,3.7);
      }
    }else{
      const near=Math.sign(baseCenterZ-rz)||1;
      box('path',rx,.15,rz+near*(rd/2-1.15),surfaceW,.24,2.3);
      box('path',rx,.15,rz-near*(rd/2-.55),surfaceW,.24,1.1);
      for(let offset=-rw/2+4;offset<rw/2-2;offset+=8){
        box('trim',rx+offset,.12,rz-near*.6,3.7,.025,.14);
      }
    }
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: '#eeebe2', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.64;
  floor.receiveShadow = true;
  scene.add(floor);

  const trackConfig = config.sports?.track || {};
  const garden=config.landscape?.garden;
  const gazebo=garden?.gazebo;
  const track = deriveTrackDimensions(trackConfig);
  const trackCenter = trackConfig.position || [baseMaxX-track.outerRadius-2.4,baseCenterZ];
  const insideTrack = (x, z, extra = 1.6) => Math.hypot(x-trackCenter[0],
    Math.max(0,Math.abs(z-trackCenter[1])-track.straightLength/2))<track.outerRadius+extra;
  let pathIndex = 0;
  for (const path of config.paths || []) {
    for (let i = 1; i < path.points.length; i += 1) {
      const [ax, az] = path.points[i - 1];
      const [bx, bz] = path.points[i];
      const dx = bx - ax;
      const dz = bz - az;
      // Paths supplied in the shared layout already stop at the track boundary.
      box('path', (ax + bx) / 2, 0.12 + pathIndex * 0.001, (az + bz) / 2,
        Math.hypot(dx, dz), 0.1, path.width, -Math.atan2(dz, dx));
      pathIndex += 1;
    }
  }

  const pickables = [];
  const landmarkData = [];
  const buildingMetadata = new Map();
  const pickMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff,
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const pickBox = (id, x, h, z, w, height, depth, metadata) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(w, height, depth), pickMaterial);
    object.position.set(x, h, z);
    object.userData.id = id;
    object.renderOrder = -10;
    campus.add(object);
    pickables.push(object);
    buildingMetadata.set(id, { id, ...metadata });
  };

  for (const b of config.buildings || []) {
    const [x, z] = b.position;
    const [w, d, h] = b.size;
    const isTower = b.kind === 'tower';
    const isDining = b.id === 'left-side';
    const floors = b.floors;
    const floorH = h / floors;
    const groundOpen=b.kind==='classroom' && b.ground_floor_open?.enabled===true;
    const openWidth=groundOpen?w*THREE.MathUtils.clamp(Number(b.ground_floor_open.width_ratio)||.42,.1,.8):0;
    const label = isTower ? '中央尖顶高楼' : isDining ? '食堂及住宿楼'
      : b.id === 'left-front' ? '左侧教学楼' : b.id === 'right-front' ? '右侧教学楼'
        : b.id==='left-rear'?'左后副楼 · 7层':b.id==='right-rear'?'右后副楼 · 7层':b.name;
    const usage = isDining ? '1—2层：食堂；3—6层：住宿' : '建筑名称与具体用途待学校核对';
    pickBox(b.id, x, h / 2 + 0.7, z, w + 0.5, h + (isTower ? 20 : 2), d + 0.5,
      { name: label, floors, usage,
        description: isTower ? '中央高楼保留金属坡面尖顶、蓝灰玻璃和中央回纹装饰。' :
          isDining ? '楼体按学校补充改为6层，下方两层为食堂，上方四层为住宿。' : '依据实拍照片建立外观，楼名及间距仍可继续校正。' });
    landmarkData.push({ id: b.id, name: label, position: new THREE.Vector3(x, h + (isTower ? 12.8 : 3), z),
      kind: isDining ? 'dining' : 'building' });
    box('stone', x, 0.33, z, w + 1.2, 0.65, d + 1.2);

    if (isTower) {
      box('side', x, h / 2 + 0.4, z, w, h, d);
      box('side', x, h + 2, z, w * 0.43, 3.2, d * 0.94);
      for (const sign of [-1, 1]) {
        const faceZ = z + sign * (d / 2 + 0.1);
        for (const fraction of [-0.33, 0, 0.33]) {
          box('glass', x + w * fraction, h * 0.53, faceZ, w * (fraction ? 0.28 : 0.32), h * 0.87, 0.12);
        }
        for (let i = 0; i < 17; i += 1) {
          box('frame', x - w * 0.48 + i * w * 0.96 / 16, h * 0.53, faceZ + sign * 0.10, 0.055, h * 0.87, 0.07);
        }
        for (let i = 1; i < floors * 2; i += 1) {
          box('frame', x, i * h / (floors * 2), faceZ + sign * 0.12, w * 0.96, 0.055, 0.07);
        }
        for (const fraction of [-0.49, -0.19, 0.19, 0.49]) {
          box('trim', x + fraction * w, h / 2, faceZ + sign * 0.22, 0.65, h, 0.4);
        }
        for (const f of [0.26, 0.51, 0.73]) for (const side of [-1, 1]) {
          box('trim', x + side * w * 0.34, h * f, faceZ + sign * 0.25, w * 0.27, 0.7, 0.4);
        }
      }
      const facadeZ = z - d / 2 - 0.46;
      box('gold', x, h * 0.53, facadeZ, w * 0.29, h * 0.66, 0.12);
      box('glass', x, h * 0.53, facadeZ - 0.1, w * 0.26, h * 0.64, 0.12);
      for (let j = 0; j < 11; j += 1) {
        const bottom = h * 0.23 + j * h * 0.052;
        const stride = h * 0.035;
        const offset = (j % 2 ? -1 : 1) * w * 0.038;
        box('gold', x + (-w * 0.09 + offset) / 2, bottom, facadeZ - 0.19,
          w * 0.09 + offset, 0.085, 0.07);
        box('gold', x + offset, bottom + stride / 2, facadeZ - 0.19, 0.085, stride, 0.07);
        box('gold', x + (offset + w * 0.09) / 2, bottom + stride, facadeZ - 0.19,
          w * 0.09 - offset, 0.085, 0.07);
      }
      hipRoof(campus, x, z, w * 0.46, d * 1.02, h + 3.2, 7, materials.crown, roofRims);
      hipRoof(campus, x - w * 0.36, z, w * 0.29, d * 1.02, h + 0.15, 3.8, materials.crown, roofRims);
      hipRoof(campus, x + w * 0.36, z, w * 0.29, d * 1.02, h + 0.15, 3.8, materials.crown, roofRims);
      box('trim', x, 3.8, z - d / 2 - 1.3, 6, 7.6, 2.6);
      const archShape = new THREE.Shape();
      archShape.moveTo(-1.65, 0.25);
      archShape.lineTo(-1.65, 3.1);
      archShape.absarc(0, 3.1, 1.65, Math.PI, 0, true);
      archShape.lineTo(1.65, 0.25);
      archShape.closePath();
      const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape), materials.glass);
      arch.rotation.y = Math.PI;
      arch.position.set(x, 0, z - d / 2 - 2.62);
      campus.add(arch);
      for (let i = 0; i < 4; i += 1) box('stone', x, 0.3 - i * 0.06,
        z - d / 2 - 3 - i * 0.38, 6.8, 0.15, 0.9);
      continue;
    }

    const wallKey=b.kind === 'classroom' ? 'wall' : 'side';
    if(groundOpen){
      // A real through-opening: upper storeys and two solid ground-floor ends.
      // No full-height body, dark decal or glass plane crosses the opening.
      box(wallKey,x,.7+floorH+(h-floorH)/2,z,w,h-floorH,d);
      const endWidth=(w-openWidth)/2;
      for(const side of [-1,1]){
        box(wallKey,x+side*(openWidth/2+endWidth/2),.7+floorH/2,z,endWidth,floorH,d);
      }
      for(const fraction of [-.30,-.10,.10,.30]){
        for(const side of [-1,1]){
          box('trim',x+fraction*openWidth,.7+floorH/2,z+side*(d/2-.38),.48,floorH,.48);
        }
      }
      box('trim',x,.7+floorH-.12,z,w,.24,d);
    }else{
      box(wallKey,x,h/2+.7,z,w,h,d);
    }
    if (isDining) {
      const diningH = floorH * 2;
      for (const sign of [-1, 1]) {
        box('dining', x, diningH / 2 + 0.7, z + sign * (d / 2 + 0.04), w + 0.08, diningH, 0.12);
        box('dining', x + sign * (w / 2 + 0.04), diningH / 2 + 0.7, z, 0.12, diningH, d + 0.08);
      }
    }
    const columns = Math.max(3, Math.floor(w / 3.25));
    for (const sign of [-1, 1]) {
      for (let floorIndex = 0; floorIndex < floors; floorIndex += 1) {
        const y = 0.7 + (floorIndex + 0.53) * floorH;
        const paneH = floorH * (b.kind === 'classroom' && floorIndex < floors - 1 ? 0.72 : 0.55);
        for (let i = 0; i < columns; i += 1) {
          const xx = x - w / 2 + (i + 0.5) * w / columns;
          const paneW = Math.min(isDining && floorIndex < 2 ? 2.15 : 1.9, w / columns * 0.68);
          if(groundOpen && floorIndex===0 && Math.abs(xx-x)-(paneW+.17)/2<openWidth/2)continue;
          box('trim', xx, y, z + sign * (d / 2 + 0.09), paneW + 0.17, paneH + 0.17, 0.14);
          box('glass', xx, y, z + sign * (d / 2 + 0.18), paneW, paneH, 0.06);
          box('frame', xx, y, z + sign * (d / 2 + 0.22), 0.055, paneH, 0.04);
        }
      }
      const sideColumns = Math.max(3, Math.floor(d / 3.7));
      for (let floorIndex = 0; floorIndex < floors; floorIndex += 1) {
        for (let i = 0; i < sideColumns; i += 1) {
          const zz = z - d / 2 + (i + 0.5) * d / sideColumns;
          const y = 0.7 + (floorIndex + 0.53) * floorH;
          box('trim', x + sign * (w / 2 + 0.09), y, zz, 0.14, floorH * 0.6, 1.85);
          box('glass', x + sign * (w / 2 + 0.18), y, zz, 0.06, floorH * 0.55, 1.65);
        }
      }
    }
    for (let f = 0; f <= floors; f += 1) {
      box('trim', x, 0.7 + f * floorH, z, w + 0.28, 0.22, d + 0.28);
    }
    for (const side of [-1, 1]) {
      box('trim', x, h + 1.3, z + side * (d / 2 - 0.12), w + 0.2, 0.9, 0.24);
      box('trim', x + side * (w / 2 - 0.12), h + 1.3, z, 0.24, 0.9, d + 0.2);
    }
    box('roof', x, h + 0.8, z, w + 0.25, 0.22, d + 0.25);
    for (let i = 0; i < Math.max(2, Math.floor(w / 8)); i += 1) {
      box('stone', x - w * 0.31 + i * 7, h + 1.3, z + d * 0.2, 2.1, 0.7, 1.4);
    }
    if(!groundOpen){
      box('roof', x, 3.8, z - d / 2 - 1.2, isDining ? 7 : 5.2, 0.24, 2.5);
      box('glass', x, 1.9, z - d / 2 - 0.23, isDining ? 4.7 : 3.5, 2.4, 0.05);
      for (let i = 0; i < 3; i += 1) {
        box('stone', x, 0.42 - i * 0.1, z - d / 2 - 1.2 - i * 0.45, 5.8, 0.24, 1.0);
      }
    }
  }

  for(const connector of config.connectors||[]){
    const [cx,cz]=connector.position;const [cw,cd,ch]=connector.size;
    box('trim',cx,ch/2+.7,cz,cw,ch,cd);
    box('glass',cx,ch/2+.7,cz-cd/2-.035,cw*.72,ch*.91,.045);
    box('glass',cx,ch/2+.7,cz+cd/2+.035,cw*.72,ch*.91,.045);
    // These narrow bands only join the back wings to the central tower.
  }

  const openWalkways=config.open_walkways||[];
  const openWalkwaySegments=[];
  for(const walkway of openWalkways){
    const [wx,wz]=walkway.position;
    const [ww,wd]=walkway.size;
    const floorHeight=Number(walkway.floor_height||3.8);
    const baseHeight=Number(walkway.base_height??.8);
    const railHeight=Number(walkway.railing_height||1.1);
    const thickness=Number(walkway.deck_thickness||.18);
    const floorNumbers=walkway.floors||[2,3,4,5];
    for(const floorNumber of floorNumbers){
      const deck=baseHeight+(floorNumber-1)*floorHeight;
      // A solid walking slab, with air above it. Only narrow rails and
      // balusters occupy the edges; no wall/glass sheet closes either side.
      box('trim',wx,deck-thickness/2,wz,ww,thickness,wd);
      for(const side of [-1,1]){
        const edgeX=wx+side*(ww/2-.055);
        box('frame',edgeX,deck+railHeight,wz,.07,.075,wd);
        box('frame',edgeX,deck+railHeight*.48,wz,.045,.045,wd);
        const posts=Math.max(2,Math.ceil(wd/.95));
        for(let i=0;i<=posts;i+=1){
          const zz=wz-wd/2+i*wd/posts;
          box('frame',edgeX,deck+railHeight/2,zz,.045,railHeight,.045);
        }
        box('trim',edgeX,deck-thickness-.09,wz,.15,.18,wd);
      }
      openWalkwaySegments.push({id:walkway.id,floor:floorNumber,deckHeight:deck,position:[wx,wz],size:[ww,wd]});
    }
    // Slender columns support the stack while leaving the ground level open.
    const firstDeck=baseHeight+(Math.min(...floorNumbers)-1)*floorHeight;
    for(const side of [-1,1])for(const fraction of [-.5,0,.5]){
      box('trim',wx+side*(ww/2-.08),firstDeck/2,wz+fraction*wd,.14,firstDeck,.14);
    }
  }

  // Enlarged, mathematically constrained 250 m oval reaches the outer boundary.
  const trackOuter = shapeMesh(stadiumPoints(track.outerRadius + 0.35, track.straightLength), materials.stone, 0.17);
  trackOuter.position.x = trackCenter[0]; trackOuter.position.z = trackCenter[1]; campus.add(trackOuter);
  const trackSurface = shapeMesh(stadiumPoints(track.outerRadius, track.straightLength), materials.track, 0.22);
  trackSurface.position.x = trackCenter[0]; trackSurface.position.z = trackCenter[1]; campus.add(trackSurface);
  const trackInfield = shapeMesh(stadiumPoints(track.radius, track.straightLength), materials.pitch, 0.25);
  trackInfield.position.x = trackCenter[0]; trackInfield.position.z = trackCenter[1]; campus.add(trackInfield);
  for (let lane = 0; lane <= track.laneCount; lane += 1) {
    campus.add(line(stadiumPoints(track.radius + lane * track.laneWidth, track.straightLength)
      .map(([x, z]) => [x + trackCenter[0], 0.27, z + trackCenter[1]]), markings, true));
  }
  const [tx, tz] = trackCenter;
  const fieldW = Math.min(25, track.radius * 1.5);
  const fieldD = Math.min(59, track.straightLength * 0.8);
  campus.add(line([[tx-fieldW/2,.28,tz-fieldD/2],[tx+fieldW/2,.28,tz-fieldD/2],
    [tx+fieldW/2,.28,tz+fieldD/2],[tx-fieldW/2,.28,tz+fieldD/2]], markings, true));
  campus.add(line([[tx-fieldW/2,.28,tz],[tx+fieldW/2,.28,tz]], markings));
  campus.add(line(ringPoints(tx, tz, 4, 64, .28), markings, true));
  for (const sign of [-1,1]) {
    const goalZ = tz + sign * fieldD / 2;
    box('trim', tx-2, 1.1, goalZ, .1, 2.2, .1);
    box('trim', tx+2, 1.1, goalZ, .1, 2.2, .1);
    box('trim', tx, 2.2, goalZ, 4.1, .1, .1);
  }
  // A single finish stripe across all lanes; lane count is a modelling default.
  for (let lane = 0; lane < track.laneCount; lane += 1) {
    const stripeX = tx + track.radius + (lane + .5) * track.laneWidth;
    box('trim', stripeX, .275, tz - track.straightLength * .24, track.laneWidth - .04, .015, .18);
  }
  landmarkData.push({ id: 'track', name: '250米跑道', position: new THREE.Vector3(tx, 2.5, tz+4), kind: 'track' });
  pickBox('track', tx, .15, tz, track.outerWidth, .3, track.outerLength,
    { name:'250米跑道', floors:null, usage:'250米一圈，跑道延伸至校园外侧边缘',
      description:'依据学校补充按250米测量线重建；道数、道宽与实际半径暂为可调整的示意参数。' });

  // Photo-guided green terrace and cream tensile canopy, on the teaching-block
  // side of the oval.  The full structure stays outside the running lanes.
  const grandstand=config.sports?.grandstand;
  if(grandstand){
    const [gx,gz]=grandstand.position;
    const [gw,gd,gh]=grandstand.size;
    box('trim',gx,.15,gz,gw+.15,.3,gd+.4);
    const aisles=[[-gd/2,-gd*.25-.45],[-gd*.25+.45,gd*.25-.45],[gd*.25+.45,gd/2]];
    for(let i=0;i<3;i+=1){
      const stepW=gw*(1-i*.27);
      const centerX=gx-gw/2+stepW/2;
      const top=.26+(i+1)*.24;
      for(const [low,high] of aisles){
        box('seating',centerX,top/2,gz+(low+high)/2,stepW,top,high-low);
      }
      for(const aisle of [-gd*.25,gd*.25]){
        box('track',centerX,top/2+.005,gz+aisle,stepW,top,.8);
      }
    }
    const backX=gx-gw*.34;
    for(const offset of [-gd*.40,-gd*.13,gd*.13,gd*.40]){
      box('trim',backX,.82,gz+offset,.42,1.15,.50);
      box('gold',backX,gh*.63,gz+offset,.09,gh*.7,.09);
    }
    const roofBack=gx-gw/2-.22;
    const roofFront=gx+gw/2+.22;
    const roofLow=gh+.18;
    const roofHigh=gh+.42;
    const roofVertices=[roofBack,roofLow,gz-gd/2-.5, roofFront,roofHigh,gz-gd/2-.5,
      roofFront,roofHigh,gz+gd/2+.5, roofBack,roofLow,gz+gd/2+.5];
    const roofGeometry=new THREE.BufferGeometry();
    roofGeometry.setAttribute('position',new THREE.Float32BufferAttribute(roofVertices,3));
    roofGeometry.setIndex([0,1,2,0,2,3]);roofGeometry.computeVertexNormals();
    const canopy=new THREE.Mesh(roofGeometry,materials.canopy);
    canopy.castShadow=canopy.receiveShadow=true;campus.add(canopy);
    for(const offset of [-gd*.40,-gd*.13,gd*.13,gd*.40]){
      campus.add(line([[roofBack,roofLow-.04,gz+offset],[roofFront,roofHigh-.04,gz+offset]],roofRims));
      campus.add(line([[backX,gh*.44,gz+offset],[roofFront-.25,roofHigh-.06,gz+offset]],roofRims));
    }
    landmarkData.push({id:'grandstand',name:'主席台',position:new THREE.Vector3(gx,gh+2.2,gz),kind:'grandstand'});
    pickBox('grandstand',gx,gh/2,gz,gw+.5,gh+.5,gd+.5,
      {name:'主席台',floors:null,usage:'靠近教学楼一侧，面向250米跑道',
        description:'依据学校说明与实拍照片补充绿色台阶、平台、立柱及米色雨棚。尺寸和细节为简化表达。'});
  }

  // The legacy pair describes broad front-field zones. Once explicit courts
  // exist, render only the four lengthwise courts rather than doubling them.
  const frontCourts=Array.isArray(config.sports?.front_courts)?config.sports.front_courts:[];
  const courtEntries=frontCourts.length
    ? [...frontCourts.map((court,i)=>[`front-court-${i+1}`,court]),
       ...(config.sports?.basketball_rear?[['basketball_rear',config.sports.basketball_rear]]:[])]
    : Object.entries(config.sports||{}).filter(([key])=>key.startsWith('basketball'));
  for (const [key, court] of courtEntries) {
    const [x,z] = court.position;
    const [w,d] = court.size;
    const halfCourt=court.mode==='half';
    box('stone', x, .18, z, w+.65, .26, d+.65);
    box('court', x, .34, z, w, .10, d);
    if(halfCourt){
      // Shared canonical orientation: the sole hoop is at the +plan-y end,
      // and the half-court opens towards -plan-y, as in the Blender scene.
      const baseline=z+d/2-.6;
      box('courtInner',x,.405,baseline-2.9,4.9,.02,5.8);
      box('metal',x,1.7,baseline-.1,.14,3.0,.14);
      box('trim',x,3.4,baseline-.4,1.7,1.0,.11);
      const hoop=new THREE.Mesh(new THREE.TorusGeometry(.29,.025,5,16),materials.courtInner);
      hoop.rotation.x=Math.PI/2;hoop.position.set(x,3.15,baseline-.85);campus.add(hoop);
    }else if(court.orientation==='y'){
      for(const side of [-1,1]){
        box('courtInner',x,.405,z+side*(d/2-4.1),4.9,.02,6.1);
        const hoopZ=z+side*(d/2-1.2);
        box('metal',x,1.7,hoopZ,.14,3.0,.14);
        box('trim',x,3.4,hoopZ-side*.35,1.7,1.0,.11);
        const hoop=new THREE.Mesh(new THREE.TorusGeometry(.29,.025,5,16),materials.courtInner);
        hoop.rotation.x=Math.PI/2;hoop.position.set(x,3.15,hoopZ-side*.68);campus.add(hoop);
      }
    }else{
      for (const side of [-1,1]) {
        box('courtInner', x+side*(w/2-4.3), .405, z, 6.8, .02, 6.1);
        const hoopX = x+side*(w/2-1.2);
        box('metal', hoopX, 1.7, z, .14, 3.0, .14);
        box('trim', hoopX-side*.35, 3.4, z, .11, 1.0, 1.7);
        const hoop=new THREE.Mesh(new THREE.TorusGeometry(.29,.025,5,16),materials.courtInner);
        hoop.rotation.x=Math.PI/2;hoop.position.set(hoopX-side*.68,3.15,z);campus.add(hoop);
      }
    }
    campus.add(line([[x-w/2+.55,.42,z-d/2+.55],[x+w/2-.55,.42,z-d/2+.55],
      [x+w/2-.55,.42,z+d/2-.55],[x-w/2+.55,.42,z+d/2-.55]],markings,true));
    if(halfCourt){
      const baseline=z+d/2-.6;
      const basketZ=baseline-.85;
      const freeThrowZ=baseline-5.8;
      campus.add(line([[x-2.45,.425,baseline],[x-2.45,.425,freeThrowZ],
        [x+2.45,.425,freeThrowZ],[x+2.45,.425,baseline]],markings));
      const threeRadius=Math.min(6.35,w*.40);
      const threeArc=Array.from({length:65},(_,i)=>{
        const angle=-Math.PI/2+i*Math.PI/64;
        return[x+Math.sin(angle)*threeRadius,.425,basketZ-Math.cos(angle)*threeRadius];
      });
      campus.add(line(threeArc,markings));
      campus.add(line([[x-threeRadius,.425,baseline],[x-threeRadius,.425,basketZ]],markings));
      campus.add(line([[x+threeRadius,.425,baseline],[x+threeRadius,.425,basketZ]],markings));
      campus.add(line(Array.from({length:33},(_,i)=>{
        const angle=-Math.PI/2+i*Math.PI/32;
        return[x+Math.sin(angle)*1.65,.425,freeThrowZ-Math.cos(angle)*1.65];
      }),markings));
      const halfLine=z-d/2+.55;
      campus.add(line(Array.from({length:33},(_,i)=>{
        const angle=i*Math.PI/32;
        return[x+Math.cos(angle)*1.65,.425,halfLine+Math.sin(angle)*1.65];
      }),markings));
    }else{
      if(court.orientation==='y'){
        campus.add(line([[x-w/2+.55,.42,z],[x+w/2-.55,.42,z]],markings));
        for(const side of [-1,1]){
          const baseline=z+side*(d/2-.55);
          const hoopZ=baseline-side*.85;
          const freeZ=baseline-side*5.8;
          campus.add(line([[x-2.45,.425,baseline],[x-2.45,.425,freeZ],
            [x+2.45,.425,freeZ],[x+2.45,.425,baseline]],markings));
          campus.add(line(Array.from({length:65},(_,i)=>{
            const a=-Math.PI/2+i*Math.PI/64;
            return[x+Math.sin(a)*6.25,.425,hoopZ-side*Math.cos(a)*6.25];
          }),markings));
          for(const sign of [-1,1])campus.add(line([[x+sign*6.25,.425,baseline],[x+sign*6.25,.425,hoopZ]],markings));
          campus.add(line(Array.from({length:33},(_,i)=>{
            const a=-Math.PI/2+i*Math.PI/32;
            return[x+Math.sin(a)*1.7,.425,freeZ-side*Math.cos(a)*1.7];
          }),markings));
        }
      }else campus.add(line([[x,.42,z-d/2+.55],[x,.42,z+d/2-.55]],markings));
      campus.add(line(ringPoints(x,z,1.7,48,.42),markings,true));
    }
    if(key==='basketball_rear'){
      landmarkData.push({id:'basketball-rear',name:court.name||'后侧篮球场',
        position:new THREE.Vector3(x,2.4,z),kind:'court'});
      pickBox('basketball-rear',x,.25,z,w,.5,d,
        {name:court.name||'后侧篮球场',floors:null,usage:`右后7层副楼后方的篮球${halfCourt?'半场':'场'}`,
          description:halfCourt?'已按学校补充制作单篮架半场，包含禁区、罚球线及三分弧，位于右后7层副楼后方。局部尺寸仍为示意比例。':'已按学校补充移至右后7层副楼后方，前后教学楼之间保留空地。球场尺寸和局部细节仍为示意比例。'});
    }
  }

  if(garden){
    const [gx,gz]=garden.position;
    const [gw,gd]=garden.size;
    box('stone',gx,.17,gz,gw+.4,.34,gd+.4);
    box('garden',gx,.36,gz,gw,.08,gd);
    const edgeZ=gz-gd/2;
    // Perimeter footpaths and an open central entrance distinguish a garden
    // from another generic lawn patch. Paths remain below low hedging.
    for(const sign of [-1,1]){
      box('path',gx+sign*(gw/2-2.0),.43,gz,1.3,.07,gd-3.0);
      box('path',gx,.43,gz+sign*(gd/2-2.0),gw-3.0,.07,1.3);
      box('hedge',gx+sign*(gw/2-.7),.88,gz,1.0,.90,gd-1);
      box('hedge',gx+sign*(gw/4+1.2),.88,edgeZ+.7,gw/2-3.2,.90,1.0);
    }
    box('hedge',gx,.88,gz+gd/2-.7,gw-1,.90,1.0);
    const pavilionPosition=gazebo?.position||garden.position;
    const [px,pz]=pavilionPosition;
    const pathLength=Math.max(1,pz-edgeZ);
    box('path',px,.44,edgeZ+pathLength/2,1.8,.08,pathLength+.3);
    for(const side of [-1,1]){
      box('path',gx+side*gw*.23,.44,pz,gw*.46,.08,1.3);
      box('stone',gx+side*gw*.28,.59,gz-gd*.23,6.2,.4,3.8);
      box('hedge',gx+side*gw*.28,.97,gz-gd*.23,5.7,.45,3.3);
      // Simple pale planting patches; plant species are deliberately not named.
      box('garden',gx+side*gw*.28,1.23,gz-gd*.23,4.9,.1,2.6);
    }
    if(gazebo){
      const radius=Number(gazebo.radius||4);
      const height=Number(gazebo.height||5);
      box('stone',px,.55,pz,radius*1.60,.28,radius*1.60);
      const eave=height*.70;
      const postOffset=radius*.64;
      for(const sx of [-1,1])for(const sz of [-1,1]){
        box('pavilionWood',px+sx*postOffset,(eave+.65)/2,pz+sz*postOffset,.19,eave-.65,.19);
      }
      const roofRise=height-eave;
      const roof=new THREE.Mesh(new THREE.ConeGeometry(radius*1.34,roofRise,4),materials.pavilionRoof);
      roof.position.set(px,eave+roofRise/2,pz);roof.rotation.y=Math.PI/4;
      roof.castShadow=roof.receiveShadow=true;campus.add(roof);
      const roofHalf=radius*.9475;
      for(const side of [-1,1]){
        box('pavilionWood',px+side*postOffset,.98,pz,.57,.21,postOffset*1.9);
        box('pavilionWood',px+side*postOffset,1.42,pz,.08,.10,postOffset*1.9);
        box('pavilionWood',px+side*postOffset,eave-.06,pz,.17,.22,postOffset*2.1);
        box('pavilionWood',px,eave-.06,pz+side*postOffset,postOffset*2.1,.22,.17);
        for(let i=0;i<7;i+=1){
          const slot=-postOffset*.85+i*postOffset*1.7/6;
          box('pavilionWood',px+side*postOffset,1.2,pz+slot,.06,.45,.06);
          box('pavilionWood',px+side*postOffset,eave-.58,pz+slot,.06,.66,.06);
          box('pavilionWood',px+slot,eave-.58,pz+side*postOffset,.06,.66,.06);
        }
        for(const band of [eave-.90,eave-.56,eave-.24]){
          box('pavilionWood',px+side*postOffset,band,pz,.06,.06,postOffset*2);
          box('pavilionWood',px,band,pz+side*postOffset,postOffset*2,.06,.06);
        }
      }
      box('pavilionWood',px,.98,pz+postOffset,postOffset*1.9,.21,.57);
      // Four pointed grey-tile roof faces, red-brown posts, upper lattice and
      // benches follow the actual 良知亭 photo; tiny inscriptions are omitted.
      for(let i=1;i<8;i+=1){
        const t=i/8;const a=roofHalf*(1-t);const y=eave+roofRise*t+.02;
        campus.add(line([[px-a,y,pz-a],[px+a,y,pz-a],[px+a,y,pz+a],[px-a,y,pz+a]],roofRims,true));
      }
    }
    landmarkData.push({id:'garden',name:garden.name||'后花园',
      position:new THREE.Vector3(px,(gazebo?.height||4)+2.1,pz),kind:'garden'});
    pickBox('garden',gx,(gazebo?.height||4)/2,gz,gw,gazebo?.height||4,gd,
      {name:garden.name||'后花园',floors:null,usage:'左后7层副楼后方，花园内有良知亭',
        description:'花园位于左后7层副楼后方，前后教学楼之间保留空地。已参考良知亭实拍制作红棕木柱、木格坐凳和灰瓦尖顶。局部尺寸仍为简化比例。'});
  }

  // Forecourt paving retains the recognisable central axis from the photographs.
  for (const z of [-37,-25,-13,-1,11]) {
    campus.add(line([[-3.5,.25,z],[3.5,.25,z],[3.5,.25,z+7],[-2,.25,z+7],
      [-2,.25,z+2],[1.5,.25,z+2],[1.5,.25,z+5]],axisLine));
  }
  box('side',0,.6,-13,3.4,1.2,3.4);
  box('stone',0,2.4,-13,.78,2.5,.68);
  const statueHead=new THREE.Mesh(new THREE.SphereGeometry(.42,12,8),materials.stone);
  statueHead.position.set(0,4,-13);statueHead.castShadow=true;campus.add(statueHead);

  const trees=(config.trees || []).filter(([x,z]) => !insideTrack(x,z,.5)
    && (!gazebo || Math.hypot(x-gazebo.position[0],z-gazebo.position[1])>gazebo.radius+1.5));
  const trunkGeometry=new THREE.CylinderGeometry(.18,.25,1,7);
  const leafGeometry=new THREE.IcosahedronGeometry(1,1);
  const treeMaterials=['#4f6c42','#72874e','#5d7a49'].map(color=>new THREE.MeshStandardMaterial({color,roughness:.97}));
  const dummy=new THREE.Object3D();
  const trunks=new THREE.InstancedMesh(trunkGeometry,materials.trunk,trees.length*3);
  trunks.castShadow=true;
  const canopyParts=[[],[],[]];
  trees.forEach(([x,z],i)=>{
    const compact=x>109;
    const avenue=Math.abs(Math.abs(x)-7.3)<.2;
    const radius=compact?1.1:avenue?1.80:2.08+(i%4)*.10;
    const trunkHeight=compact?3.0:avenue?3.7:2.8+(i%3)*.26;
    dummy.position.set(x,trunkHeight/2+.12,z);dummy.rotation.set(0,0,0);
    dummy.scale.set(1,trunkHeight,1);dummy.updateMatrix();trunks.setMatrixAt(i*3,dummy.matrix);
    for(const [j,sign] of [[1,-1],[2,1]]){
      dummy.position.set(x+sign*.34,trunkHeight-.25,z+(i%2?sign*.20:0));
      dummy.rotation.set(0,(i%3)*.7,sign*.55);dummy.scale.set(.50,1.3,.50);
      dummy.updateMatrix();trunks.setMatrixAt(i*3+j,dummy.matrix);
    }
    // Overlapping rounded lobes give a broad, irregular crown, rather than
    // stretching one sphere into the old egg-shaped tree silhouette.
    const lobes=[[0,1.02,0,.88,.72,.88],[-.61,.65,.12,.66,.63,.67],
      [.55,.63,-.14,.68,.61,.68],[.02,1.57,.08,.66,.66,.64]];
    for(const [dx,dy,dz,sx,sy,sz] of lobes)canopyParts[i%3].push({
      x:x+dx*radius,y:trunkHeight+dy*radius*.62,z:z+dz*radius,
      sx:sx*radius,sy:sy*radius,sz:sz*radius,rotation:i*.71});
    // Circular tree pits match the avenue photos; perimeter trees grow in lawn.
    if(avenue)box('stone',x,.12,z,2.55,.20,2.55);
  });
  trunks.instanceMatrix.needsUpdate=true;
  campus.add(trunks);
  for(let t=0;t<3;t+=1){
    const items=canopyParts[t];
    const leaves=new THREE.InstancedMesh(leafGeometry,treeMaterials[t],items.length);
    leaves.castShadow=leaves.receiveShadow=true;
    items.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.sx,p.sy,p.sz);
      dummy.rotation.set(0,p.rotation,0);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);});
    leaves.instanceMatrix.needsUpdate=true;
    campus.add(leaves);
  }
  const plantings=config.landscape?.plantings||[];
  const shrubParts=[];const flowerParts=[[],[]];
  for(const patch of plantings){
    const [px,pz]=patch.position;const [pw,pd]=patch.size;
    const baseHeight=patch.base_height||.14;const height=patch.height||.65;
    if(patch.kind==='flowerbed'){
      box('soil',px,baseHeight+.07,pz,pw,.14,pd);
      box('hedge',px,baseHeight+.16,pz,pw,.18,pd);
      const columns=Math.max(2,Math.floor(pw/1.15));const rows=Math.max(1,Math.floor(pd/.8));
      for(let row=0;row<rows;row+=1)for(let column=0;column<columns;column+=1){
        const xx=px-pw/2+(column+.5)*pw/columns;
        const zz=pz-pd/2+(row+.5)*pd/rows;
        flowerParts[(row+column)%2].push([xx,baseHeight+height,zz,.14+(column%3)*.025]);
      }
    }else{
      box('hedge',px,baseHeight+height*.43,pz,pw,height*.86,pd);
      const count=Math.max(2,Math.ceil(Math.max(pw,pd)/1.2));
      for(let i=0;i<count;i+=1){
        const offset=(i+.5)/count-.5;
        shrubParts.push([px+(pw>=pd?offset*pw:0),baseHeight+height*.82,
          pz+(pd>pw?offset*pd:0),Math.min(pw,pd)*.55,height*.34]);
      }
    }
  }
  if(shrubParts.length){
    const shrubs=new THREE.InstancedMesh(leafGeometry,materials.hedgeLight,shrubParts.length);
    shrubs.castShadow=shrubs.receiveShadow=true;
    shrubParts.forEach(([x,y,z,r,ry],i)=>{dummy.position.set(x,y,z);dummy.rotation.set(0,i*.6,0);
      dummy.scale.set(r,ry,r);dummy.updateMatrix();shrubs.setMatrixAt(i,dummy.matrix);});
    shrubs.instanceMatrix.needsUpdate=true;campus.add(shrubs);
  }
  for(const [index,key] of ['flowerCream','flowerGold'].entries()){
    if(!flowerParts[index].length)continue;
    const flowers=new THREE.InstancedMesh(leafGeometry,materials[key],flowerParts[index].length);
    flowerParts[index].forEach(([x,y,z,r],i)=>{dummy.position.set(x,y,z);dummy.rotation.set(0,i,0);
      dummy.scale.set(r,r*.65,r);dummy.updateMatrix();flowers.setMatrixAt(i,dummy.matrix);});
    flowers.instanceMatrix.needsUpdate=true;campus.add(flowers);
  }
  const fenceEnd=baseMaxX-3;
  const fenceZ=baseMinZ+5;
  for(let x=baseMinX+4;x<=fenceEnd;x+=2){
    if(Math.abs(x)>7 && !insideTrack(x,fenceZ,.25)) box('metal',x,1.15,fenceZ,.09,2.3,.09);
  }
  for(const [left,right] of [[baseMinX+4,-7],[7,Math.min(fenceEnd,trackCenter[0]-track.outerRadius-1)]]) {
    box('metal',(left+right)/2,1.9,fenceZ,right-left,.09,.09);
  }
  box('trim',-7,1.9,fenceZ,1.3,3.8,1.3);
  box('trim',7,1.9,fenceZ,1.3,3.8,1.3);

  // One draw per material for the hundreds of repeated walls, frames and panes.
  for (const [key, parts] of batches) {
    const mesh=new THREE.InstancedMesh(boxGeometry,materials[key],parts.length);
    mesh.name=`校园细节 · ${key}`;
    mesh.castShadow=key!=='glass' && key!=='grass' && key!=='path';
    mesh.receiveShadow=true;
    for(let i=0;i<parts.length;i+=1){
      const p=parts[i];dummy.position.set(p.x,p.height,p.z);dummy.rotation.set(0,p.yaw,0);dummy.scale.set(p.w,p.h,p.d);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingSphere();
    campus.add(mesh);
  }

  const hemi=new THREE.HemisphereLight('#f7f4df','#9f9f8c',2.1);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff1d4',3.5);sun.position.set(-85,150,90);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-155,right:155,top:145,bottom:-145,near:1,far:420});
  sun.shadow.normalBias=.035;sun.shadow.bias=-.00012;sun.shadow.radius=3;
  scene.add(sun);
  const fill=new THREE.DirectionalLight('#dfe8ef',1.2);fill.position.set(130,80,-110);scene.add(fill);
  const camera=new THREE.OrthographicCamera(-150,150,110,-110,.1,1800);
  camera.position.set(siteCenterX+170,145,195-siteCenterZ);
  camera.zoom=.90;
  const controls=new OrbitControls(camera,canvas);
  controls.target.set(siteCenterX,9,-siteCenterZ);controls.enableDamping=true;controls.dampingFactor=.065;
  controls.minZoom=.58;controls.maxZoom=4.5;controls.minPolarAngle=.04;controls.maxPolarAngle=Math.PI*.48;
  controls.autoRotateSpeed=.65;controls.enablePan=true;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  controls.update();
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let labelsEnabled=true;
  let disposed=false;
  let frame=0;
  let transition=null;
  let lastLabelTime=-Infinity;
  let size={width:1,height:1};
  let activeView='hero';
  const selection=new THREE.Group();selection.visible=false;campus.add(selection);
  let selectionLines=null;
  const highlightMat=new THREE.LineBasicMaterial({color:'#b17647',transparent:true,opacity:.95});
  const select=(id)=>{
    const metadata=buildingMetadata.get(id);
    if(!metadata){selection.visible=false;onSelect(null);return;}
    if(selectionLines){selection.remove(selectionLines);selectionLines.geometry.dispose();}
    const b=(config.buildings||[]).find(b=>b.id===id);
    const source=b||({grandstand,garden,'basketball-rear':config.sports?.basketball_rear})[id];
    const [x,z]=source?source.position:trackCenter;
    const [w,d]=source?source.size:[track.outerWidth,track.outerLength];
    selectionLines=line([[x-w/2-.7,.48,z-d/2-.7],[x+w/2+.7,.48,z-d/2-.7],
      [x+w/2+.7,.48,z+d/2+.7],[x-w/2-.7,.48,z+d/2+.7]],highlightMat,true);
    selection.add(selectionLines);selection.visible=true;onSelect(metadata);
  };
  const getLandmarks=()=>landmarkData.map(({position,...rest})=>{
    const p=campus.localToWorld(position.clone()).project(camera);
    return {...rest,x:(p.x*.5+.5)*size.width,y:(-.5*p.y+.5)*size.height,
      visible:labelsEnabled && p.z>-1 && p.z<1 && p.x>-.97 && p.x<.97 && p.y>-.92 && p.y<.92};
  });
  const resize=()=>{
    const bounds=canvas.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    size={width:bounds.width,height:bounds.height};
    renderer.setSize(bounds.width,bounds.height,false);
    const aspect=bounds.width/bounds.height;
    const height=Math.max(175,siteDepth*1.18,siteWidth*1.16/aspect);
    camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;
    camera.updateProjectionMatrix();lastLabelTime=-Infinity;
  };
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  const animateCamera=(position,target,zoom=1)=>{
    controls.autoRotate=false;
    if(reducedMotion){camera.position.copy(position);controls.target.copy(target);camera.zoom=zoom;camera.updateProjectionMatrix();controls.update();return;}
    transition={start:performance.now(),position:camera.position.clone(),target:controls.target.clone(),zoom:camera.zoom,
      endPosition:position,endTarget:target,endZoom:zoom};
  };
  const setView=(view='hero')=>{
    activeView=view;
    const views={hero:[[siteCenterX+170,145,195-siteCenterZ],[siteCenterX,9,-siteCenterZ],.90],
      front:[[siteCenterX+8,98,235-siteCenterZ],[siteCenterX,16,-siteCenterZ],1.05],
      top:[[siteCenterX,280,.1-siteCenterZ],[siteCenterX,0,-siteCenterZ],1],
      rear:[[siteCenterX-145,120,-maxSiteZ-150],[0,12,-58],1.1],
      track:[[175,155,125],[tx,0,-tz],1.4]};
    const chosen=views[view]||views.hero;
    animateCamera(new THREE.Vector3(...chosen[0]),new THREE.Vector3(...chosen[1]),chosen[2]);
  };
  const pointerStart=()=>{transition=null;};controls.addEventListener('start',pointerStart);
  const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();let pointerDown=null;
  const pointerDownHandler=(event)=>{pointerDown={x:event.clientX,y:event.clientY};};
  const pointerUpHandler=(event)=>{
    if(!pointerDown || Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>7){pointerDown=null;return;}
    pointerDown=null;const bounds=canvas.getBoundingClientRect();
    pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(pickables,false)[0];select(hit?.object.userData.id);
  };
  canvas.addEventListener('pointerdown',pointerDownHandler);canvas.addEventListener('pointerup',pointerUpHandler);
  const contextLost=(event)=>{event.preventDefault();cancelAnimationFrame(frame);onError(new Error('三维显示暂时中断，请刷新页面重试。'));};
  canvas.addEventListener('webglcontextlost',contextLost,false);
  const animate=(time)=>{
    if(disposed)return;
    frame=requestAnimationFrame(animate);
    if(transition){
      const p=Math.min(1,(time-transition.start)/1050);const t=1-(1-p)**3;
      camera.position.lerpVectors(transition.position,transition.endPosition,t);
      controls.target.lerpVectors(transition.target,transition.endTarget,t);
      camera.zoom=THREE.MathUtils.lerp(transition.zoom,transition.endZoom,t);camera.updateProjectionMatrix();
      if(p===1)transition=null;
    }
    controls.update();renderer.render(scene,camera);
    if(time-lastLabelTime>45){lastLabelTime=time;onLabelsChange(getLandmarks());}
  };
  frame=requestAnimationFrame(animate);
  const controller={
    setView,
    setAutoRotate(value){transition=null;controls.autoRotate=Boolean(value)&&!reducedMotion;},
    setLabels(value){labelsEnabled=Boolean(value);onLabelsChange(getLandmarks());},
    setFocus(id){
      select(id);activeView='focus';
      const b=(config.buildings||[]).find(b=>b.id===id);
      if(b){const [x,z]=b.position;const h=b.size[2];
        const position=campus.localToWorld(new THREE.Vector3(x+75,78,z-100));
        const target=campus.localToWorld(new THREE.Vector3(x,h*.42,z));
        animateCamera(position,target,1.8);}
      else if(id==='track')setView('track');
      else if(id==='grandstand'&&grandstand){
        const [gx,gz]=grandstand.position;
        animateCamera(campus.localToWorld(new THREE.Vector3(gx+55,46,gz-52)),
          campus.localToWorld(new THREE.Vector3(gx,grandstand.size[2]*.5,gz)),2.35);
      }
      else if(id==='garden'&&garden){
        const [gx,gz]=garden.position;
        animateCamera(campus.localToWorld(new THREE.Vector3(gx-62,66,gz+65)),
          campus.localToWorld(new THREE.Vector3(gx,2,gz)),2.2);
      }
      else if(id==='basketball-rear'&&config.sports?.basketball_rear){
        const [cx,cz]=config.sports.basketball_rear.position;
        animateCamera(campus.localToWorld(new THREE.Vector3(cx+63,72,cz+65)),
          campus.localToWorld(new THREE.Vector3(cx,.5,cz)),config.sports.basketball_rear.mode==='half'?3.1:2.1);
      }
    },
    reset(){select(null);setView('hero');},
    getLandmarks,
    getStats(){return{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      buildings:(config.buildings||[]).length,trackLap:track.lapLength,trackMeasuredLap:track.measuredLap,
      frontCourtCount:frontCourts.length||courtEntries.filter(([key])=>key!=='basketball_rear').length,
      frontCourtOrientations:frontCourts.map(c=>c.orientation||'x'),
      frontCourts:frontCourts.map(c=>({id:c.id,position:c.position,size:c.size,orientation:c.orientation,hoopCount:2})),
      trees:trees.length,treeCount:trees.length,treeCanopyLobes:trees.length*4,
      plantings:{count:plantings.length,hedges:plantings.filter(p=>p.kind!=='flowerbed').length,
        flowerbeds:plantings.filter(p=>p.kind==='flowerbed').length},
      trackLapLength:track.lapLength,cafeteriaFloors:[1,2],
      buildingDetails:(config.buildings||[]).map(b=>({id:b.id,floors:b.floors,floorUsage:b.floor_usage||{}})),
      groundFloorOpenIds:(config.buildings||[]).filter(b=>b.kind==='classroom'&&b.ground_floor_open?.enabled===true).map(b=>b.id),
      base:{size:base,center:[baseCenterX,baseCenterZ],bounds:{minX:baseMinX,maxX:baseMaxX,minY:baseMinZ,maxY:baseMaxZ}},
      openWalkways:{count:openWalkwaySegments.length,floors:[...new Set(openWalkwaySegments.map(s=>s.floor))].sort((a,b)=>a-b),segments:openWalkwaySegments},
      connectors:(config.connectors||[]).map(c=>({id:c.id,position:c.position,size:c.size})),
      leftRoad:leftRoad?{position:leftRoad.position,size:leftRoad.size}:null,
      roads:Object.fromEntries(roads.map(([id,r])=>[id,{position:r.position,size:r.size}])),roadCount:roads.length,
      siteBounds:{minX:minSiteX,maxX:maxSiteX,minY:minSiteZ,maxY:maxSiteZ},
      grandstand:grandstand?{position:grandstand.position,size:grandstand.size,facing:'track'}:null,
      rearBasketball:config.sports?.basketball_rear?{position:config.sports.basketball_rear.position,size:config.sports.basketball_rear.size,
        mode:config.sports.basketball_rear.mode||'full',orientation:config.sports.basketball_rear.mode==='half'?'+y':null,
        hoopCount:config.sports.basketball_rear.mode==='half'?1:2}:null,
      garden:garden?{position:garden.position,size:garden.size,gazebo:gazebo?{position:gazebo.position,radius:gazebo.radius,height:gazebo.height,appearance:'simplified'}:null}:null,
      trackOuterSize:[track.outerWidth,track.outerLength],leftFloors:(config.buildings||[]).find(b=>b.id==='left-side')?.floors,
      roofType:'pointed-pitched',view:activeView};},
    dispose(){
      if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();
      canvas.removeEventListener('pointerdown',pointerDownHandler);canvas.removeEventListener('pointerup',pointerUpHandler);
      canvas.removeEventListener('webglcontextlost',contextLost);controls.removeEventListener('start',pointerStart);
      const geometries=new Set();const allMaterials=new Set();
      scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])if(m)allMaterials.add(m);});
      for(const g of geometries)g.dispose();for(const m of allMaterials)m.dispose();
      environmentMap.dispose();renderer.dispose();onLabelsChange([]);
    },
  };
  renderer.render(scene,camera);onLabelsChange(getLandmarks());onReady({stats:controller.getStats(),landmarks:getLandmarks()});
  return controller;
}
