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

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Earth
    const earthGeo = new THREE.SphereGeometry(this.earthRadius, 32, 32);
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x2233ff });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    this.scene.add(earth);
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
    const cameraLight = new THREE.PointLight(0xffeecc, 1.0, 100);
    this.camera.add(cameraLight);

    // cursor group
    this.cursor = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.05, 0.08, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'cursorRing';
    this.cursor.add(ring);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.9 });
    const crossSize = 0.06;
    const crossXGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-crossSize, 0, 0), new THREE.Vector3(crossSize, 0, 0)]);
    const crossYGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -crossSize, 0), new THREE.Vector3(0, crossSize, 0)]);
    this.cursor.add(new THREE.Line(crossXGeo, lineMat));
    this.cursor.add(new THREE.Line(crossYGeo, lineMat));
    this.scene.add(this.cursor);

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

    // mouse-follow cursor
    const mcGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const mcMat = new THREE.MeshBasicMaterial({ color: 0xffff66 });
    const mouseCursor = new THREE.Mesh(mcGeo, mcMat);
    mouseCursor.name = 'mouseCursor';
    this.scene.add(mouseCursor);

    // events
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // wire basic UI elements safely
    const el = id => document.getElementById(id);
    if (el('simSpeed')) el('simSpeed').oninput = (e) => { this.simSpeed = parseFloat(e.target.value); if (el('simSpeedVal')) el('simSpeedVal').innerText = parseFloat(e.target.value).toFixed(2); };
    if (el('speed')) { const s = el('speed'); if (el('speedVal')) el('speedVal').innerText = s.value; s.oninput = (e) => { if (el('speedVal')) el('speedVal').innerText = parseFloat(e.target.value).toFixed(2); }; }
    if (el('reset')) el('reset').onclick = () => this.resetScene();
    if (el('pause')) el('pause').onclick = (e) => { this.paused = !this.paused; e.target.innerText = this.paused ? 'Resume' : 'Pause'; };
    if (el('toggleAiming')) el('toggleAiming').onclick = (e) => { this.showAiming = !this.showAiming; e.target.innerText = this.showAiming ? 'Hide Aiming' : 'Show Aiming'; const aim = this.scene.getObjectByName('aimingLine'); if (aim) aim.visible = this.showAiming; };
  if (el('fire')) el('fire').onclick = () => this.shootMeteor();
  // wire meteor size UI
  const ms = el('meteorSize'); if(ms){ const mv = el('meteorSizeVal'); mv.innerText = ms.value; ms.oninput = (e)=>{ if(mv) mv.innerText = parseFloat(e.target.value).toFixed(1); }; }
    if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
    const uploadInput = el('uploadTex');
    if (uploadInput) uploadInput.addEventListener('change', (ev) => this.onUploadTexture(ev));
    const realBtn = el('toggleRealism'); if(realBtn) realBtn.onclick = (e)=>{ this.realistic = !this.realistic; e.target.innerText = this.realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };

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
    if(this.cursor) {
      this.cursor.position.copy(intersection);
      this.cursor.lookAt(this.camera.position);
      const ringMesh = this.cursor.getObjectByName('cursorRing');
      if(ringMesh) ringMesh.rotation.copy(new THREE.Euler(Math.PI/2,0,0));
    }
  }

  onKeyDown(event) { if(event.code === 'Space') this.shootMeteor(); }

  shootMeteor() {
    const speedEl = document.getElementById('speed');
    const speed = speedEl ? parseFloat(speedEl.value) : 0.05;
    const sizeEl = document.getElementById('meteorSize');
    const size = sizeEl ? parseFloat(sizeEl.value) : 0.5;
  // create a textured, irregular 3D meteor mesh sized according to `size` (meters)
  const meteor = this.createMeteorMesh(size);
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
  createMeteorMesh(sizeMeters){
  // smooth sphere geometry for a ball-like meteor (increased resolution for crisper craters)
  const widthSeg = 96; // was 48
  const heightSeg = 64; // was 32
  const geom = new THREE.SphereGeometry(1, widthSeg, heightSeg);

    // create a PBR-friendly material; we'll set the map when the texture loads
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.9, metalness:0.02, transparent:true });
    const mesh = new THREE.Mesh(geom, mat);

    // try to load an external meteor texture image located at project root
    const loader = new THREE.TextureLoader();
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
            // user requested deeper craters here
            const maxDepth = 0.09; // increased depth for more pronounced, but still controlled, inward domes
            const thresholdLow = 0.20; // darkness threshold where crater starts
            const thresholdHigh = 0.75; // darkness where crater is strongest
            const blurRadiusPx = Math.max(2, Math.floor(Math.min(w,h) * 0.02)); // slightly larger blur for smoother domes

            const posAttr = geom.attributes.position;
            const uvAttr = geom.attributes.uv;
            if(!uvAttr) return null;

            // smoothstep helper
            const smoothstep = (edge0, edge1, x) => {
              const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
              return t * t * (3 - 2 * t);
            };

            // build a blurred height map (brightness -> height) using a box blur; height = darkness
            const height = new Float32Array(w*h);
            const r = blurRadiusPx;
            for(let py=0; py<h; py++){
              for(let px=0; px<w; px++){
                let sum = 0, count = 0;
                for(let oy=-r; oy<=r; oy++){
                  const sy = Math.min(h-1, Math.max(0, py + oy));
                  for(let ox=-r; ox<=r; ox++){
                    const sx = Math.min(w-1, Math.max(0, px + ox));
                    const idx = (sy * w + sx) * 4;
                    const rr = srcImg.data[idx], gg = srcImg.data[idx+1], bb = srcImg.data[idx+2];
                    sum += (rr + gg + bb) / 3;
                    count++;
                  }
                }
                const avg = (sum / count) / 255.0;
                height[py*w + px] = 1.0 - avg; // darkness as height (0..1)
              }
            }

            // use the height map to displace vertices inward by a smooth dome amount
            for(let i=0;i<posAttr.count;i++){
              const u = uvAttr.getX(i);
              const v = uvAttr.getY(i);
              // nearest pixel sample from blurred height
              const cx = Math.floor(u * (w - 1));
              const cy = Math.floor((1 - v) * (h - 1));
              const hval = height[cy * w + cx] || 0;
              // crater strength derived from height with smoothstep thresholding
              const craterStrength = smoothstep(thresholdLow, thresholdHigh, hval);
              if(craterStrength <= 0) continue;

              // get current vertex and normal (on unit sphere approximation)
              const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
              const norm = new THREE.Vector3(x, y, z).normalize();

              // displace only inward (toward center) scaled by craterStrength
              const disp = craterStrength * maxDepth;
              const newPos = norm.clone().multiplyScalar(1 - disp);
              posAttr.setXYZ(i, newPos.x, newPos.y, newPos.z);
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
              // strength factor controls how pronounced the normals appear
              const strength = Math.max(0.8, maxDepth * 24.0);
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
              normalTex.needsUpdate = true;
              // assign both albedo and normal map to material
              mat.normalMap = normalTex;
              // user requested less aggressive normal strength
              mat.normalScale = new THREE.Vector2(0.25, 0.25);
            }catch(err){ console.warn('normal map bake failed', err); }

            return finalTex;
          }catch(err){ console.warn('applyCratersFromImage failed', err); return null; }
        };

        if(img && img.width && img.height){
          // create a darker, crater-sculpted texture and assign it
          const craterTex = applyCratersFromImage(img);
          if(craterTex){ mat.map = craterTex; }
          else { tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1,1); mat.map = tex; }
        } else {
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1,1); mat.map = tex;
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

  // Map meteor diameter (meters) to a visual radius using a wide dynamic-range mapping
  // Endpoints: 0.1 m -> Andorra (very small), 25 m -> Montenegro (medium), 50 m -> Slovenia (large)
  const MIN_MET = 0.1, MAX_MET = 50.0;
  // Representative country areas (km^2) for visual anchors
  const AREA_ANDORRA = 468;    // Andorra ~468 km^2 (tiny)
  const AREA_MONTENEGRO = 13812; // Montenegro ~13.8k km^2 (medium)
  const AREA_SLOVENIA = 20273; // Slovenia ~20.3k km^2 (large)
  const radiusAndorra = Math.sqrt(AREA_ANDORRA / Math.PI) / 1000.0;
  const radiusMontenegro = Math.sqrt(AREA_MONTENEGRO / Math.PI) / 1000.0;
  const radiusSlovenia = Math.sqrt(AREA_SLOVENIA / Math.PI) / 1000.0;
  // normalize input size (0..1)
  const tRaw = (sizeMeters - MIN_MET) / (MAX_MET - MIN_MET);
  const t = Math.max(0, Math.min(1, tRaw));
  // bias growth so mid values map near Montenegro and larger values approach Slovenia
  const gamma = 1.6;
  const tAdj = Math.pow(t, gamma);
  // interpolate between Andorra and Slovenia (Montenegro sits mid-range)
  const visualRadiusBase = radiusAndorra + (radiusSlovenia - radiusAndorra) * tAdj;
  // optional visual amplifier, smaller now that endpoints are closer
  const VISUAL_AMPLIFIER = 1.2;
  const visualRadius = visualRadiusBase * VISUAL_AMPLIFIER;
  // clamp and set meteor scale (scene units)
  mesh.scale.setScalar(Math.max(visualRadius, 0.005));

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  // Generate a simple procedural meteor texture as a CanvasTexture fallback
  createProceduralMeteorTexture(){
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    // base color
    ctx.fillStyle = '#9a8f85'; ctx.fillRect(0,0,size,size);
    // noisy overlay
    const image = ctx.getImageData(0,0,size,size);
    for(let y=0;y<size;y++){
      for(let x=0;x<size;x++){
        const i = (y*size + x) * 4;
        const n = Math.floor(40 * Math.random()) - 20;
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
    const mouseCursor = this.scene.getObjectByName('mouseCursor'); if(mouseCursor){ mouseCursor.position.copy(this.cursor.position); }

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
        const dt = 0.02 * this.simSpeed;
        // semi-implicit Euler gravity approximation (faster)
        const rmag = posMeters.length();
        const g = posMeters.clone().multiplyScalar(-this.G*this.earthMass/(rmag*rmag*rmag));
        meteor.physVelocity.add(g.multiplyScalar(dt));
        posMeters.add(meteor.physVelocity.clone().multiplyScalar(dt));
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
        if(meteor.mesh.material.opacity <= 0){ meteor.active = false; if(meteor.mesh.parent) meteor.mesh.parent.remove(meteor.mesh); if(meteor.label && meteor.label.element) meteor.label.element.remove(); }
      }

      if(r < this.earthRadius + 0.2){
        meteor.active = false;
        this.createImpact(pos.clone(), meteor.size);
        this.scene.remove(meteor.mesh);
        if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element);
        const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1);
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

  // Map meteor diameter (meters) to a visual size in scene units.
  // Invert and compress the mapping so small meteors appear relatively larger and big meteors are less gigantic.
  // This produces the behavior you requested: small meteors' rings/mushrooms are more visible, large meteors are visually tempered.
  const sizeMeters = Math.max(0.01, size || 1);
  // Map meteor diameter (meters) -> visual impact radius (scene units) using
  // a smooth, non-linear interpolation so:
  //  - very small meteors (~0.1 m) -> small impact (approx area of Ireland)
  //  - medium meteors (~22-30 m) -> medium impact (approx area of Poland)
  //  - very large meteors (~50 m) -> large impact (approx area of Algeria)
  // We convert representative country areas -> equivalent circular radii (km) then to scene units
  // (1 scene unit == 1000 km because SCENE_SCALE = 1e6 m / scene unit).
  const MIN_MET = 0.1; // meters slider min
  const MAX_MET = 50.0; // meters slider max
  // Representative country areas (km^2) for visual anchors: Andorra (tiny) -> Montenegro (mid) -> Slovenia (larger)
  const AREA_ANDORRA = 468; // km^2
  const AREA_MONTENEGRO = 13812; // km^2
  const AREA_SLOVENIA = 20273; // km^2
  const radiusAndorra = Math.sqrt(AREA_ANDORRA / Math.PI) / 1000.0;
  const radiusMontenegro = Math.sqrt(AREA_MONTENEGRO / Math.PI) / 1000.0;
  const radiusSlovenia = Math.sqrt(AREA_SLOVENIA / Math.PI) / 1000.0;

  // normalize input size (0..1)
  const tRaw = (sizeMeters - MIN_MET) / (MAX_MET - MIN_MET);
  const t = Math.max(0, Math.min(1, tRaw));
  // bias toward Montenegro for mid values
  const gamma = 2.0; // tuned so ~25m maps near Montenegro radius
  const tAdj = Math.pow(t, gamma);
  // interpolate between Andorra and Slovenia radii
  const visualBase = radiusAndorra + (radiusSlovenia - radiusAndorra) * tAdj;

    // Create ring geometry sized relative to visualBase
  const ringInner = visualBase * 0.30;
  const ringOuter = visualBase * 0.85;
    const ringSegs = Math.max(32, Math.floor(16 + visualBase * 64));
    const geo = new THREE.RingGeometry(ringInner, ringOuter, ringSegs);
    const mat = new THREE.MeshBasicMaterial({ color:0xff4400, side:THREE.DoubleSide, transparent:true, opacity:0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: 1 });
    const ring = new THREE.Mesh(geo, mat);

    // orient ring so its plane is tangent to the sphere at the impact point
    const up = new THREE.Vector3(0,1,0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    ring.quaternion.copy(quat);
    ring.position.copy(normal.clone().multiplyScalar(this.earthRadius));

    // prepare base positions from geometry in ring-local plane coordinates and apply a random in-plane rotation
    const basePositions = [];
    const posAttr = geo.attributes.position;
    const inPlaneAngle = Math.random() * Math.PI * 2;
    const rotLocal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), inPlaneAngle);
    for(let i=0;i<posAttr.count;i++){
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const v = new THREE.Vector3(vx, vy, vz);
      v.applyQuaternion(rotLocal);
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
      spin: (0.02 + Math.random() * 0.06) * (Math.random() < 0.5 ? 1 : -1),
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

      // stem (short and stubby relative to cloudBase)
      const stemRadius = cloudBase * 0.22;
      const stemHeight = cloudBase * 0.9;
      const stemGeo = new THREE.CylinderGeometry(Math.max(0.001, stemRadius*0.5), stemRadius, Math.max(0.01, stemHeight), 16, 1);
      const stemMat = new THREE.MeshStandardMaterial({ color:0x333022, roughness:0.95, metalness:0.0, transparent:true, opacity:0.9, depthWrite:false });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(0, stemHeight*0.5, 0);
      mushroom.add(stem);

  // central cap: overlapping spheres to simulate fluff + a blended core for cohesion
  const capMat = new THREE.MeshStandardMaterial({ color:0xCCAA88, roughness:0.92, metalness:0.0, transparent:true, opacity:0.96, depthWrite:false });
  // blended core (slightly flattened, higher-res) to make silhouette cohesive
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), capMat.clone());
  core.scale.set(cloudBase*1.05, cloudBase*0.65, cloudBase*1.05);
  core.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(core);

  const capMain = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), capMat.clone());
  capMain.scale.set(cloudBase*0.9, cloudBase*0.55, cloudBase*0.9);
  capMain.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(capMain);

      // side fluffs
      // place fluffs tightly around the core with smaller sizes so they don't protrude too much
      const fluffCount = Math.max(4, Math.floor(4 + cloudBase * 2));
      for(let i=0;i<fluffCount;i++){
        const a = (i / fluffCount) * Math.PI * 2 + (Math.random()*0.12-0.06);
        const r = cloudBase * (0.18 + Math.random()*0.18); // tighter radial offsets
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = stemHeight*0.9 + cloudBase*0.05 + (Math.random()*0.08-0.03);
        const s = cloudBase * (0.22 + Math.random()*0.25); // smaller fluffs
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.65, s);
        fluff.position.set(x, y, z);
        fluff.rotation.set(Math.random()*0.15, Math.random()*Math.PI, Math.random()*0.15);
        mushroom.add(fluff);
      }

      // a few smaller top fluffs for a rounded crown
      for(let j=0;j<3;j++){
        const s = cloudBase * (0.20 + Math.random()*0.22);
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.55, s);
        fluff.position.set((Math.random()-0.5)*cloudBase*0.12, stemHeight*0.9 + cloudBase*0.16 + Math.random()*cloudBase*0.04, (Math.random()-0.5)*cloudBase*0.12);
        mushroom.add(fluff);
      }

      // place mushroom on the surface and orient along normal
      const surfacePos = position.clone().setLength(this.earthRadius + 0.001);
      mushroom.position.copy(surfacePos);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), normal.clone());
      mushroom.quaternion.copy(q);
      mushroom.scale.setScalar(0.6);
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
      // make mushroom slow and longer lived; store a rise speed and a maximum lift above the surface
      effect.mushroomLife = 4.0 + Math.min(10.0, visualBase * 6.0); // larger clouds live longer
      // rise speed (scene units per second) - small and proportional to visualBase, tuned for subtlety
      effect.mushroomRiseSpeed = Math.max(0.00005, visualBase * 0.02);
      // maximum lift above the sphere surface (scene units) so mushroom never 'launches' to space
      effect.mushroomMaxLift = Math.max(0.01, visualBase * 0.45);
      effect.mushroomBaseScale = cloudBase;
    }catch(e){ console.warn('mushroom creation failed', e); }

    this.impactEffects.push(effect);
  }

  // NASA fetchers kept as-is but bound to this
  async fetchAsteroidList(loadMore=false){
    const apiKey = document.getElementById('apiKey')?.value.trim();
    if(!apiKey) return alert('Enter NASA API key');
    if(!loadMore) { this.neoPage = 0; this.asteroidList = []; document.getElementById('asteroidSelect').innerHTML = ''; }
    try{
      const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/browse?page=${this.neoPage||0}&size=20&api_key=${apiKey}`);
      const data = await res.json();
      const select = document.getElementById('asteroidSelect');
      data.near_earth_objects.forEach(a=>{
        this.asteroidList = this.asteroidList || [];
        this.asteroidList.push(a);
        const option = document.createElement('option'); option.value = a.id; option.textContent = `${a.name} (${a.estimated_diameter.meters.estimated_diameter_max.toFixed(0)} m)`; select.appendChild(option);
      });
      this.neoPage = (this.neoPage||0) + 1;
      document.getElementById('asteroidData').innerHTML = `Fetched ${this.asteroidList.length} asteroids (page ${this.neoPage})`;
    }catch(err){ console.error(err); alert('Error fetching asteroids'); }
  }

  async fetchAsteroidDetails(id){
    const apiKey = document.getElementById('apiKey')?.value.trim(); if(!apiKey) return null;
    try{ const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${id}?api_key=${apiKey}`); return await res.json(); }catch(err){ console.error(err); return null; }
  }

  async spawnSelectedAsteroid(){
    const select = document.getElementById('asteroidSelect'); if(!select.value) return alert('Select an asteroid');
    const details = await this.fetchAsteroidDetails(select.value) || (this.asteroidList||[]).find(a=>a.id===select.value);
    if(!details) return alert('Could not fetch asteroid details');
    const size = details.estimated_diameter.meters.estimated_diameter_max;
    const approach = parseFloat(details.close_approach_data[0].miss_distance.kilometers);
    const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second);
    document.getElementById('asteroidData').innerHTML = `<b>${details.name}</b><br>Diameter: ${size.toFixed(1)} m<br>Miss distance: ${approach.toFixed(0)} km<br>Velocity: ${velocity.toFixed(1)} km/s`;
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({ color:0xaaaaaa, metalness:0.1, roughness:0.6 });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    const approachMeters = approach * 1000;
    meteor.position.set(0,0, approachMeters / this.SCENE_SCALE);
    const dir = new THREE.Vector3(0,0,-1).normalize();
    const density = 3000; const volume = (4/3)*Math.PI*Math.pow(size/2,3); const mass = density*volume; const area = Math.PI*Math.pow(size/2,2);
  this.scene.add(meteor);
  const meterToScene = 1/this.SCENE_SCALE;
  const radiusScene = (size / 2) * meterToScene; // size is diameter in meters
  meteor.scale.setScalar(Math.max(radiusScene, 1e-6));
  const label = this.createLabel(`${details.name} (${size.toFixed(0)} m)`, meteor.position);
    // Frame camera to the spawned meteor: position the camera at a distance proportional to size
    try{
      const distanceMeters = Math.max(size * 10, 1000); // aim for ~10x diameter or 1km min
      const distanceScene = distanceMeters / this.SCENE_SCALE;
      const meteorWorldPos = meteor.position.clone();
      // camera end position: along +Z from meteor so it looks toward the origin
      const endCamPos = meteorWorldPos.clone().add(new THREE.Vector3(0, distanceScene * 0.7, distanceScene * 1.2));
      this.frameCameraTo(meteorWorldPos, endCamPos, 1200);
    }catch(e){ console.warn('Framing failed', e); }
  // show size in UI
  const selLabel = document.getElementById('asteroidData'); if(selLabel) selLabel.innerHTML += `<div>Spawned size: ${size.toFixed(0)} m</div>`;
    const physVel = dir.clone().multiplyScalar(velocity*1000);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(velocity/50), physVelocity:physVel, active:true, mass, area, size });
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
