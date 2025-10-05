import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

class App {
  constructor() {
    // Scene objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // simulation state
    this.meteors = [];
    this.impactEffects = [];
    this.labels = [];

    // UI/state
    this.simSpeed = 1;
    this.realistic = false;
    this.paused = false;
    this.impactCount = 0;
    this.showAiming = true;

    // physics
    this.G = 6.67430e-11;
    this.earthMass = 5.972e24;
    this.earthRadiusMeters = 6371000;
    this.SCENE_SCALE = 1e6; // meters per scene unit
    this.earthRadius = 6371 / 1000; // scene units
    this.gravityStrength = 0.02;

    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    // placeholders
    this.cursor = null;
    this.predictedImpactMarker = null;
    // camera framing state for smooth on-spawn framing
    this.cameraFrame = { active: false };
    this._lastFrameTime = null;
  }

  // Smoothly frame the camera to look at `targetPos` and move camera to `endCamPos` over `durationMs`
  frameCameraTo(targetPos, endCamPos, durationMs = 1200){
    this.cameraFrame = {
      active: true,
      startTime: Date.now(),
      duration: durationMs,
      startCamPos: this.camera.position.clone(),
      endCamPos: endCamPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: targetPos.clone()
    };
  }

  createLabel(text, position) {
    const div = document.createElement('div');
    div.className = 'label';
    div.style.position = 'absolute';
    div.style.color = 'white';
    div.style.fontSize = '14px';
    div.innerText = text;
    document.body.appendChild(div);
    const label = { element: div, position };
    this.labels.push(label);
    return label;
  }

  updateLabels() {
    this.labels.forEach(label => {
      const vector = label.position.clone();
      vector.project(this.camera);
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      label.element.style.left = `${x}px`;
      label.element.style.top = `${y}px`;
    });
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 3, 15);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
  this.renderer.setSize(window.innerWidth, window.innerHeight);
  // Ensure correct color space for loaded textures
  this.renderer.outputEncoding = THREE.sRGBEncoding;
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    // create an HTML overlay for the aim cursor (dot / crosshair)
    const aimEl = document.createElement('div');
    aimEl.id = 'aimCursor';
    Object.assign(aimEl.style, {
      position: 'fixed', left: '0px', top: '0px',
      width: '18px', height: '18px', transform: 'translate(-50%, -50%)',
      borderRadius: '50%', background: 'transparent',
      border: '2px solid rgba(255,170,0,0.95)', pointerEvents: 'none', display: 'none', zIndex: 2000
    });
    document.body.appendChild(aimEl);
    this.aimCursor = aimEl;
    // void cursor: small dot shown only when pointer is over empty space
    const voidEl = document.createElement('div');
    voidEl.id = 'voidCursor';
    Object.assign(voidEl.style, {
      position: 'fixed', left: '0px', top: '0px', width: '8px', height: '8px',
      transform: 'translate(-50%, -50%)', borderRadius: '50%',
      background: 'rgba(255,170,0,0.9)', pointerEvents: 'none', display: 'none', zIndex: 1999
    });
    document.body.appendChild(voidEl);
    this.voidCursor = voidEl;
    this._pointerOverCanvas = false; // track if the mouse is currently over the renderer canvas

    // track entry/exit; visibility is decided in onMouseMove
    this.renderer.domElement.addEventListener('mouseenter', () => { this._pointerOverCanvas = true; });
    this.renderer.domElement.addEventListener('mouseleave', () => {
      this._pointerOverCanvas = false;
      if(this.aimCursor) this.aimCursor.style.display = 'none';
      if(this.voidCursor) this.voidCursor.style.display = 'none';
      if(this.renderer && this.renderer.domElement) this.renderer.domElement.style.cursor = '';
    });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Earth
    const earthGeo = new THREE.SphereGeometry(this.earthRadius, 32, 32);
    // Use a PBR-friendly material with a lighter base color so the globe is visible
    // even if a texture fails to load. Texture loader will overwrite the map when available.
    const earthMat = new THREE.MeshStandardMaterial({ color: 0x88aaff, roughness: 0.9, metalness: 0.0 });
      const earth = new THREE.Mesh(earthGeo, earthMat);
      this.scene.add(earth);
      // keep a direct reference to the Earth mesh so we can test ray intersections
      this.earth = earth;
    this.createLabel('Earth', new THREE.Vector3(0, this.earthRadius + 0.2, 0));

  // Lighting: ambient + hemisphere + directional (sun) — but we do not add a visible Sun mesh
  this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const hemi = new THREE.HemisphereLight(0xaaaaff, 0x222244, 0.6);
  this.scene.add(hemi);
  // directional light to simulate sunlight
  const dirLight = new THREE.DirectionalLight(0xfff8e6, 1.0);
  dirLight.position.set(10, 10, 10);
  dirLight.castShadow = false;
  this.scene.add(dirLight);
  // camera-attached point light has been removed per user preference
  // (previously a point light was attached to the camera which created an inconsistent "flashlight" effect)

  // cursor placeholder (invisible) — HTML overlay replaces the on-screen pointer
  // We keep a minimal Object3D so existing code that reads/writes this.cursor.position
  // and uses it for aiming/prediction continues to work, but we do NOT add any
  // visible geometry to the scene.
  this.cursor = new THREE.Object3D();
  // intentionally do NOT add to scene: avoid the residual 3D cursor geometry

    // aiming line
    const aimMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
    const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const aimingLine = new THREE.Line(aimGeo, aimMat);
    aimingLine.name = 'aimingLine';
    this.scene.add(aimingLine);

    // predicted impact marker
    const pGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xff5500 });
    this.predictedImpactMarker = new THREE.Mesh(pGeo, pMat);
    this.predictedImpactMarker.visible = false;
    this.scene.add(this.predictedImpactMarker);

  // mouse-follow cursor (removed; replaced by HTML overlay aimCursor)

    // events
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // wire basic UI elements safely
    const el = id => document.getElementById(id);
    // add a small HUD badge inside the UI for a futuristic accent (purely decorative)
    try{
      const uiRoot = document.getElementById('ui');
      if(uiRoot){
        const badge = document.createElement('div'); badge.className = 'hud-badge'; badge.title = 'HUD'; uiRoot.appendChild(badge);
        // subtle outline class applied so the panel reads like an HUD
        uiRoot.classList.add('hud-outline');
      }
    }catch(e){}
    // slider fill helper: layered gradients. At very low pct we draw a semicircular radial cap
    // on the left so the filled area meets the rounded track shape instead of leaving a square gap.
    const setRangeFill = (input) => {
      if(!input) return;
      const min = parseFloat(input.min || 0);
      const max = parseFloat(input.max || 1);
      const val = parseFloat(input.value || 0);
      const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  // set CSS variables that the stylesheet consumes. Also explicitly set --fill from JS
  // so we don't rely on stylesheet-only definitions in case of specificity/cascade issues.
  const defaultFill = (input.id==='simSpeed'?'#ff8ac9':(input.id==='speed'?'#c49cff':'#64f0ec'));
  const fill = (getComputedStyle(input).getPropertyValue('--fill') || defaultFill).trim() || defaultFill;
  input.style.setProperty('--fill', fill);
  input.style.setProperty('--pct', `${pct}%`);
  // Tune cap size and center to device pixel ratio to avoid visible gaps on HiDPI/zoomed displays
  const dpr = (window.devicePixelRatio && window.devicePixelRatio > 1) ? window.devicePixelRatio : 1;
  // Set a DPR-scaled thumb width so CSS can derive cap center/radius from it
  const baseThumb = 22; // default thumb width in CSS
  const thumbW = Math.max(16, Math.round(baseThumb * dpr));
  input.style.setProperty('--thumb-w', `${thumbW}px`);
      const rightColor = 'rgba(255,255,255,0.04)';
      // Use a more generous semicap for low pct values to account for browser track rendering and HiDPI
      if(pct <= 18){
        // when we set CSS vars, the stylesheet will use them; still provide an inline fallback scaled to dpr
        const capCenter = `${Math.round(thumbW/2)}px`; const capRadius = `${Math.round(thumbW * 0.95)}px`;
        input.style.background = `radial-gradient(circle at ${capCenter} 50%, ${fill} 0px, ${fill} ${capRadius}, transparent calc(${capRadius} + 1px)), linear-gradient(90deg, ${fill} ${pct}%, ${rightColor} ${pct}%)`;
      } else {
        input.style.background = `linear-gradient(90deg, ${fill} ${pct}%, ${rightColor} ${pct}%)`;
      }
    };

    if (el('simSpeed')) {
      const sim = el('simSpeed');
      const onSim = (e) => { this.simSpeed = parseFloat(e.target.value); if (el('simSpeedVal')) el('simSpeedVal').innerText = parseFloat(e.target.value).toFixed(2); setRangeFill(sim); };
      sim.addEventListener('input', onSim);
      // theme class for the simSpeed button area (pink)
      if (el('reset')) el('reset').classList.add('theme-pink');
      setRangeFill(sim);
    }
    if (el('speed')) {
      const s = el('speed'); if (el('speedVal')) el('speedVal').innerText = s.value;
      const onSpeed = (e) => { if (el('speedVal')) el('speedVal').innerText = parseFloat(e.target.value).toFixed(2); setRangeFill(s); };
      s.addEventListener('input', onSpeed);
      if (el('pause')) el('pause').classList.add('theme-lilac');
      setRangeFill(s);
    }
    if (el('reset')) el('reset').onclick = () => this.resetScene();
    // ensure reset has blue style
    if (el('reset')) el('reset').classList.add('reset');

    // Pause button toggles between Pause (red) and Resume (green)
    if (el('pause')){
      const pauseBtn = el('pause');
      // set initial class (not paused => show "Pause")
      pauseBtn.classList.add('pause');
      pauseBtn.onclick = (e) => {
        this.paused = !this.paused;
        const isPaused = this.paused;
        e.target.innerText = isPaused ? 'Resume' : 'Pause';
        // update class to reflect state
        pauseBtn.classList.toggle('pause', !isPaused);
        pauseBtn.classList.toggle('resume', isPaused);
      };
    }

    // toggleAiming shows/hides aiming and switches styles between aim-hide (yellow) and aim-show (purple)
    if (el('toggleAiming')){
      const ta = el('toggleAiming');
      // assume default text in HTML is "Hide Aiming" so initial state is showing aiming
      this.showAiming = true;
      ta.classList.add('aim-hide');
      ta.onclick = (e) => {
        this.showAiming = !this.showAiming;
        const showing = this.showAiming;
        e.target.innerText = showing ? 'Hide Aiming' : 'Show Aiming';
        // update aiming line visibility
        const aim = this.scene.getObjectByName('aimingLine'); if (aim) aim.visible = showing;
        // update HTML overlay and native cursor only when pointer is over canvas
        if(this._pointerOverCanvas){
          if(showing){ this.aimCursor.style.display = 'block'; this.renderer.domElement.style.cursor = 'none'; }
          else { this.aimCursor.style.display = 'none'; this.renderer.domElement.style.cursor = ''; }
        }
        // update classes
        ta.classList.toggle('aim-hide', showing);
        ta.classList.toggle('aim-show', !showing);
      };
    }
  if (el('fire')){
    // prevent the button from receiving focus (which causes the UI to scroll)
    el('fire').onmousedown = (e) => { e.preventDefault(); };
    el('fire').onclick = (e) => { this.shootMeteor(); try{ e.currentTarget && e.currentTarget.blur && e.currentTarget.blur(); }catch(_){} };
  }
  // wire meteor size UI
  const ms = el('meteorSize'); if(ms){ const mv = el('meteorSizeVal'); mv.innerText = ms.value; const onMs = (e)=>{ if(mv) mv.innerText = parseFloat(e.target.value).toFixed(1); setRangeFill(ms); }; ms.addEventListener('input', onMs); if (el('toggleAiming')) el('toggleAiming').classList.add('theme-cyan'); setRangeFill(ms); }

    // debug overlay removed
  if (el('fetch')) el('fetch').onclick = () => this.fetchAsteroidList(false);
  if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
    const uploadInput = el('uploadTex');
    if (uploadInput) uploadInput.addEventListener('change', (ev) => this.onUploadTexture(ev));
    const realBtn = el('toggleRealism'); if(realBtn) realBtn.onclick = (e)=>{ this.realistic = !this.realistic; e.target.innerText = this.realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };

    // When the API key input is focused we should not allow firing via keyboard and
    // we should temporarily disable the spawn button to avoid accidental spawn while typing.
    const apiEl = el('apiKey');
    const spawnBtn = el('spawnAsteroid');
    if(apiEl){
      apiEl.addEventListener('focus', ()=>{ if(spawnBtn) spawnBtn.disabled = true; });
      apiEl.addEventListener('blur', ()=>{ if(spawnBtn) spawnBtn.disabled = false; });
      // also ensure placeholder-shown neon style toggles by updating class on input
      apiEl.addEventListener('input', (e)=>{ /* no-op; CSS :placeholder-shown handles visual */ });
    }
    if(spawnBtn) spawnBtn.onclick = () => this.spawnSelectedAsteroid();

    // ensure when hovering UI we show default cursor and hide the aim overlay
    const uiRoot = document.getElementById('ui');
    if(uiRoot){
      uiRoot.addEventListener('mouseenter', ()=>{ this.aimCursor.style.display = 'none'; if(this.renderer && this.renderer.domElement) this.renderer.domElement.style.cursor = ''; });
      uiRoot.addEventListener('mouseleave', ()=>{ if(this._pointerOverCanvas && this.showAiming){ this.aimCursor.style.display = 'block'; this.renderer.domElement.style.cursor = 'none'; } });
      // Prevent any button in the UI from taking focus on mousedown (stops scrolling-to-bottom)
      try{
        const buttons = uiRoot.querySelectorAll('button');
        buttons.forEach(b => { b.onmousedown = (e) => { e.preventDefault(); }; });
      }catch(e){}
    }

    // initial aiming visibility
    const aimObj = this.scene.getObjectByName('aimingLine'); if (aimObj) aimObj.visible = this.showAiming;

    // attempt to auto-load a local earth texture file if present (project root: earth_texture.jpg)
    try { this.tryLoadLocalEarthTexture(); } catch(e){ /* ignore */ }
  }

  tryLoadLocalEarthTexture(){
    const localPath = './earth_texture.jpg';
    const loader = new THREE.TextureLoader();
    loader.load(localPath, tex => {
      const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
      if(earth && earth.material){
        if(earth.material.color) earth.material.color.setHex(0xffffff);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        earth.material.map = tex; earth.material.needsUpdate = true;
        console.log('Loaded local earth texture:', localPath);
      }
    }, undefined, err => {
      // silent fail if not present or CORS
      console.debug('Local earth texture not found or failed to load:', localPath, err && err.message);
    });
  }

  onUploadTexture(ev) {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const loader = new THREE.TextureLoader();
    loader.load(url, tex=>{
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if(this.scene && this.scene.children){
        const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
        if(earth && earth.material){
          // ensure material does not tint the texture
          if(earth.material.color) earth.material.color.setHex(0xffffff);
          tex.encoding = THREE.sRGBEncoding;
          earth.material.map = tex; earth.material.needsUpdate = true;
        }
      }
      URL.revokeObjectURL(url);
    }, undefined, err=>{ console.error('Local texture load failed', err); alert('Local texture failed to load'); });
  }

  onMouseMove(event) {
    this.mouse.x = (event.clientX/window.innerWidth)*2-1;
    this.mouse.y = -(event.clientY/window.innerHeight)*2+1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
      const planeZ = new THREE.Plane(new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion), -5);
      const intersection = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(planeZ, intersection);

      // Raycast against Earth and meteor meshes to determine whether the HTML
      // aim overlay should be visible. If we hit a meteor or the Earth, place the
      // internal cursor at the hit point; otherwise fall back to the camera plane.
      let hitPoint = null;
      try{
        const targets = [];
        if(this.earth) targets.push(this.earth);
        // include spawned meteor meshes
        for(const m of (this.meteors||[])) if(m && m.mesh) targets.push(m.mesh);
        const hits = targets.length ? this.raycaster.intersectObjects(targets, true) : [];
        if(hits && hits.length) { hitPoint = hits[0].point; }
      }catch(e){ /* ignore raycast errors */ }

      if(this.cursor) {
        if(hitPoint) this.cursor.position.copy(hitPoint);
        else this.cursor.position.copy(intersection);
        this.cursor.lookAt(this.camera.position);
      }

      // position the HTML aim cursor only when pointer is over the canvas, aiming is enabled,
      // and the ray actually hits the Earth or a meteor. Otherwise hide it so it isn't visible in space.
      if(this._pointerOverCanvas && this.showAiming && hitPoint){
        // show crosshair when over Earth/meteor
        if(this.aimCursor){ this.aimCursor.style.display = 'block'; this.aimCursor.style.left = `${event.clientX}px`; this.aimCursor.style.top = `${event.clientY}px`; }
        if(this.voidCursor) this.voidCursor.style.display = 'none';
        if(this.renderer && this.renderer.domElement) this.renderer.domElement.style.cursor = 'none';
      } else if(this._pointerOverCanvas && this.showAiming && !hitPoint){
        // pointer over canvas but in empty space -> show void dot only
        if(this.voidCursor){ this.voidCursor.style.display = 'block'; this.voidCursor.style.left = `${event.clientX}px`; this.voidCursor.style.top = `${event.clientY}px`; }
        if(this.aimCursor) this.aimCursor.style.display = 'none';
        if(this.renderer && this.renderer.domElement) this.renderer.domElement.style.cursor = 'none';
      } else {
        // not over canvas or aiming disabled
        if(this.aimCursor) this.aimCursor.style.display = 'none';
        if(this.voidCursor) this.voidCursor.style.display = 'none';
        if(this.renderer && this.renderer.domElement) this.renderer.domElement.style.cursor = '';
      }
  }

  onKeyDown(event) {
    // Ignore key events if an input, textarea, or contenteditable element is focused
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(event.code === 'KeyF') this.shootMeteor();
    // 'G' shortcut: spawn selected asteroid (respect focus guards)
    if(event.code === 'KeyG'){
      const sel = document.getElementById('asteroidSelect');
      // if custom-list used, check dataset.selectedId, otherwise fall back to select.value
      const hasSelected = sel && ((sel.dataset && sel.dataset.selectedId) || sel.value);
      if(!hasSelected) return;
      this.spawnSelectedAsteroid();
    }
  }

  shootMeteor() {
    const speedEl = document.getElementById('speed');
    const speed = speedEl ? parseFloat(speedEl.value) : 0.05;
    const sizeEl = document.getElementById('meteorSize');
    const size = sizeEl ? parseFloat(sizeEl.value) : 0.5;
  // create a textured, irregular 3D meteor mesh sized according to `size` (meters)
  // Generate a high-quality per-meteor seed so subsequent random choices are unique
  let seed = 0;
  try{
    const arr = new Uint32Array(1);
    if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
    seed = arr[0] || Math.floor(Math.random()*0xffffffff);
  }catch(e){ seed = Math.floor(Math.random()*0xffffffff); }
  const meteor = this.createMeteorMesh(size, seed);
  meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    // If we have a predicted impact marker, aim directly at that point so meteors go toward the globe
    if(this.predictedImpactMarker && this.predictedImpactMarker.visible){
      dir.copy(this.predictedImpactMarker.position).sub(meteor.position).normalize();
    }
    const density = 3000;
    const volume = (4/3)*Math.PI*Math.pow(size/2,3);
    const mass = density * volume;
    const area = Math.PI * Math.pow(size/2,2);
  this.scene.add(meteor);
  // Blur any focused element (like a clicked button) so the UI doesn't unexpectedly scroll
  try{ if(document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); }catch(e){}
  const label = this.createLabel(`Meteor (${(size).toFixed(2)} m)`, meteor.position);
    const physVelocity = dir.clone().multiplyScalar(speed * this.SCENE_SCALE);
    // Convert meters -> scene units. Geometry radius is 1 (1 meter), so to represent
    // a meteor with diameter `size` (meters) we scale by radius = size/2 in meters.
    const meterToScene = 1 / this.SCENE_SCALE;
    const radiusScene = (size / 2) * meterToScene;
  // scale is handled inside createMeteorMesh; ensure minimal visibility if necessary
    // Give meteors a TTL and make their scene velocity slightly slower so they don't fly into space
    const sceneVelocity = dir.clone().multiplyScalar(speed * 0.6);
    meteor.material.transparent = true; meteor.material.opacity = 1.0;
    // give a small random angular velocity so meteors tumble in flight
    const angVel = new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2).multiplyScalar(0.6);
    this.meteors.push({ mesh:meteor, velocity:sceneVelocity, physVelocity, active:true, label, mass, area, size, ttl: 800, fading:false, angularVelocity: angVel });
  }

  // Create a textured meteor mesh as a smooth sphere and apply meteor_texture.jpg as its material map.
  // sizeMeters is diameter in meters.
  // seed is an optional 32-bit integer used to produce a unique random meteor
  createMeteorMesh(sizeMeters, seed = null){
  // smooth sphere geometry for a ball-like meteor (increased resolution for crisper craters)
  const widthSeg = 96; // was 48
  const heightSeg = 64; // was 32
  const geom = new THREE.SphereGeometry(1, widthSeg, heightSeg);

    // create a PBR-friendly material; we'll set the map when the texture loads
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.9, metalness:0.02, transparent:true });
    const mesh = new THREE.Mesh(geom, mat);

    // try to load an external meteor texture image located at project root
    // create a seeded RNG so each meteor is unique and reproducible per spawn
    const makeRNG = (s) => {
      let _s = s >>> 0;
      if(!_s) _s = Math.floor(Math.random()*0xffffffff) >>> 0;
      return () => {
        // xorshift32
        _s ^= (_s << 13);
        _s ^= (_s >>> 17);
        _s ^= (_s << 5);
        return (_s >>> 0) / 0x100000000;
      };
    };
    const rng = makeRNG(seed || (Math.floor(Math.random()*0xffffffff)>>>0));

    const loader = new THREE.TextureLoader();
      // Apply a quick low-res procedural fallback immediately so the meteor is textured on spawn
      try{
        const quickFallback = this.createProceduralMeteorTexture(128);
        mat.map = quickFallback; mat.needsUpdate = true;
      }catch(e){ /* ignore fallback errors */ }

      loader.load('meteor_texture.jpg', (tex)=>{
      try{
        const img = tex.image;
        // helper to apply crater-like inward domes by sampling the image at each vertex UV
        // and bake a normal map from the processed brightness map for better lighting
        const applyCratersFromImage = (image)=>{
          try{
            const w = image.width, h = image.height;
            const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(image, 0, 0, w, h);
            // lightly darken for visual consistency
            ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0,0,w,h);
            const srcImg = ctx.getImageData(0,0,w,h);

            // crater sculpting parameters (unit-sphere space)
            // Choose a small base MaxDepth so craters are shallow dome-like penetrations.
            // We pick a conservative default so domes only slightly indent the sphere.
            const userMaxDepth = 2; // 0..10 user scale (2 -> subtle domes)
            // map 0..10 -> 0..0.08 unit-sphere displacement (max ~0.08 is still small)
            const maxDepth = (userMaxDepth / 10.0) * 0.08;
            // thresholds for the blurred-darkness map: only fairly dark pixels become craters
            const thresholdLow = 0.18;
            const thresholdHigh = 0.85;
            // small blur to preserve crater placement and avoid huge smear
            const blurRadiusPx = Math.max(1, Math.floor(Math.min(w,h) * 0.02));

            const posAttr = geom.attributes.position;
            const uvAttr = geom.attributes.uv;
            if(!uvAttr) return null;

            // smoothstep helper
            const smoothstep = (edge0, edge1, x) => {
              const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
              return t * t * (3 - 2 * t);
            };

            // build a blurred height map (brightness -> height) using a separable Gaussian blur for smoothness
            const raw = new Float32Array(w*h);
            for(let py=0; py<h; py++){
              for(let px=0; px<w; px++){
                const idx = (py * w + px) * 4;
                const rr = srcImg.data[idx], gg = srcImg.data[idx+1], bb = srcImg.data[idx+2];
                const lum = (rr + gg + bb) / (3 * 255);
                raw[py*w + px] = 1.0 - lum; // darkness as unblurred height
              }
            }

            // create Gaussian kernel (1D) for separable blur
            const gauss = (sigma, x) => Math.exp(-(x*x)/(2*sigma*sigma));
            const sigma = Math.max(1.0, blurRadiusPx * 0.5);
            const kr = Math.ceil(sigma * 3.0);
            const kernel = new Float32Array(kr*2 + 1);
            let ksum = 0;
            for(let i=-kr;i<=kr;i++){ const v = gauss(sigma, i); kernel[i+kr] = v; ksum += v; }
            for(let i=0;i<kernel.length;i++) kernel[i] /= ksum;

            // horizontal blur
            const tmp = new Float32Array(w*h);
            for(let y=0;y<h;y++){
              for(let x=0;x<w;x++){
                let s = 0;
                for(let k=-kr;k<=kr;k++){
                  const sx = Math.min(w-1, Math.max(0, x+k));
                  s += raw[y*w + sx] * kernel[k+kr];
                }
                tmp[y*w + x] = s;
              }
            }
            // vertical blur (write into final height)
            const height = new Float32Array(w*h);
            for(let x=0;x<w;x++){
              for(let y=0;y<h;y++){
                let s = 0;
                for(let k=-kr;k<=kr;k++){
                  const sy = Math.min(h-1, Math.max(0, y+k));
                  s += tmp[sy*w + x] * kernel[k+kr];
                }
                height[y*w + x] = s;
              }
            }

            // use the height map to displace vertices inward by a smooth dome amount
            // We'll bilinear sample the height map for smoother results and add a low-frequency
            // rock-shaping FBM so the meteor silhouette is irregular like a real asteroid.
            const sampleHeight = (u, v) => {
              const fx = u * (w - 1);
              const fy = (1 - v) * (h - 1);
              const x0 = Math.floor(fx);
              const y0 = Math.floor(fy);
              const x1 = Math.min(w-1, x0+1);
              const y1 = Math.min(h-1, y0+1);
              const sx = fx - x0;
              const sy = fy - y0;
              const a = height[y0*w + x0];
              const b = height[y0*w + x1];
              const c = height[y1*w + x0];
              const d = height[y1*w + x1];
              const res = a * (1-sx) * (1-sy) + b * sx * (1-sy) + c * (1-sx) * sy + d * sx * sy;
              return res;
            };

            // Replace previous sponge-like FBM with ridged FBM for chunkier rock facets and fewer tiny pores
            const fbm_ridged = (x,y,z,oct=4) => {
              // use a cheap hash-based value noise with seeded RNG
              const hash3 = (xi, yi, zi) => {
                // combine coordinates with seed-derived jitter
                const a = ((xi*374761393) ^ (yi*668265263) ^ (zi*2246822519)) >>> 0;
                // xorshift-like mix
                let v = (a + (seed>>>0)) >>> 0;
                v ^= v << 13; v ^= v >>> 17; v ^= v << 5;
                return (v >>> 0) / 0x100000000;
              };
              const valueNoise = (x,y,z) => {
                const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
                const xf = x - xi, yf = y - yi, zf = z - zi;
                // trilinear interpolation
                const c000 = hash3(xi, yi, zi);
                const c100 = hash3(xi+1, yi, zi);
                const c010 = hash3(xi, yi+1, zi);
                const c110 = hash3(xi+1, yi+1, zi);
                const c001 = hash3(xi, yi, zi+1);
                const c101 = hash3(xi+1, yi, zi+1);
                const c011 = hash3(xi, yi+1, zi+1);
                const c111 = hash3(xi+1, yi+1, zi+1);
                const lerp = (a,b,t)=> a + (b-a)*t;
                const ix00 = lerp(c000, c100, xf);
                const ix10 = lerp(c010, c110, xf);
                const ix01 = lerp(c001, c101, xf);
                const ix11 = lerp(c011, c111, xf);
                const iy0 = lerp(ix00, ix10, yf);
                const iy1 = lerp(ix01, ix11, yf);
                return lerp(iy0, iy1, zf);
              };
              let sum = 0, amp = 0.6, freq = 0.8;
              for(let i=0;i<oct;i++){
                const n = 1.0 - Math.abs(valueNoise(x*freq, y*freq, z*freq) * 2.0 - 1.0);
                sum += n * amp;
                amp *= 0.45; freq *= 2.0;
              }
              return sum;
            };

            // tuned amplitudes for a rounder meteor: very small rock displacement and minimal pit amplification
            // reduce rock amplitude so silhouette is smooth with coarse chunky facets (not spongey)
            const rockAmplitude = Math.min(0.02, maxDepth * 0.6);
            const pitExtraDepth = Math.max(0.0, maxDepth * 0.15);
            const lfScale = 0.9 + rng() * 0.5; // keep lower-frequency variation

            // First: detect crater centers in image space by finding local maxima in the blurred height map
            const craterCenters = [];
            // be conservative: detect fewer, more meaningful crater centers that correspond to dark holes
            const craterMaskThreshold = 0.35;
            const minSeparationPx = Math.max(12, Math.floor(Math.min(w,h) * 0.07));
            for(let py=1; py<h-1; py++){
              for(let px=1; px<w-1; px++){
                const idx = py*w + px;
                const val = height[idx];
                if(val < craterMaskThreshold) continue; // skip non-dark areas
                // local maximum test
                if(val >= height[idx-1] && val >= height[idx+1] && val >= height[idx-w] && val >= height[idx+w]){
                  // ensure separation from existing centers
                  let ok = true;
                  for(const c of craterCenters){ const dx = c.x - px, dy = c.y - py; if((dx*dx + dy*dy) < (minSeparationPx*minSeparationPx)){ ok = false; break; } }
                  if(!ok) continue;
                  // sample radius and darkness to determine crater category
                  const localDark = val;
                  const rand = rng();
                  // categories tuned toward fewer, smaller and shallower domes
                  let category = 0;
                  if(localDark > 0.75){ category = rand < 0.45 ? 0 : 1; } else if(localDark > 0.5){ category = rand < 0.35 ? 1 : 3; } else { category = rand < 0.18 ? 2 : 3; }
                  const catRadius = [ Math.max(8, Math.floor(Math.min(w,h)*0.07)), Math.max(6, Math.floor(Math.min(w,h)*0.045)), Math.max(10, Math.floor(Math.min(w,h)*0.09)), Math.max(4, Math.floor(Math.min(w,h)*0.035)) ];
                  // shallower crater multipliers overall (domes only slightly indent)
                  const catDepth = [ 0.35, 0.28, 0.2, 0.12 ];
                  craterCenters.push({ x:px, y:py, radius: catRadius[category] * (0.85 + rng()*0.4), depthMult: catDepth[category] * (0.85 + rng()*0.35), darkness: localDark });
                }
              }
            }

            // if no centers found, fall back to texture-driven single pass
            const useCenters = craterCenters.length > 0;

            for(let i=0;i<posAttr.count;i++){
              const u = uvAttr.getX(i);
              const v = uvAttr.getY(i);
              const hval = sampleHeight(u, v) || 0;

              const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
              const dir = new THREE.Vector3(vx, vy, vz).normalize();

              // chunkier ridged noise for silhouette (kept small for roundness)
              const ridged = fbm_ridged(dir.x * lfScale, dir.y * lfScale, dir.z * lfScale, 4) - 0.35;
              const rockDisp = ridged * rockAmplitude;

              // crater displacement: either modulated by nearest detected crater center or by raw height
              let craterDisp = 0;
              if(useCenters){
                // transform uv -> pixel coords (image Y inverted compared to v)
                const px = Math.floor(u * (w-1));
                const py = Math.floor((1 - v) * (h-1));
                // find nearest crater center
                let nearest = null; let nd = Infinity;
                for(const c of craterCenters){ const dx = c.x - px, dy = c.y - py; const d2 = dx*dx + dy*dy; if(d2 < nd){ nd = d2; nearest = c; } }
                if(nearest){
                  const dist = Math.sqrt(nd);
                  // dome profile: smooth quadratic falloff for a bowl-like dome (gentle inside)
                  const r = Math.max(1, nearest.radius);
                  const ndorm = Math.max(0, 1 - (dist*dist) / (r*r));
                  const dome = Math.pow(ndorm, 1.0);
                  // crater strength influenced by texture darkness at vertex too
                  const craterStrengthRaw = smoothstep(thresholdLow, thresholdHigh, hval);
                  craterDisp = dome * craterStrengthRaw * maxDepth * nearest.depthMult * Math.max(0.4, 1 - Math.abs(dir.y) * 0.12);
                }
              } else {
                const craterStrengthRaw = smoothstep(thresholdLow, thresholdHigh, hval);
                craterDisp = craterStrengthRaw * maxDepth * Math.max(0.25, 1 - Math.abs(dir.y) * 0.25);
              }

              // small extra deepening for very dark pixels (kept tiny for domes)
              if(hval > 0.9) craterDisp += (hval - 0.9) / 0.1 * pitExtraDepth * 0.5;
              craterDisp = Math.min(craterDisp, maxDepth * 1.0);

              let finalRadius = 1.0 + rockDisp - craterDisp;
              finalRadius = Math.max(0.003, finalRadius);
              posAttr.setXYZ(i, dir.x * finalRadius, dir.y * finalRadius, dir.z * finalRadius);
            }

            posAttr.needsUpdate = true;
            geom.computeVertexNormals();

            // Apply a very subtle elongation to approximate an American-football silhouette.
            // Keep elongation extremely mild so meteors remain smooth and round.
            const elongation = 1.0 + 0.03 * (rng() + rng()); // ~1.0..1.06
            const ax = new THREE.Vector3(rng()*2-1, rng()*2-1, rng()*2-1).normalize();
            for(let i=0;i<posAttr.count;i++){
              const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
              const p = new THREE.Vector3(vx, vy, vz);
              // project onto axis and scale component along axis
              const proj = ax.clone().multiplyScalar(p.dot(ax) * (elongation - 1));
              p.add(proj);
              // normalize slightly to avoid extreme bulging, then reapply original length bias
              const len = p.length();
              const final = p.clone().multiplyScalar(1.0 / Math.max(1e-6, len));
              posAttr.setXYZ(i, final.x * len, final.y * len, final.z * len);
            }
            posAttr.needsUpdate = true;
            geom.computeVertexNormals();

            // produce final canvas texture (we reuse the canvas we drew into earlier)
            const finalTex = new THREE.CanvasTexture(cvs);
            finalTex.encoding = THREE.sRGBEncoding;
            finalTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
            finalTex.repeat.set(1,1);

            // Bake a normal map from the blurred height map for improved lighting (linear encoding)
            try{
              const nCvs = document.createElement('canvas'); nCvs.width = w; nCvs.height = h;
              const nCtx = nCvs.getContext('2d');
              const nImg = nCtx.createImageData(w,h);
              // strength factor controls how pronounced the normals appear; lower it to match the shallower craters
              const strength = Math.max(0.5, maxDepth * 10.5);
              for(let py=0; py<h; py++){
                for(let px=0; px<w; px++){
                  const idx = py*w + px;
                  const hl = height[py*w + Math.max(0, px-1)];
                  const hr = height[py*w + Math.min(w-1, px+1)];
                  const hu = height[Math.max(0, py-1)*w + px];
                  const hd = height[Math.min(h-1, py+1)*w + px];
                  const dx = (hr - hl) * strength;
                  const dy = (hd - hu) * strength;
                  // normal in tangent-space
                  let nx = -dx, ny = -dy, nz = 1.0;
                  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1.0;
                  nx /= len; ny /= len; nz /= len;
                  // encode to RGB [0..255]
                  const off = idx * 4;
                  nImg.data[off]   = Math.floor((nx * 0.5 + 0.5) * 255);
                  nImg.data[off+1] = Math.floor((ny * 0.5 + 0.5) * 255);
                  nImg.data[off+2] = Math.floor((nz * 0.5 + 0.5) * 255);
                  nImg.data[off+3] = 255;
                }
              }
              nCtx.putImageData(nImg, 0, 0);
              const normalTex = new THREE.CanvasTexture(nCvs);
              normalTex.encoding = THREE.LinearEncoding;
              normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
              normalTex.minFilter = THREE.LinearMipmapLinearFilter;
              normalTex.generateMipmaps = true;
              normalTex.needsUpdate = true;
              // assign both albedo and normal map to material
              mat.normalMap = normalTex;
              // very gentle normal influence for subtle lighting from the shallow domes
              mat.normalScale = new THREE.Vector2(0.045, 0.045);
              // ensure slightly higher roughness for a rock-like look but not shiny
              mat.roughness = 0.92; mat.metalness = 0.0;
            }catch(err){ console.warn('normal map bake failed', err); }

            return finalTex;
          }catch(err){ console.warn('applyCratersFromImage failed', err); return null; }
        };

        if(img && img.width && img.height){
          // create a darker, crater-sculpted texture and assign it
          const craterTex = applyCratersFromImage(img);
          if(craterTex){ 
            craterTex.minFilter = THREE.LinearMipmapLinearFilter; craterTex.generateMipmaps = true; craterTex.needsUpdate = true;
            mat.map = craterTex; 
          } else {
            tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.repeat.set(1,1); mat.map = tex; 
          }
        } else {
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.repeat.set(1,1); mat.map = tex;
        }
        mat.needsUpdate = true;
      }catch(e){
        console.warn('meteor texture assignment failed', e);
      }
    }, undefined, ()=>{
      // fallback to procedural texture if load fails
      const ctex = this.createProceduralMeteorTexture();
      mat.map = ctex; mat.needsUpdate = true;
    });

  // Extended mapping: map meteor diameter (meters) to a visual radius using multiple
  // country-area anchors so very large diameters (10km, 40km, 80km) map to large
  // country-sized visuals (Pakistan, Saudi Arabia, China). We use piecewise eased
  // interpolation to keep the mapping smooth and monotonic.
  const anchors = [
    { m: 0.1, area: 468 },       // Andorra (tiny)
    { m: 75.0, area: 78866 },    // Czech Republic ~78,866 km^2
    { m: 100.0, area: 243610 },  // United Kingdom ~243,610 km^2
    { m: 10000.0, area: 881913 },// Pakistan ~881,913 km^2 (visual target for 10,000 m)
    { m: 40000.0, area: 2149690 },// Saudi Arabia ~2,149,690 km^2 (visual target for 40,000 m)
    { m: 80000.0, area: 9596961 } // China ~9,596,961 km^2 (visual target for 80,000 m)
  ];

  // compute anchor visual radii (km -> normalized by 1000 to keep scene scale consistent)
  const anchorRadii = anchors.map(a => Math.sqrt(a.area / Math.PI) / 1000.0);

  // clamp and find segment
  const minM = anchors[0].m, maxM = anchors[anchors.length-1].m;
  const m = Math.max(minM, Math.min(maxM, sizeMeters));
  let visualRadiusBase = anchorRadii[0];
  if (m <= anchors[0].m) {
    visualRadiusBase = anchorRadii[0];
  } else if (m >= anchors[anchors.length-1].m) {
    visualRadiusBase = anchorRadii[anchorRadii.length-1];
  } else {
    // find segment index
    let seg = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (m >= anchors[i].m && m <= anchors[i+1].m) { seg = i; break; }
    }
    const m0 = anchors[seg].m, m1 = anchors[seg+1].m;
    const r0 = anchorRadii[seg], r1 = anchorRadii[seg+1];
    const u = (m - m0) / Math.max(1e-6, (m1 - m0));
    // segment-specific gamma to tune feel (higher -> slower early growth)
    const gammas = [1.4, 1.05, 0.95, 0.95, 0.98];
    const gamma = gammas[Math.min(gammas.length-1, seg)] || 1.0;
    const uAdj = Math.pow(u, gamma);
    visualRadiusBase = r0 + (r1 - r0) * uAdj;
  }

  const VISUAL_AMPLIFIER = 1.0;
  const visualRadius = visualRadiusBase * VISUAL_AMPLIFIER;
  mesh.scale.setScalar(Math.max(visualRadius, 0.005));

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  // Generate a simple procedural meteor texture as a CanvasTexture fallback
  createProceduralMeteorTexture(size = 1024){
      const s = Math.max(32, parseInt(size,10) || 1024);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d');
    // base color
    ctx.fillStyle = '#9a8f85'; ctx.fillRect(0,0,s,s);
    // noisy overlay (lower amplitude for smaller sizes)
    const image = ctx.getImageData(0,0,s,s);
    const noiseAmp = Math.max(8, Math.floor(40 * (s/1024)));
    for(let y=0;y<s;y++){
      for(let x=0;x<s;x++){
        const i = (y*s + x) * 4;
        const n = Math.floor(noiseAmp * Math.random()) - Math.floor(noiseAmp/2);
        image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
        image.data[i+1] = Math.max(0, Math.min(255, image.data[i+1] + n));
        image.data[i+2] = Math.max(0, Math.min(255, image.data[i+2] + n));
        image.data[i+3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    // draw some darker circular 'craters'
    for(let i=0;i<120;i++){
      const rx = Math.random()*size, ry = Math.random()*size, r = (2 + Math.random()*18);
      const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
      const alpha = 0.15 + Math.random()*0.45;
      grad.addColorStop(0, `rgba(30,20,10,${alpha})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(rx, ry, r, 0, Math.PI*2); ctx.fill();
    }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
  }

  resetScene() {
    this.meteors.forEach(m=>{ if(m.mesh) this.scene.remove(m.mesh); if(m.label && m.label.element) m.label.element.remove(); });
    this.meteors = [];
    this.impactEffects.forEach(e=>{ if(e.mesh) this.scene.remove(e.mesh); });
    this.impactEffects = [];
    this.impactCount = 0; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = '0';
  }

  animate(time) {
    // schedule next frame and compute dt
    requestAnimationFrame(this.animate.bind(this));
    const now = time || performance.now();
    const dtMs = this._lastFrameTime ? (now - this._lastFrameTime) : 16;
    const dt = (dtMs / 1000) * this.simSpeed; // seconds scaled by simSpeed
    this._lastFrameTime = now;
    // Pulse cursor
    const ringMesh = this.cursor && this.cursor.getObjectByName && this.cursor.getObjectByName('cursorRing');
    if(ringMesh){ const pulse = 1 + 0.1 * Math.sin(Date.now() * 0.005); this.cursor.scale.set(pulse,pulse,pulse); }
    // update aiming line
    const aimingLine = this.scene.getObjectByName && this.scene.getObjectByName('aimingLine');
    if(aimingLine){ const positions = aimingLine.geometry.attributes.position.array; positions[0]=this.camera.position.x; positions[1]=this.camera.position.y; positions[2]=this.camera.position.z; positions[3]=this.cursor.position.x; positions[4]=this.cursor.position.y; positions[5]=this.cursor.position.z; aimingLine.geometry.attributes.position.needsUpdate=true; }
  // update counters
    const mc = document.getElementById('meteorCount'); if(mc) mc.innerText = String(this.meteors.length);
    // predicted impact
    this.updatePredictedImpact();
  // scene mouseCursor removed; HTML overlay now handles pointer visuals

    // camera framing update (if active)
    if(this.cameraFrame && this.cameraFrame.active){
      const now = Date.now();
      const t = Math.min(1, (now - this.cameraFrame.startTime) / this.cameraFrame.duration);
      // lerp camera position
      this.camera.position.lerpVectors(this.cameraFrame.startCamPos, this.cameraFrame.endCamPos, t);
      // lerp controls target
      const newTarget = this.cameraFrame.startTarget.clone().lerp(this.cameraFrame.endTarget, t);
      this.controls.target.copy(newTarget);
      if(t >= 1) this.cameraFrame.active = false;
    }

    // Only update simulation state when not paused. We still render frames so UI remains responsive.
    if(!this.paused){
      // Meteors update (simple version: non-realistic faster path)
      this.meteors.forEach(meteor=>{
        if(!meteor.active) return;
        const pos = meteor.mesh.position;
        const r = pos.length();
        // apply angular velocity (tumble) if present
        if(meteor.angularVelocity && meteor.mesh){
          // convert angular velocity vector (radians/sec) into a small rotation quaternion
          const av = meteor.angularVelocity.clone().multiplyScalar(dt);
          const ax = av.length();
          if(ax > 0){
            const q = new THREE.Quaternion();
            q.setFromAxisAngle(av.normalize(), ax);
            meteor.mesh.quaternion.premultiply(q);
            // slight damping so the tumble slows over time
            meteor.angularVelocity.multiplyScalar(0.998);
          }
        }
        if(this.realistic){
          // keep original complex integration: for brevity we fallback to simple motion here
          const posMeters = pos.clone().multiplyScalar(this.SCENE_SCALE);
          const vel = meteor.physVelocity.clone();
          const dtInt = 0.02 * this.simSpeed;
          // semi-implicit Euler gravity approximation (faster)
          const rmag = posMeters.length();
          const g = posMeters.clone().multiplyScalar(-this.G*this.earthMass/(rmag*rmag*rmag));
          meteor.physVelocity.add(g.multiplyScalar(dtInt));
          posMeters.add(meteor.physVelocity.clone().multiplyScalar(dtInt));
          meteor.mesh.position.copy(posMeters.multiplyScalar(1/this.SCENE_SCALE));
          if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
        } else {
          const gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
          meteor.velocity.add(gravityAccel.multiplyScalar(this.simSpeed));
          pos.add(meteor.velocity.clone().multiplyScalar(this.simSpeed));
        }
        // fade out meteors that miss or have lived past their TTL (TTL in seconds)
        meteor.ttl = meteor.ttl === undefined ? 8.0 : meteor.ttl - dt;
        if(meteor.ttl <= 0){ meteor.fading = true; }
        if(meteor.fading){
          meteor.mesh.material.opacity = Math.max(0, (meteor.mesh.material.opacity||1) - 0.5 * dt);
          if(meteor.mesh.material.opacity <= 0){
            meteor.active = false;
            if(meteor.mesh.parent) meteor.mesh.parent.remove(meteor.mesh);
            try{ if(meteor.label && meteor.label.element) meteor.label.element.remove(); const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1); }catch(e){ /* ignore */ }
          }
        }

        if(r < this.earthRadius + 0.2){
          meteor.active = false;
          this.createImpact(pos.clone(), meteor.size);
          this.scene.remove(meteor.mesh);
          // Remove any label associated with this meteor so nametags do not persist after impact
          try{ if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element); const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1); }catch(e){ /* ignore */ }
          this.impactCount++; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = String(this.impactCount);
          try{
            let speedAtImpact = meteor.physVelocity ? meteor.physVelocity.length() : (meteor.velocity ? meteor.velocity.length()*this.SCENE_SCALE : 0);
            const ke = 0.5 * (meteor.mass || 1) * speedAtImpact * speedAtImpact;
            const keTons = ke / 4.184e9;
            const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = `${ke.toExponential(3)} J (~${keTons.toFixed(2)} kt)`;
          }catch(e){ console.error('impact energy calc', e); const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = '-'; }
        }
      });

      // impact effects: reconstruct vertices so the ring stays flush with the globe and expands along the surface
      this.impactEffects.forEach(effect=>{
        // increase the in-plane scale factor stored per-effect (time-based)
        const growRate = effect.growRate || 0.25; // units per second
        effect.scale = (effect.scale || 1) + growRate * dt;

        // rebuild geometry positions from baseOffsets -> apply spin -> rotate into world tangent -> translate to center -> project to sphere
        const geom = effect.mesh.geometry;
        const posAttr = geom.attributes.position;
        // update spin angle (used to rotate points around the ring center)
        effect.spinAngle = (effect.spinAngle || 0) + (effect.spin * this.simSpeed);
        const sa = effect.spinAngle;
        // compute radius growth from basePositions (they include inner/outer ring coords)
        for(let i=0;i<posAttr.count;i++){
          const base = effect.basePositions[i];
          // base is (x,y,z) in ring-local plane where length(base) is the ring radius at that vertex
          const baseRadius = Math.sqrt(base.x*base.x + base.y*base.y);
          const theta = Math.atan2(base.y, base.x) + sa;
          // scaled radius
          const r = baseRadius * effect.scale;
          // world offset = u * (r*cos) + v * (r*sin)
          const worldOffset = new THREE.Vector3();
          worldOffset.addScaledVector(effect.u, Math.cos(theta) * r);
          worldOffset.addScaledVector(effect.v, Math.sin(theta) * r);
          // compute a shallow dome lift so ring forms a slightly curved dome above the surface
          const maxR = effect.maxBaseRadius * effect.scale;
          const frac = maxR > 0 ? (r / maxR) : 0;
          // exponent controls steepness; >1 makes dome flatter at edges
          const p = 1.8;
          const domeFactor = Math.max(0, 1 - Math.pow(frac, p));
          const lift = (effect.domeHeight || 0.02) * domeFactor;

          // position before projection: center + in-plane offset + small lift along normal
          const worldPos = effect.center.clone().add(worldOffset).add(effect.axis.clone().multiplyScalar(lift));
          // place vertex at exact sphere radius + lift so it's flush/perched correctly
          worldPos.setLength(this.earthRadius + lift);
          posAttr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);
        }
        posAttr.needsUpdate = true;
        geom.computeBoundingSphere();

        // time-based life for synchronized fade (default 2s)
        effect.age = (effect.age || 0) + dt;
        const totalLife = effect.totalLife || 2.0;
        const remaining = Math.max(0, totalLife - effect.age);
        const norm = remaining / totalLife;
        // set ring opacity according to remaining life
        if(effect.mesh && effect.mesh.material) effect.mesh.material.opacity = norm;

        // mushroom: slow rise (along normal) and synchronized fade with the ring
        if(effect.mushroomGroup){
          // slow scale-in to reduce pop
          const slerp = 1 - Math.pow(Math.max(0, effect.age / totalLife), 0.5);
          const scaleFactor = 0.6 + slerp * 0.4; // from initial 0.6 to ~1.0
          effect.mushroomGroup.scale.setScalar(scaleFactor);

          // compute rise: move the mushroom group a small amount along the impact normal each frame
          const riseSpeed = effect.mushroomRiseSpeed || 0.002;
          const liftSoFar = effect._mushroomLiftSoFar || 0;
          const deltaLift = riseSpeed * dt;
          const newLift = Math.min((effect.mushroomMaxLift || 0.1), liftSoFar + deltaLift);
          // apply incremental translation along axis from the original surface position
          const liftDeltaApplied = newLift - liftSoFar;
          if(liftDeltaApplied !== 0){
            effect.mushroomGroup.position.add(effect.axis.clone().multiplyScalar(liftDeltaApplied));
            effect._mushroomLiftSoFar = newLift;
          }

          // fade materials using stored base opacity so fade is deterministic and synchronized
          effect.mushroomGroup.traverse(obj=>{
            if(obj.material){
              const base = obj.userData && obj.userData._baseOpacity ? obj.userData._baseOpacity : 1.0;
              obj.material.opacity = Math.max(0, base * norm);
              obj.material.needsUpdate = true;
            }
          });

          // ensure mushrooms are removed when life ends
          if(effect.age >= totalLife){ if(effect.mushroomGroup.parent) effect.mushroomGroup.parent.remove(effect.mushroomGroup); effect.mushroomGroup = null; }
        }

        // (spin is applied by rotating base positions; don't rotate the mesh itself)

        if(effect.mesh.material.opacity <= 0){ if(effect.mesh.parent) effect.mesh.parent.remove(effect.mesh); }
      });
      // keep effects which still have visible ring or still have a mushroom group
      this.impactEffects = this.impactEffects.filter(e => (e.mesh && e.mesh.material && e.mesh.material.opacity > 0) || (e.mushroomGroup));

      this.meteors = this.meteors.filter(m=>m.active);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  updatePredictedImpact(){
    const speed = parseFloat(document.getElementById('speed')?.value || 0.05);
    const origin = this.camera.position.clone();
    const dir = this.cursor.position.clone().sub(this.camera.position).normalize();
    let pos = origin.clone();
    let v = dir.multiplyScalar(speed);
    let hitPos = null;
    // simple ballistic (scene units)
    const dt = 0.02 * this.simSpeed;
    const steps = 2000;
    for(let i=0;i<steps;i++){
      const r = pos.length();
      const accel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
      v.add(accel.multiplyScalar(dt));
      pos.add(v.clone().multiplyScalar(dt));
      if(pos.length() < this.earthRadius + 0.2){ hitPos = pos.clone(); break; }
      if(pos.length() > 1e4) break;
    }
    if(hitPos){ this.predictedImpactMarker.position.copy(hitPos); this.predictedImpactMarker.visible = true; } else { this.predictedImpactMarker.visible = false; }
  }

  createImpact(position, size = 1){
    // make a larger, size-dependent impact ring + mushroom
    const normal = position.clone().normalize();

  // Map meteor diameter (meters) -> visual impact radius (scene units) using multi-anchor country areas.
  const sizeMeters = Math.max(0.01, size || 1);
  const anchors = [
    { m: 0.1, area: 468 },        // Andorra
    { m: 75.0, area: 78866 },     // Czech
    { m: 100.0, area: 243610 },   // UK
    { m: 10000.0, area: 881913 }, // Pakistan (~10k m)
    { m: 40000.0, area: 2149690 },// Saudi Arabia (~40k m)
    { m: 80000.0, area: 9596961 } // China (~80k m)
  ];
  const anchorR = anchors.map(a => Math.sqrt(a.area / Math.PI) / 1000.0);
  // clamp and find segment
  const minM = anchors[0].m, maxM = anchors[anchors.length-1].m;
  const m = Math.max(minM, Math.min(maxM, sizeMeters));
  let visualBase = anchorR[0];
  if (m <= minM) {
    visualBase = anchorR[0];
  } else if (m >= maxM) {
    visualBase = anchorR[anchorR.length-1];
  } else {
    let seg = 0;
    for (let i = 0; i < anchors.length-1; i++) { if (m >= anchors[i].m && m <= anchors[i+1].m) { seg = i; break; } }
    const m0 = anchors[seg].m, m1 = anchors[seg+1].m;
    const r0 = anchorR[seg], r1 = anchorR[seg+1];
    const u = (m - m0) / Math.max(1e-6, (m1 - m0));
    const gammas = [1.4, 1.05, 0.95, 0.95, 0.98];
    const gamma = gammas[Math.min(gammas.length-1, seg)] || 1.0;
    const uAdj = Math.pow(u, gamma);
    visualBase = r0 + (r1 - r0) * uAdj;
  }

  // ring sizes scaled more aggressively for very large impacts
  const ringInner = visualBase * 0.25;
  const ringOuter = visualBase * 1.35;
  const ringSegs = Math.max(32, Math.floor(32 + visualBase * 128));
  // Create a smooth extruded ring (full circle) using an outer circle shape and an inner hole
  const outer = new THREE.Shape();
  outer.absarc(0, 0, ringOuter, 0, Math.PI * 2, false);
  // inner hole path (counter-clockwise to subtract)
  const hole = new THREE.Path();
  hole.absarc(0, 0, ringInner, 0, Math.PI * 2, false);
  outer.holes.push(hole);
  // extrude to give a flat plate with a slight bevel for smoothness
  // reduce depth so the ring is visually shorter
  const extrudeSettings = { depth: Math.max(0.005, ringOuter * 0.015), bevelEnabled: true, bevelThickness: Math.max(0.003, ringOuter * 0.008), bevelSize: Math.max(0.003, ringOuter * 0.008), bevelSegments: 2, steps: 1 };
  const geo = new THREE.ExtrudeGeometry(outer, extrudeSettings);
    const mat = new THREE.MeshBasicMaterial({ color:0xff4400, side:THREE.DoubleSide, transparent:true, opacity:0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: 1 });
    const ring = new THREE.Mesh(geo, mat);

    // orient ring so its plane is tangent to the sphere at the impact point
    const up = new THREE.Vector3(0,1,0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    ring.quaternion.copy(quat);
    ring.position.copy(normal.clone().multiplyScalar(this.earthRadius));

    // prepare base positions from geometry in ring-local plane coordinates. Use the XY components
    // (ignore extrusion depth) so expansion happens smoothly along the surface.
    const basePositions = [];
    const posAttr = geo.attributes.position;
    for(let i=0;i<posAttr.count;i++){
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      // ignore z (depth) for in-plane base position
      const v = new THREE.Vector3(vx, vy, 0);
      basePositions.push(v);
    }

    // Make mesh have identity transform so we can write world-space positions directly into its geometry
    ring.position.set(0,0,0);
    ring.quaternion.identity();
    this.scene.add(ring);

    // compute orthonormal tangent basis (u,v) on the surface at the impact point
    let u = new THREE.Vector3();
    if (Math.abs(normal.x) < 0.9) u.set(1,0,0).cross(normal).normalize(); else u.set(0,1,0).cross(normal).normalize();
    const v = normal.clone().cross(u).normalize();

    // compute maximum base radius so we can scale dome height relative to ring size
    let maxBaseRadius = 0;
    for (let i=0;i<basePositions.length;i++){ const b = basePositions[i]; const br = Math.sqrt(b.x*b.x + b.y*b.y); if(br>maxBaseRadius) maxBaseRadius = br; }

    // effect state for ring
    const effect = {
      mesh: ring,
      axis: normal.clone(),
      // no spin: semicircle should remain oriented and not spin like the earlier ring
      spin: 0,
      center: position.clone(),
      u: u,
      v: v,
      basePositions: basePositions,
      scale: 1,
      maxBaseRadius: maxBaseRadius,
      domeHeight: Math.max(0.02, Math.min(2.0, maxBaseRadius * 0.75))
    };

    // --- mushroom cloud: build a higher-res, fluffy cap using multiple overlapping spheres (fluffs)
    try{
      const cloudBase = visualBase; // base radius for the cap
      const mushroom = new THREE.Group();

  // stem (short and stubby relative to cloudBase) — increase size for thicker/taller stem
  const stemRadius = cloudBase * 0.35;
  const stemHeight = cloudBase * 1.4;
      const stemGeo = new THREE.CylinderGeometry(Math.max(0.001, stemRadius*0.5), stemRadius, Math.max(0.01, stemHeight), 16, 1);
      const stemMat = new THREE.MeshStandardMaterial({ color:0x333022, roughness:0.95, metalness:0.0, transparent:true, opacity:0.9, depthWrite:false });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(0, stemHeight*0.5, 0);
      mushroom.add(stem);

  // central cap: overlapping spheres to simulate fluff + a blended core for cohesion
  const capMat = new THREE.MeshStandardMaterial({ color:0xCCAA88, roughness:0.92, metalness:0.0, transparent:true, opacity:0.96, depthWrite:false });
  // blended core (slightly flattened, higher-res) to make silhouette cohesive
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), capMat.clone());
  core.scale.set(cloudBase*1.35, cloudBase*0.85, cloudBase*1.35);
  core.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(core);

  const capMain = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), capMat.clone());
  capMain.scale.set(cloudBase*1.2, cloudBase*0.75, cloudBase*1.2);
  capMain.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(capMain);

      // side fluffs — larger and more numerous for a thicker cap
      const fluffCount = Math.max(6, Math.floor(6 + cloudBase * 3));
      for(let i=0;i<fluffCount;i++){
        const a = (i / fluffCount) * Math.PI * 2 + (Math.random()*0.24-0.12);
        const r = cloudBase * (0.28 + Math.random()*0.32); // larger radial offsets
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = stemHeight*0.95 + cloudBase*0.08 + (Math.random()*0.14-0.07);
        const s = cloudBase * (0.38 + Math.random()*0.42); // larger fluffs
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.75, s);
        fluff.position.set(x, y, z);
        fluff.rotation.set(Math.random()*0.25, Math.random()*Math.PI, Math.random()*0.25);
        mushroom.add(fluff);
      }

      // a few smaller top fluffs for a rounded crown
      for(let j=0;j<4;j++){
        const s = cloudBase * (0.30 + Math.random()*0.32);
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.65, s);
        fluff.position.set((Math.random()-0.5)*cloudBase*0.18, stemHeight*0.95 + cloudBase*0.22 + Math.random()*cloudBase*0.06, (Math.random()-0.5)*cloudBase*0.18);
        mushroom.add(fluff);
      }

      // place mushroom on the surface and orient along normal
      const surfacePos = position.clone().setLength(this.earthRadius + 0.001);
      mushroom.position.copy(surfacePos);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), normal.clone());
      mushroom.quaternion.copy(q);
  mushroom.scale.setScalar(1.05);
      this.scene.add(mushroom);

      // Ensure each mushroom material stores a base opacity so we can set a deterministic fade
      mushroom.traverse(obj=>{
        if(obj.material){
          // make transparent if not already
          obj.material.transparent = true;
          // store original opacity on userData so we can fade to norm * base
          obj.userData = obj.userData || {};
          obj.userData._baseOpacity = (typeof obj.material.opacity === 'number') ? obj.material.opacity : 1.0;
        }
      });

  // store animation params
  effect.mushroomGroup = mushroom;
  // make mushroom longer lived; store a faster rise speed and a larger maximum lift
  effect.mushroomLife = 7.5 + Math.min(15.0, visualBase * 10.0); // larger clouds live longer
  // rise speed (scene units per second) - increased to make the mushroom appear taller quicker
  effect.mushroomRiseSpeed = Math.max(0.0001, visualBase * 0.035);
  // maximum lift above the sphere surface (scene units) so mushroom rises taller
  effect.mushroomMaxLift = Math.max(0.02, visualBase * 0.7);
  effect.mushroomBaseScale = cloudBase * 1.1;
    }catch(e){ console.warn('mushroom creation failed', e); }

    this.impactEffects.push(effect);
  }

  // NASA fetchers kept as-is but bound to this
  async fetchAsteroidList(loadMore=false){
    const apiKeyEl = document.getElementById('apiKey');
    const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
    const statusEl = document.getElementById('asteroidData');
    if(!apiKey){ if(statusEl) statusEl.innerHTML = '<span style="color:orange">Enter NASA API key</span>'; return; }
    if(!loadMore) { this.neoPage = 0; this.asteroidList = []; const sel = document.getElementById('asteroidSelect'); if(sel) sel.innerHTML = ''; }
    try{
      const url = `https://api.nasa.gov/neo/rest/v1/neo/browse?page=${this.neoPage||0}&size=20&api_key=${apiKey}`;
      const res = await fetch(url);
      if(!res.ok){
        const txt = await res.text().catch(()=>`HTTP ${res.status}`);
        console.error('Fetch failed', res.status, txt);
        if(statusEl) statusEl.innerHTML = `<span style="color:red">Error fetching asteroids: HTTP ${res.status}</span>`;
        return;
      }
      const data = await res.json();
      if(!data || !data.near_earth_objects){
        console.error('Unexpected API response', data);
        if(statusEl) statusEl.innerHTML = `<span style="color:red">Unexpected API response</span>`;
        return;
      }
      const select = document.getElementById('asteroidSelect');
      data.near_earth_objects.forEach(a=>{
        this.asteroidList = this.asteroidList || [];
        this.asteroidList.push(a);
        if(select){
          // If custom list div is used then create clickable item entries
          if(select.classList && select.classList.contains('custom-list')){
            const item = document.createElement('div'); item.className = 'item'; item.dataset.id = a.id;
            const txt = document.createElement('div'); txt.className = 'label-text'; txt.innerText = `${a.name} (${a.estimated_diameter.meters.estimated_diameter_max.toFixed(0)} m)`;
            item.appendChild(txt);
            // horizontal neon separator between items
            const sep = document.createElement('div'); sep.className = 'neon-sep-horizontal'; item.appendChild(sep);
            // click selects the item; highlight by toggling 'selected'
            item.addEventListener('click', (ev)=>{
              // clear prior selection
              const prev = select.querySelector('.item.selected'); if(prev) prev.classList.remove('selected');
              item.classList.add('selected');
              // store selected id on container for retrieval
              select.dataset.selectedId = a.id;
              // update asteroidData with brief info
              const info = document.getElementById('asteroidData'); if(info) info.innerHTML = `<b>${a.name}</b><br>Diameter: ${a.estimated_diameter.meters.estimated_diameter_max.toFixed(1)} m`;
            });
            select.appendChild(item);
          } else {
            const option = document.createElement('option'); option.value = a.id; option.textContent = `${a.name} (${a.estimated_diameter.meters.estimated_diameter_max.toFixed(0)} m)`; select.appendChild(option);
          }
        }
      });
      this.neoPage = (this.neoPage||0) + 1;
      if(statusEl) statusEl.innerHTML = `Fetched ${this.asteroidList.length} asteroids (page ${this.neoPage})`;
    }catch(err){ console.error('Error fetching asteroids', err); if(statusEl) statusEl.innerHTML = `<span style="color:red">Error fetching asteroids: ${err && err.message ? err.message : 'network error'}</span>`; }
  }

  async fetchAsteroidDetails(id){
    const apiKey = document.getElementById('apiKey')?.value.trim(); if(!apiKey) return null;
    try{ const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${id}?api_key=${apiKey}`); return await res.json(); }catch(err){ console.error(err); return null; }
  }

  async spawnSelectedAsteroid(){
  const select = document.getElementById('asteroidSelect');
  // support both native <select> (select.value) and custom-list (dataset.selectedId)
  const selectedId = select ? (select.dataset && select.dataset.selectedId ? select.dataset.selectedId : (select.value || '')) : '';
  if(!selectedId) return; // silently no-op when nothing selected
  const details = await this.fetchAsteroidDetails(selectedId) || (this.asteroidList||[]).find(a=>a.id===selectedId);
    if(!details) return alert('Could not fetch asteroid details');
    const size = details.estimated_diameter.meters.estimated_diameter_max;
    const approach = parseFloat(details.close_approach_data[0].miss_distance.kilometers);
    const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second);
    document.getElementById('asteroidData').innerHTML = `<b>${details.name}</b><br>Diameter: ${size.toFixed(1)} m<br>Miss distance: ${approach.toFixed(0)} km<br>Velocity: ${velocity.toFixed(1)} km/s`;
    // create meteor mesh using the same generator so visual mapping applies
    const meteor = this.createMeteorMesh(size, Math.floor(Math.random()*0xffffffff));
    // spawn near the mouse cursor: raycast into the scene and place the meteor a bit behind the hit point (toward the camera)
    // default fallback: spawn 1.2 units in front of camera
    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion).normalize();
    let spawnPos = this.camera.position.clone().add(forward.clone().multiplyScalar(1.2));
    try{
      // use stored this.mouse (updated in onMouseMove). Raycast to find intersection point with either Earth or a plane in front of camera
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const targets = [];
      if(this.earth) targets.push(this.earth);
      for(const m of (this.meteors||[])) if(m && m.mesh) targets.push(m.mesh);
      const hits = targets.length ? this.raycaster.intersectObjects(targets, true) : [];
      if(hits && hits.length){
        const hitPoint = hits[0].point.clone();
        // place meteor a bit behind the hit point towards the camera so it appears between camera and hit
        const backOff = Math.min( (this.camera.position.distanceTo(hitPoint) * 0.25), 5 ); // up to 5 scene units
        spawnPos = hitPoint.clone().sub(this.camera.position).normalize().multiplyScalar(-backOff).add(hitPoint);
      } else {
        // if nothing hit, intersect a plane 5 units in front of camera (same as earlier plane logic)
        const planeZ = new THREE.Plane(new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion), -5);
        const ip = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(planeZ, ip);
        if(ip) spawnPos = ip.clone().add(this.camera.position.clone().sub(ip).normalize().multiplyScalar(-0.5));
      }
    }catch(e){ /* fallback to camera-front spawnPos already set */ }
    meteor.position.copy(spawnPos);
    // compute aim direction toward predictedImpactMarker if available, else forward
    const aimDir = (this.predictedImpactMarker && this.predictedImpactMarker.visible) ? this.predictedImpactMarker.position.clone().sub(meteor.position).normalize() : forward.clone();
    const density = 3000; const volume = (4/3)*Math.PI*Math.pow(size/2,3); const mass = density*volume; const area = Math.PI*Math.pow(size/2,2);
    this.scene.add(meteor);
    const label = this.createLabel(`${details.name} (${size.toFixed(0)} m)`, meteor.position);
    // Attach asteroid id metadata so labels can be preserved after impact
    meteor.asteroidId = details.id;
    if(label) label.asteroidId = details.id;
    // Do NOT auto-frame the camera on spawn per user preference (disable camera rotate/centering)
  // show size in UI
  const selLabel = document.getElementById('asteroidData'); if(selLabel) selLabel.innerHTML += `<div>Spawned size: ${size.toFixed(0)} m</div>`;
  const physVel = aimDir.clone().multiplyScalar(velocity*1000);
  const sceneVel = aimDir.clone().multiplyScalar((velocity) * (1/this.SCENE_SCALE) * 0.6);
  this.meteors.push({ mesh:meteor, velocity:sceneVel, physVelocity:physVel, active:true, mass, area, size, label });
  }

  loadHighResEarthTexture(){
    // First ask user for a USGS (or other) URL to prioritize
    const userUrl = window.prompt('Enter a USGS or remote Earth texture URL (leave blank to use defaults):', '');
    const urls = [];
    if(userUrl && userUrl.trim()) urls.push(userUrl.trim());
    // defaults (NASA Blue Marble, then fallback world map)
    urls.push('https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2012044_lrg.jpg');
    urls.push('https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg');
    const loader = new THREE.TextureLoader();
    let tried = 0;
    const tryLoad = ()=>{
      if(tried>=urls.length) return alert('All texture loads failed (CORS or network)');
      const url = urls[tried++];
      loader.load(url, tex=>{
        const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
        if(earth && earth.material){
            // ensure material doesn't tint the incoming texture (avoid black-looking map)
            if(earth.material.color) earth.material.color.setHex(0xffffff);
            tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            earth.material.map = tex;
            earth.material.needsUpdate = true;
          }
      }, undefined, err=>{ console.warn('Texture load failed', url, err); tryLoad(); });
    };
    tryLoad();
  }

  onWindowResize(){ if(!this.camera||!this.renderer) return; this.camera.aspect = window.innerWidth/window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); }
}

const app = new App();
app.init();
app.animate();

// expose for debugging
window.app = app;
