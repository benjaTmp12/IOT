'use strict';

// =========================================================================
// CAPA DE PRESENTACIÓN · GEMELO DIGITAL 3D (THREE.JS / WEBGL)
// Geometría 1:1 de la maqueta física real:
// - Base 30 × 30 cm | Altura ~20 cm
// - Bodega delantera (28 × 21 cm) + Zona trasera Arduino/Protoboard
// - Puerta frontal al medio | Ventanas centradas en ambas paredes laterales
// - Techo con bisagra posterior que se abre hacia arriba
// =========================================================================
window.Blackbox.DigitalTwin3D = (() => {
  const { Bus, COMPONENT_DB, Domain } = window.Blackbox;
  const T = window.THREE;

  const container = document.getElementById('threeStage');
  const scene = new T.Scene();
  scene.background = new T.Color('#091419');

  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  if ('SRGBColorSpace' in T) renderer.outputColorSpace = T.SRGBColorSpace;
  if ('ACESFilmicToneMapping' in T) {
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
  }
  container.appendChild(renderer.domElement);

  const camera = new T.PerspectiveCamera(40, 16 / 9, 0.5, 260);

  // Lighting
  scene.add(new T.HemisphereLight('#e4f7f4', '#162c34', 1.75));
  const sunLight = new T.DirectionalLight('#fff5e0', 2.6);
  sunLight.position.set(22, 38, 28);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 2, far: 95 });
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);

  const rimLight = new T.DirectionalLight('#68c8b9', 0.95);
  rimLight.position.set(-24, 20, -22);
  scene.add(rimLight);

  const indoorCeilingLight = new T.PointLight('#fff6db', 1.4, 34);
  indoorCeilingLight.position.set(0, 16.5, 3.5);
  scene.add(indoorCeilingLight);

  const alarmLight = new T.PointLight('#ff293b', 0, 32);
  alarmLight.position.set(0, 12, 3.5);
  scene.add(alarmLight);

  const matCache = {};
  function getMat(color, rough = 0.6, metal = 0.1, opacity = 1) {
    const key = `${color}_${rough}_${metal}_${opacity}`;
    if (!matCache[key]) {
      matCache[key] = new T.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: metal,
        transparent: opacity < 1,
        opacity
      });
    }
    return matCache[key];
  }

  function makeWoodMaterial(baseHex, grainHex, knotHex, opts = {}) {
    const {
      repeatX = 1.6,
      repeatY = 1.6,
      roughness = 0.8,
      metalness = 0.03,
      opacity = 1,
      verticalGrain = false
    } = opts;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');

    g.fillStyle = baseHex;
    g.fillRect(0, 0, 512, 512);

    // Subtly varied wood plank bands
    for (let i = 0; i < 42; i++) {
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
      if (verticalGrain) g.fillRect(i * 12.2, 0, 7, 512);
      else g.fillRect(0, i * 12.2, 512, 7);
    }

    // Organic wood grain fibers
    g.strokeStyle = grainHex;
    for (let i = 0; i < 160; i++) {
      const pos = (i * 3.2) % 512;
      const amp = 2 + (i % 5);
      const freq = 0.015 + (i % 7) * 0.002;
      g.globalAlpha = 0.14 + (i % 6) * 0.04;
      g.lineWidth = (i % 4 === 0) ? 2.1 : 1.0;
      g.beginPath();
      for (let t = 0; t <= 512; t += 16) {
        const wave = Math.sin(t * freq + i) * amp;
        const x = verticalGrain ? pos + wave : t;
        const y = verticalGrain ? t : pos + wave;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }

    // Small natural timber knots
    g.globalAlpha = 0.22;
    g.fillStyle = knotHex;
    for (const [kx, ky, rx, ry] of [[120, 145, 16, 6], [385, 340, 20, 7], [250, 440, 12, 5]]) {
      g.beginPath();
      g.ellipse(verticalGrain ? ky : kx, verticalGrain ? kx : ky, verticalGrain ? ry : rx, verticalGrain ? rx : ry, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    const tex = new T.CanvasTexture(c);
    if ('SRGBColorSpace' in T) tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = T.RepeatWrapping;
    tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);

    return new T.MeshStandardMaterial({
      map: tex,
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity
    });
  }

  const clickableMeshes = [];
  function registerCompMesh(mesh, compId) {
    mesh.userData.compId = compId;
    clickableMeshes.push(mesh);
    return mesh;
  }

  function addBoxMesh(w, h, d, x, y, z, matOrHex, parent = scene, compId = null) {
    const mat = typeof matOrHex === 'string' ? getMat(matOrHex) : matOrHex;
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (compId) registerCompMesh(mesh, compId);
    return mesh;
  }

  function addCylMesh(rt, rb, h, x, y, z, matOrHex, parent = scene, compId = null) {
    const mat = typeof matOrHex === 'string' ? getMat(matOrHex) : matOrHex;
    const mesh = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 24), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (compId) registerCompMesh(mesh, compId);
    return mesh;
  }

  function addWireCurve(points, hexColor, radius = 0.09, compId = null) {
    const vecs = points.map(p => new T.Vector3(...p));
    const curve = new T.CatmullRomCurve3(vecs);
    const geo = new T.TubeGeometry(curve, 28, radius, 8, false);
    const mesh = new T.Mesh(geo, getMat(hexColor, 0.4, 0.1));
    mesh.castShadow = true;
    scene.add(mesh);
    if (compId) registerCompMesh(mesh, compId);
    return mesh;
  }

  function makeCalloutTexture(title, subtitle, accent = '#e2b458') {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 148;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10, 23, 29, 0.94)';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.strokeRect(3, 3, c.width - 6, c.height - 6);
    g.fillStyle = accent;
    g.fillRect(0, 0, 14, c.height);
    g.fillStyle = accent;
    g.font = '700 22px Inter, Segoe UI, sans-serif';
    g.fillText(title, 30, 48);
    g.fillStyle = '#f2f7f5';
    g.font = '700 31px JetBrains Mono, Consolas, monospace';
    g.fillText(subtitle, 30, 102);

    const tex = new T.CanvasTexture(c);
    if ('SRGBColorSpace' in T) tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  function add3DCallout(title, subtitle, x, y, z, compId, accent = '#e2b458') {
    const tex = makeCalloutTexture(title, subtitle, accent);
    const mat = new T.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new T.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(5.0, 1.44, 1);
    sprite.renderOrder = 12;
    scene.add(sprite);
    if (compId) registerCompMesh(sprite, compId);
    return sprite;
  }

  function addFloorRuler(text, w, h, x, y, z, rotY = 0) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(15, 34, 42, 0.85)';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#68938b';
    g.lineWidth = 4;
    g.strokeRect(2, 2, c.width - 4, c.height - 4);
    g.fillStyle = '#cbe0dc';
    g.font = '700 32px Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new T.CanvasTexture(c);
    if ('SRGBColorSpace' in T) tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: true }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotY;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  // -----------------------------------------------------------------------
  // 1. BASEBOARD 30 × 30 CM EN MADERA + BODEGA + ZONA TRASERA + PUERTA 8 CM
  // -----------------------------------------------------------------------
  const studioGrid = new T.GridHelper(72, 36, '#244b57', '#132a32');
  studioGrid.position.y = -1.42;
  scene.add(studioGrid);

  // Materiales procedurales de madera natural (terciado / pino / roble)
  const baseRimWoodMat = makeWoodMaterial('#633d20', '#422611', '#321c0b', { repeatX: 2.2, repeatY: 0.6, roughness: 0.72 });
  const baseTopWoodMat = makeWoodMaterial('#9a693f', '#744a27', '#583518', { repeatX: 2.2, repeatY: 2.2, roughness: 0.78 });
  const rearWoodMat = makeWoodMaterial('#754a29', '#523118', '#3c210e', { repeatX: 2.0, repeatY: 1.0, roughness: 0.8 });
  const floorWoodMat = makeWoodMaterial('#b58453', '#8f5f35', '#6e4523', { repeatX: 2.0, repeatY: 1.8, roughness: 0.82 });
  const trimWoodMat = makeWoodMaterial('#6c4223', '#492a14', '#331c0b', { repeatX: 1.0, repeatY: 2.5, roughness: 0.74, verticalGrain: true });
  const wallMatMain = makeWoodMaterial('#deb278', '#b88348', '#8d5d2b', { repeatX: 1.6, repeatY: 1.4, roughness: 0.8, opacity: 0.96 });
  const wallMatFront = makeWoodMaterial('#d5a66c', '#ae783e', '#865726', { repeatX: 1.4, repeatY: 1.4, roughness: 0.78, opacity: 0.95 });
  const roofWoodMat = makeWoodMaterial('#c89256', '#9d6834', '#75491e', { repeatX: 1.8, repeatY: 1.6, roughness: 0.78 });
  const doorWoodMat = makeWoodMaterial('#a46838', '#75431c', '#532d0f', { repeatX: 1.0, repeatY: 1.6, roughness: 0.74, verticalGrain: true });
  const shelfWoodMat = makeWoodMaterial('#8f5d35', '#683f1e', '#4c2c12', { repeatX: 1.5, repeatY: 1.0, roughness: 0.8 });
  const winGlassMat = getMat('#8be3da', 0.14, 0.1, 0.26);

  // Square 30 x 30 Wooden Baseboard
  addBoxMesh(30.8, 1.4, 30.8, 0, -0.7, 0, baseRimWoodMat);
  addBoxMesh(30.0, 0.25, 30.0, 0, 0.05, 0, baseTopWoodMat);

  addFloorRuler('← FRENTE MADERA: 30 cm · PUERTA 8 cm →', 15.6, 1.6, 0, 0.02, 16.5);
  addFloorRuler('← FONDO MADERA: 30 cm →', 12.0, 1.6, -17.2, 0.02, 0, Math.PI / 2);
  addFloorRuler('ZONA ARDUINO + PROTOBOARD (ATRÁS)', 16.0, 1.4, 0, 0.21, -13.6);

  // Rear Electronics Bay Wooden Deck (Z: -14.5 to -7.2)
  addBoxMesh(28.0, 0.18, 7.2, 0, 0.2, -10.8, rearWoodMat);

  // Bodega Wooden Plank Floor (X: -14 to +14, Z: -7.0 to +14.0 -> center Z = +3.5, depth = 21.0)
  addBoxMesh(28.0, 0.18, 21.0, 0, 0.2, 3.5, floorWoodMat);
  for (let ix = -12; ix <= 12; ix += 3.5) {
    addBoxMesh(0.05, 0.02, 20.6, ix, 0.3, 3.5, '#6e4726');
  }
  for (let iz = -6; iz <= 13; iz += 4) {
    addBoxMesh(27.6, 0.02, 0.04, 0, 0.3, iz, '#784e2b');
  }

  // Wooden Corner Posts (height ~20 cm -> Y: 0.2 to 20.0)
  const WALL_H = 19.6;
  const WALL_Y = 0.2 + WALL_H / 2; // 10.0
  for (const [cx, cz] of [[-13.8, -7.0], [13.8, -7.0], [-13.8, 13.8], [13.8, 13.8]]) {
    addBoxMesh(0.82, WALL_H + 0.2, 0.82, cx, WALL_Y, cz, trimWoodMat);
  }

  // Back wooden wall separating Bodega from Rear Electronics (Z = -7.0)
  addBoxMesh(27.6, WALL_H, 0.45, 0, WALL_Y, -7.0, wallMatMain);

  // Symmetrical Side Wooden Walls with CENTERED Window (center Z = +3.5)
  function buildSideWallWithCenterWindow(xPos) {
    // Back segment (Z: -7.0 to -0.5 -> len 6.5, center -3.75)
    addBoxMesh(0.48, WALL_H, 6.5, xPos, WALL_Y, -3.75, wallMatMain);
    // Front segment (Z: +7.5 to +14.0 -> len 6.5, center +10.75)
    addBoxMesh(0.48, WALL_H, 6.5, xPos, WALL_Y, 10.75, wallMatMain);
    // Under window (Z: -0.5 to +7.5 -> len 8.0, Y: 0.2 to 6.2 -> h 6.0)
    addBoxMesh(0.48, 6.0, 8.0, xPos, 3.2, 3.5, wallMatMain);
    // Above window (Y: 14.2 to 19.8 -> h 5.6)
    addBoxMesh(0.48, 5.6, 8.0, xPos, 17.0, 3.5, wallMatMain);
    // Wooden window frame & acrylic pane (center Z = 3.5, Y = 10.2)
    addBoxMesh(0.62, 0.42, 8.3, xPos, 6.2, 3.5, trimWoodMat);
    addBoxMesh(0.62, 0.42, 8.3, xPos, 14.2, 3.5, trimWoodMat);
    addBoxMesh(0.62, 8.2, 0.38, xPos, 10.2, -0.5, trimWoodMat);
    addBoxMesh(0.62, 8.2, 0.38, xPos, 10.2, 7.5, trimWoodMat);
    const glass = addBoxMesh(0.14, 7.6, 7.6, xPos, 10.2, 3.5, winGlassMat);
    glass.castShadow = false;
  }
  buildSideWallWithCenterWindow(-13.8);
  buildSideWallWithCenterWindow(13.8);

  // Front Wooden Wall (Z = +13.8) with CENTERED 8 cm DOOR (X: -4.0 to +4.0)
  // Left front wall (X: -14.0 to -4.0 -> w 10.0, center -9.0)
  addBoxMesh(10.0, WALL_H, 0.5, -9.0, WALL_Y, 13.8, wallMatFront);
  // Right front wall (X: +4.0 to +14.0 -> w 10.0, center +9.0)
  addBoxMesh(10.0, WALL_H, 0.5, 9.0, WALL_Y, 13.8, wallMatFront);
  // Lintel above 8 cm door (X: -4.2 to +4.2 -> w 8.4, Y: 12.6 to 19.8 -> h 7.2)
  addBoxMesh(8.4, 7.2, 0.5, 0, 16.2, 13.8, wallMatFront);

  // Wooden Door Frame around 8 cm opening
  addBoxMesh(0.42, 12.5, 0.82, -4.15, 6.45, 13.8, trimWoodMat);
  addBoxMesh(0.42, 12.5, 0.82, 4.15, 6.45, 13.8, trimWoodMat);
  addBoxMesh(8.7, 0.45, 0.82, 0, 12.55, 13.8, trimWoodMat);

  // -----------------------------------------------------------------------
  // HINGED WOODEN ROOF (Opens UPWARD around rear edge Z = -7.0, Y = 19.85)
  // -----------------------------------------------------------------------
  const roofPivot = new T.Group();
  roofPivot.position.set(0, 19.85, -7.0);
  scene.add(roofPivot);

  // Main Wooden Roof Panel extending forward along +Z (center at z = +10.6, depth = 21.8)
  addBoxMesh(28.6, 0.42, 21.8, 0, 0.21, 10.6, roofWoodMat, roofPivot);
  for (let rx = -12.6; rx <= 12.6; rx += 4.2) {
    addBoxMesh(0.42, 0.24, 21.4, rx, 0.52, 10.6, trimWoodMat, roofPivot);
  }
  // Visual brass hinges along rear edge (Z = 0 inside roofPivot)
  for (const hx of [-9.5, 0, 9.5]) {
    addBoxMesh(1.8, 0.55, 0.75, hx, 0.25, 0.1, getMat('#e2b458', 0.3, 0.7), roofPivot);
  }

  // Interior Wooden Shelving & Props (Against rear interior wall Z = -4.8)
  const interiorProps = new T.Group();
  scene.add(interiorProps);
  for (const sx of [-7.0, 1.5]) {
    addBoxMesh(5.6, 0.26, 3.6, sx, 2.8, -4.8, shelfWoodMat, interiorProps);
    addBoxMesh(5.6, 0.26, 3.6, sx, 6.5, -4.8, shelfWoodMat, interiorProps);
    addBoxMesh(5.6, 0.26, 3.6, sx, 10.2, -4.8, shelfWoodMat, interiorProps);
    for (const [px, pz] of [[-2.6, -6.4], [2.6, -6.4], [-2.6, -3.2], [2.6, -3.2]]) {
      addBoxMesh(0.28, 11.2, 0.28, sx + px, 5.7, pz, trimWoodMat, interiorProps);
    }
    addBoxMesh(2.0, 1.7, 2.4, sx - 1.2, 3.8, -4.7, '#d1a36e', interiorProps);
    addBoxMesh(1.9, 1.6, 2.3, sx + 1.2, 7.5, -4.7, '#b88652', interiorProps);
    addBoxMesh(2.1, 1.4, 2.2, sx, 11.1, -4.7, '#7e5534', interiorProps);
  }

  // -----------------------------------------------------------------------
  // SUBSYSTEM 1: CENTERED 8 CM WOODEN DOOR + REED SWITCH (PIN D2)
  // -----------------------------------------------------------------------
  const doorPivot = new T.Group();
  doorPivot.position.set(-4.0, 0.2, 13.8);
  scene.add(doorPivot);
  addBoxMesh(8.0, 12.2, 0.42, 4.0, 6.1, 0, doorWoodMat, doorPivot, 'reed');
  // Horizontal wooden battens & brass handle on 8 cm door
  for (const ry of [2.2, 6.1, 10.0]) {
    addBoxMesh(7.4, 0.34, 0.48, 4.0, ry, 0, trimWoodMat, doorPivot, 'reed');
  }
  addBoxMesh(0.32, 1.8, 0.5, 7.1, 5.8, 0.36, getMat('#e2b458', 0.28, 0.72), doorPivot, 'reed');
  // Door sensor on top-left frame + magnet on top-left of 8 cm door leaf
  addBoxMesh(1.3, 0.5, 0.5, -3.3, 12.0, 14.18, '#f4f7ec', scene, 'reed');
  addBoxMesh(1.3, 0.5, 0.48, 0.85, 11.4, 0.36, '#f4f7ec', doorPivot, 'reed');
  add3DCallout('PUERTA 8 CM + REED D2', 'Pin D2 · INPUT_PULLUP', -3.6, 15.0, 14.4, 'reed');

  // -----------------------------------------------------------------------
  // SUBSYSTEM 2: SERVO SG90 (PIN D3) ABOVE RIGHT EDGE OF 8 CM DOOR
  // -----------------------------------------------------------------------
  const servoGroup = new T.Group();
  servoGroup.position.set(4.1, 11.0, 14.2);
  scene.add(servoGroup);
  addBoxMesh(2.4, 1.7, 0.95, 0, 0, 0, getMat('#2696b0', 0.38, 0.08), servoGroup, 'servo');
  addBoxMesh(1.35, 1.45, 1.25, -0.05, 0.08, 0.28, getMat('#1b63f2', 0.3, 0.15, 0.92), servoGroup, 'servo');

  const servoArmPivot = new T.Group();
  servoArmPivot.position.set(-0.52, 0.18, 0.96);
  servoGroup.add(servoArmPivot);
  addBoxMesh(2.05, 0.38, 0.24, -0.82, 0, 0, getMat('#f5d472', 0.35, 0.2), servoArmPivot, 'servo');
  addCylMesh(0.3, 0.3, 0.32, 0, 0, 0, '#ffffff', servoArmPivot, 'servo');
  add3DCallout('SERVO SG90 + SOPORTE 3D', 'PWM Pin D3 · Pestillo', 4.6, 14.6, 14.6, 'servo');

  // -----------------------------------------------------------------------
  // SUBSYSTEM 3: RFID RC522 RIGHT OF CENTER DOOR
  // -----------------------------------------------------------------------
  const rfidGroup = new T.Group();
  rfidGroup.position.set(8.2, 6.2, 14.15);
  scene.add(rfidGroup);
  addBoxMesh(3.0, 4.0, 0.26, 0, 0, 0, getMat('#125c78', 0.38, 0.22), rfidGroup, 'rfid');
  const rfidRingMat = new T.MeshBasicMaterial({ color: '#7be3f7', side: T.DoubleSide });
  for (const r of [0.55, 0.86, 1.15]) {
    const ring = new T.Mesh(new T.RingGeometry(r - 0.07, r, 32), rfidRingMat);
    ring.position.set(0, -0.22, 0.16);
    rfidGroup.add(ring);
    registerCompMesh(ring, 'rfid');
  }

  const rfidCardGroup = new T.Group();
  rfidCardGroup.position.set(8.2, 6.0, 18.0);
  rfidCardGroup.visible = false;
  scene.add(rfidCardGroup);
  const rfidCardMat = getMat('#ffffff', 0.3, 0.05);
  addBoxMesh(2.4, 1.55, 0.08, 0, 0, 0, rfidCardMat, rfidCardGroup);
  addBoxMesh(0.45, 0.38, 0.1, -0.65, 0.1, 0, getMat('#e2b458', 0.25, 0.8), rfidCardGroup);
  add3DCallout('RFID RC522', 'SPI D9..D13 · 3.3V', 9.2, 9.8, 14.5, 'rfid');

  // -----------------------------------------------------------------------
  // SUBSYSTEM 4: OLED + 3 LEDS LEFT OF CENTER DOOR
  // -----------------------------------------------------------------------
  const oledGroup = new T.Group();
  oledGroup.position.set(-8.6, 7.2, 14.15);
  scene.add(oledGroup);
  addBoxMesh(3.8, 2.5, 0.26, 0, 0, 0, getMat('#102630', 0.45, 0.2), oledGroup, 'oled_leds');

  const oled3DCanvas = document.createElement('canvas');
  oled3DCanvas.width = 512;
  oled3DCanvas.height = 256;
  const oled3DCtx = oled3DCanvas.getContext('2d');
  const oled3DTex = new T.CanvasTexture(oled3DCanvas);
  if ('SRGBColorSpace' in T) oled3DTex.colorSpace = T.SRGBColorSpace;
  const oledScreenMesh = new T.Mesh(new T.PlaneGeometry(3.2, 1.7), new T.MeshBasicMaterial({ map: oled3DTex }));
  oledScreenMesh.position.set(0, -0.05, 0.16);
  oledGroup.add(oledScreenMesh);
  registerCompMesh(oledScreenMesh, 'oled_leds');

  function update3DOledTexture(st) {
    oled3DCtx.fillStyle = '#041014';
    oled3DCtx.fillRect(0, 0, 512, 256);
    oled3DCtx.fillStyle = '#5894a6';
    oled3DCtx.font = '700 25px Consolas, monospace';
    oled3DCtx.fillText('OLED 0.96" I2C (A4/A5)', 22, 40);
    oled3DCtx.strokeStyle = '#1d4452';
    oled3DCtx.lineWidth = 3;
    oled3DCtx.beginPath();
    oled3DCtx.moveTo(20, 56);
    oled3DCtx.lineTo(492, 56);
    oled3DCtx.stroke();
    oled3DCtx.fillStyle = st.system === 'INTRUSIÓN' ? '#ff5464' : '#7ef7df';
    oled3DCtx.font = '700 44px Consolas, monospace';
    oled3DCtx.fillText(st.oled1, 22, 126);
    oled3DCtx.fillStyle = '#a8ede0';
    oled3DCtx.font = '600 35px Consolas, monospace';
    oled3DCtx.fillText(st.oled2, 22, 194);
    oled3DTex.needsUpdate = true;
  }

  const ledMatGreen = new T.MeshStandardMaterial({ color: '#22e59b', emissive: '#22e59b', emissiveIntensity: 0.1 });
  const ledMatYellow = new T.MeshStandardMaterial({ color: '#ffca3a', emissive: '#ffca3a', emissiveIntensity: 1.6 });
  const ledMatRed = new T.MeshStandardMaterial({ color: '#ff384c', emissive: '#ff384c', emissiveIntensity: 0.1 });
  const ledGeo = new T.SphereGeometry(0.36, 20, 16);
  const meshLedG = new T.Mesh(ledGeo, ledMatGreen); meshLedG.position.set(-9.8, 4.6, 14.22); scene.add(meshLedG); registerCompMesh(meshLedG, 'oled_leds');
  const meshLedY = new T.Mesh(ledGeo, ledMatYellow); meshLedY.position.set(-8.6, 4.6, 14.22); scene.add(meshLedY); registerCompMesh(meshLedY, 'oled_leds');
  const meshLedR = new T.Mesh(ledGeo, ledMatRed); meshLedR.position.set(-7.4, 4.6, 14.22); scene.add(meshLedR); registerCompMesh(meshLedR, 'oled_leds');
  add3DCallout('OLED + 3 LEDS', 'I2C A4/A5 · Pines D5..D7', -9.2, 10.4, 14.5, 'oled_leds');

  // -----------------------------------------------------------------------
  // SUBSYSTEM 5: REAR ELECTRONICS BAY (ARDUINO + PROTOBOARD BEHIND BODEGA)
  // -----------------------------------------------------------------------
  const cajaGroup = new T.Group();
  cajaGroup.position.set(-5.2, 0.25, -10.8);
  scene.add(cajaGroup);
  const plaBrassMat = getMat('#deb053', 0.42, 0.1);
  // 3D Printed Enclosure Body rotated horizontally along rear bay
  addBoxMesh(8.4, 0.3, 4.8, 0, 0.15, 0, plaBrassMat, cajaGroup, 'esp32');
  addBoxMesh(8.4, 2.6, 0.35, 0, 1.45, 2.22, plaBrassMat, cajaGroup, 'esp32');
  addBoxMesh(8.4, 2.6, 0.35, 0, 1.45, -2.22, plaBrassMat, cajaGroup, 'esp32');
  addBoxMesh(0.35, 2.6, 4.1, -4.02, 1.45, 0, plaBrassMat, cajaGroup, 'esp32');
  addBoxMesh(0.35, 2.6, 4.1, 4.02, 1.45, 0, plaBrassMat, cajaGroup, 'esp32');
  // Arduino UNO WiFi R4 / ESP32 Board inside
  addBoxMesh(6.8, 0.32, 3.6, 0, 0.65, 0, getMat('#126073', 0.38, 0.28), cajaGroup, 'esp32');
  addBoxMesh(2.0, 0.38, 2.0, -1.4, 0.95, 0, getMat('#bdc8cc', 0.25, 0.82), cajaGroup, 'esp32');
  addBoxMesh(1.1, 0.36, 1.3, 3.0, 0.92, 0, getMat('#d0d9dc', 0.2, 0.85), cajaGroup, 'esp32');

  const cajaLidPivot = new T.Group();
  cajaLidPivot.position.set(0, 2.8, -2.25);
  cajaGroup.add(cajaLidPivot);
  addBoxMesh(8.4, 0.34, 4.8, 0, 0.17, 2.25, getMat('#36899c', 0.4, 0.12), cajaLidPivot, 'esp32');

  // Solderless White Protoboard Right Next to Controller Behind Bodega
  const protoGroup = new T.Group();
  protoGroup.position.set(5.4, 0.25, -10.8);
  scene.add(protoGroup);
  addBoxMesh(8.6, 0.6, 5.2, 0, 0.3, 0, getMat('#f4f6f5', 0.5, 0.05), protoGroup, 'esp32');
  addBoxMesh(8.2, 0.62, 0.18, 0, 0.32, -2.1, '#e53935', protoGroup, 'esp32');
  addBoxMesh(8.2, 0.62, 0.18, 0, 0.32, 2.1, '#1e88e5', protoGroup, 'esp32');
  add3DCallout('ARDUINO + PROTOBOARD', 'Zona Trasera · 115200 bps', 0.2, 6.2, -10.8, 'esp32');

  // 3D Jumper Wires routing from Rear Bay through Back Wall into Bodega & Front
  addWireCurve([[-1.5, 1.4, -10.6], [0.2, 2.4, -10.6], [2.0, 1.0, -10.6]], '#e53935', 0.09, 'esp32');
  addWireCurve([[-1.5, 1.4, -11.2], [0.2, 2.2, -11.2], [2.0, 1.0, -11.2]], '#1e88e5', 0.09, 'esp32');
  addWireCurve([[5.0, 1.0, -8.5], [8.2, 0.9, -4.0], [8.2, 6.0, 13.6]], '#ffca3a', 0.08, 'rfid');
  addWireCurve([[-5.5, 1.2, -8.5], [-10.5, 0.9, 2.0], [-8.6, 4.8, 13.6]], '#22e59b', 0.08, 'oled_leds');
  addWireCurve([[4.0, 1.0, -8.5], [10.0, 6.0, -6.5], [10.0, 11.5, -5.8]], '#f24c58', 0.08, 'buzzer');

  // -----------------------------------------------------------------------
  // SUBSYSTEM 6 & 7: INTERIOR SENSOR (D4) & BUZZER BEACON (D8)
  // -----------------------------------------------------------------------
  const pirGroup = new T.Group();
  pirGroup.position.set(-12.2, 12.2, -6.2);
  pirGroup.rotation.y = Math.PI * 0.25;
  scene.add(pirGroup);
  addBoxMesh(2.3, 2.3, 0.42, 0, 0, 0, getMat('#1f6e50', 0.45, 0.2), pirGroup, 'pir');
  const pirDomeMat = new T.MeshStandardMaterial({ color: '#f2f7f5', emissive: '#ffca3a', emissiveIntensity: 0.1, roughness: 0.25 });
  const pirDome = new T.Mesh(new T.SphereGeometry(0.88, 24, 18), pirDomeMat);
  pirDome.position.set(0, 0, 0.48);
  pirGroup.add(pirDome);
  registerCompMesh(pirDome, 'pir');

  const pirConeMat = new T.MeshBasicMaterial({ color: '#22c993', transparent: true, opacity: 0.13, side: T.DoubleSide, depthWrite: false });
  const pirConeGeo = new T.ConeGeometry(9.6, 17.5, 28, 1, true);
  pirConeGeo.translate(0, -8.75, 0);
  pirConeGeo.rotateX(-Math.PI / 2);
  const pirConeMesh = new T.Mesh(pirConeGeo, pirConeMat);
  pirConeMesh.position.set(-11.8, 12.0, -5.8);
  pirConeMesh.lookAt(0.0, 2.5, 6.5);
  scene.add(pirConeMesh);
  add3DCallout('SENSOR INTERIOR (KY-026 / PIR)', 'Pin D4 · Vigilancia Interna', -10.5, 16.0, -4.8, 'pir');

  const buzzerGroup = new T.Group();
  buzzerGroup.position.set(10.0, 11.8, -6.2);
  scene.add(buzzerGroup);
  addCylMesh(1.15, 1.15, 0.95, 0, 0, 0.4, getMat('#1a252e', 0.4, 0.25), buzzerGroup, 'buzzer');
  const beaconMat = new T.MeshStandardMaterial({ color: '#e03140', emissive: '#ff2438', emissiveIntensity: 0.15, roughness: 0.2 });
  addCylMesh(0.88, 0.98, 1.25, 0, 1.2, 0.4, beaconMat, buzzerGroup, 'buzzer');
  add3DCallout('BUZZER + SIRENA', 'Pin D8 · Alarma 2.4 kHz', 9.8, 16.0, -4.8, 'buzzer');

  const highlightRing = new T.Mesh(
    new T.RingGeometry(1.65, 2.05, 36),
    new T.MeshBasicMaterial({ color: '#e2b458', side: T.DoubleSide, depthTest: false })
  );
  highlightRing.rotation.x = -Math.PI / 2;
  highlightRing.visible = false;
  highlightRing.renderOrder = 20;
  scene.add(highlightRing);

  const camState = {
    currPos: new T.Vector3(16.5, 28.0, 35.0),
    currTarget: new T.Vector3(0.0, 7.5, 0.5),
    goalPos: new T.Vector3(16.5, 28.0, 35.0),
    goalTarget: new T.Vector3(0.0, 7.5, 0.5),
    isDragging: false,
    prevMouse: { x: 0, y: 0 }
  };

  let cardAnim = 0;
  let cardColor = '#22c993';
  let ringTimer = null;

  Bus.subscribe('state:changed', ({ state }) => {
    wallMatMain.opacity = state.xrayWalls ? 0.2 : 0.94;
    wallMatFront.opacity = state.xrayWalls ? 0.2 : 0.92;
    pirConeMesh.visible = state.showPirCone;
    update3DOledTexture(state);
  });

  Bus.subscribe('fx:rfid_card', ({ color, ringHex }) => {
    cardAnim = 1.0;
    cardColor = color;
    rfidRingMat.color.set(ringHex);
    clearTimeout(ringTimer);
    ringTimer = setTimeout(() => rfidRingMat.color.set('#7be3f7'), 1600);
  });

  Bus.subscribe('view:select_component', ({ compId }) => {
    const info = COMPONENT_DB[compId] || COMPONENT_DB.overview;
    camState.goalPos.set(...info.camPos);
    camState.goalTarget.set(...info.camTarget);
    if (compId === 'overview') {
      highlightRing.visible = false;
    } else {
      highlightRing.visible = true;
      highlightRing.position.set(info.camTarget[0], info.camTarget[1], info.camTarget[2]);
    }
  });

  Bus.subscribe('view:theme_changed', ({ theme }) => {
    scene.background = new T.Color(theme === 'light' ? '#d8e3e1' : '#091419');
  });

  // Orbit & Raycasting
  const raycaster = new T.Raycaster();
  const pointer = new T.Vector2();
  let downPos = { x: 0, y: 0 };

  container.addEventListener('pointerdown', e => {
    camState.isDragging = true;
    camState.prevMouse = { x: e.clientX, y: e.clientY };
    downPos = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('pointermove', e => {
    if (!camState.isDragging) return;
    const dx = (e.clientX - camState.prevMouse.x) * 0.0075;
    const dy = (e.clientY - camState.prevMouse.y) * 0.08;
    camState.prevMouse = { x: e.clientX, y: e.clientY };

    const offset = camState.goalPos.clone().sub(camState.goalTarget);
    const cos = Math.cos(-dx), sin = Math.sin(-dx);
    const nx = offset.x * cos - offset.z * sin;
    const nz = offset.x * sin + offset.z * cos;
    offset.x = nx;
    offset.z = nz;
    offset.y = Math.max(3.5, Math.min(44, offset.y + dy));
    camState.goalPos.copy(camState.goalTarget).add(offset);
  });

  window.addEventListener('pointerup', e => {
    if (!camState.isDragging) return;
    camState.isDragging = false;
    const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dist < 6 && e.target === renderer.domElement) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0 && hits[0].object.userData.compId) {
        Bus.publish('view:select_component', { compId: hits[0].object.userData.compId });
      }
    }
  });

  container.addEventListener('wheel', e => {
    e.preventDefault();
    const offset = camState.goalPos.clone().sub(camState.goalTarget);
    const factor = e.deltaY > 0 ? 1.09 : 0.91;
    if (offset.length() * factor > 5 && offset.length() * factor < 65) {
      offset.multiplyScalar(factor);
      camState.goalPos.copy(camState.goalTarget).add(offset);
    }
  }, { passive: false });

  let clockTime = 0;
  function animate3D() {
    clockTime += 0.04;
    const st = Domain.getState();
    const rect = container.getBoundingClientRect();
    const w = rect.width || 820;
    const h = rect.height || 475;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    camState.currPos.lerp(camState.goalPos, 0.085);
    camState.currTarget.lerp(camState.goalTarget, 0.085);
    camera.position.copy(camState.currPos);
    camera.lookAt(camState.currTarget);

    // Smooth Animations: Hinged Roof UP, Hinged Door, Servo Arm, Box Lid
    const targetRoofRot = st.roofOpen ? -Math.PI * 0.34 : 0;
    roofPivot.rotation.x += (targetRoofRot - roofPivot.rotation.x) * 0.1;

    doorPivot.rotation.y += ((st.doorOpen ? -Math.PI * 0.46 : 0) - doorPivot.rotation.y) * 0.12;
    servoArmPivot.rotation.z += ((st.lockOpen ? Math.PI * 0.48 : 0) - servoArmPivot.rotation.z) * 0.16;
    cajaLidPivot.rotation.x += ((st.cajaLidOpen ? -Math.PI * 0.58 : 0) - cajaLidPivot.rotation.x) * 0.12;

    if (cardAnim > 0.01) {
      rfidCardGroup.visible = true;
      cardAnim *= 0.92;
      rfidCardGroup.position.z = 14.7 + (1 - Math.sin(cardAnim * Math.PI)) * 2.5;
      rfidCardMat.color.set(cardColor);
    } else {
      rfidCardGroup.visible = false;
    }

    ledMatGreen.emissiveIntensity = st.system === 'DESARMADO' ? 2.4 : 0.06;
    ledMatYellow.emissiveIntensity = st.system === 'ARMADO' ? 2.1 : 0.06;
    const isIntrusion = st.system === 'INTRUSIÓN';
    const blink = Math.sin(clockTime * 5) > 0;
    ledMatRed.emissiveIntensity = isIntrusion ? (blink ? 3.0 : 0.35) : 0.06;
    beaconMat.emissiveIntensity = isIntrusion ? (blink ? 2.8 : 0.2) : 0.08;
    alarmLight.intensity = isIntrusion ? (blink ? 3.8 : 0.3) : 0;

    if (st.pirMotion) {
      pirConeMat.color.set(isIntrusion ? '#ff384c' : '#ffca3a');
      pirConeMat.opacity = 0.34;
      pirDomeMat.emissiveIntensity = 1.8;
    } else {
      pirConeMat.color.set('#22c993');
      pirConeMat.opacity = 0.12;
      pirDomeMat.emissiveIntensity = 0.08;
    }

    if (highlightRing.visible) {
      const s = 1 + Math.sin(clockTime * 3.2) * 0.08;
      highlightRing.scale.set(s, s, 1);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate3D);
  }

  function start() {
    update3DOledTexture(Domain.getState());
    requestAnimationFrame(animate3D);
  }

  return { start };
})();
