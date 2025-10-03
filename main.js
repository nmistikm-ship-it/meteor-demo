import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let earth, sun;
let meteors = [], impactEffects = [];
let cursor;
let asteroidList = [];
let simSpeed = 1;

// Realistic physics constants (SI-ish, scene scaled)
let realistic = false;
const G = 6.67430e-11; // gravitational constant
const earthMass = 5.972e24; // kg
const earthRadiusMeters = 6371000; // meters
// Scene scale: 1 scene unit = 1,000,000 meters (1000 km) to match existing earthRadius scene units
const SCENE_SCALE = 1e6; // meters per scene unit

const earthRadius = 6371 / 1000; // km -> scene units
const gravityStrength = 0.02;

let mouse = new THREE.Vector2();
let raycaster = new THREE.Raycaster();

let paused = false;
let impactCount = 0;
let showAiming = true;
let predictedImpactMarker = null;

const labels = [];

function createLabel(text, position) {
  const div = document.createElement('div');
  div.className = 'label';
  div.style.position = 'absolute';
  div.style.color = 'white';
  div.style.fontSize = '14px';
  div.innerText = text;
  document.body.appendChild(div);

  return { element: div, position };
}

function updateLabels() {
  labels.forEach(label => {
    const vector = label.position.clone();
    vector.project(camera);

    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;

    label.element.style.left = `${x}px`;
    label.element.style.top = `${y}px`;
  });
}


// ---------------- INIT ----------------
init();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0,3,15);
  // add camera to scene so camera-attached lights are part of scene graph
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);

  // Earth
  const earthGeo = new THREE.SphereGeometry(earthRadius,32,32);
  const earthMat = new THREE.MeshPhongMaterial({ color:0x2233ff });
  earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);
  labels.push( createLabel("Earth", new THREE.Vector3(0, earthRadius + 0.2, 0)) );

  // Sun
  const sunGeo = new THREE.SphereGeometry(1,32,32);
  const sunMat = new THREE.MeshBasicMaterial({ color:0xffffaa });
  sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(10,10,10);
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0xffffff,0.3));
  // Improved lighting
  const hemi = new THREE.HemisphereLight(0xAAAAFF, 0x222244, 0.6);
  scene.add(hemi);
  const dirLight = new THREE.DirectionalLight(0xffffff,1.0);
  dirLight.position.copy(sun.position);
  dirLight.castShadow = false;
  scene.add(dirLight);
  // subtle camera rim light to highlight meteors
  const cameraLight = new THREE.PointLight(0xffeecc, 1.0, 100);
  camera.add(cameraLight);

  // Cursor (improved): group with ring + crosshair + aiming line
  cursor = new THREE.Group();

  const ringGeo = new THREE.RingGeometry(0.05,0.08,32);
  const ringMat = new THREE.MeshBasicMaterial({ color:0xffff00, side:THREE.DoubleSide, transparent:true, opacity:0.9 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'cursorRing';
  cursor.add(ring);

  // crosshair lines
  const lineMat = new THREE.LineBasicMaterial({ color:0xffff00, transparent:true, opacity:0.9 });
  const crossSize = 0.06;
  const crossXGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-crossSize,0,0), new THREE.Vector3(crossSize,0,0)]);
  const crossYGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-crossSize,0), new THREE.Vector3(0,crossSize,0)]);
  const crossX = new THREE.Line(crossXGeo, lineMat);
  const crossY = new THREE.Line(crossYGeo, lineMat);
  cursor.add(crossX);
  cursor.add(crossY);

  scene.add(cursor);

  // Aiming line from camera to cursor
  const aimMat = new THREE.LineBasicMaterial({ color:0xffaa00, transparent:true, opacity:0.6 });
  const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0,0,-1)]);
  const aimingLine = new THREE.Line(aimGeo, aimMat);
  aimingLine.name = 'aimingLine';
  scene.add(aimingLine);

  // Events
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  document.getElementById('fetch').onclick = fetchAsteroidList;
  document.getElementById('spawnAsteroid').onclick = spawnSelectedAsteroid;
  document.getElementById('simSpeed').oninput = e => simSpeed = parseFloat(e.target.value);
  document.getElementById('loadMore').onclick = ()=> fetchAsteroidList(true);
  document.getElementById('highResTex').onclick = loadHighResEarthTexture;
  // support local upload of an Earth texture to avoid CORS issues
  const uploadInput = document.getElementById('uploadTex');
  if(uploadInput){
    uploadInput.addEventListener('change', (ev)=>{
      const f = ev.target.files && ev.target.files[0];
      if(!f) return;
      const url = URL.createObjectURL(f);
      const loader = new THREE.TextureLoader();
      loader.load(url, tex=>{
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if(earth && earth.material){ earth.material.map = tex; earth.material.needsUpdate = true; }
        URL.revokeObjectURL(url);
      }, undefined, err=>{ console.error('Local texture load failed', err); alert('Local texture failed to load'); });
    });
  }

  // UI wiring
  const simSpeedSlider = document.getElementById('simSpeed');
  const simSpeedVal = document.getElementById('simSpeedVal');
  simSpeedSlider.oninput = e=>{ simSpeed = parseFloat(e.target.value); simSpeedVal.innerText = parseFloat(e.target.value).toFixed(2); };

  const speedSlider = document.getElementById('speed');
  const speedVal = document.getElementById('speedVal');
  speedVal.innerText = speedSlider.value;
  speedSlider.oninput = e=>{ speedVal.innerText = parseFloat(e.target.value).toFixed(2); };

  document.getElementById('reset').onclick = ()=>{
    // remove meteors
    meteors.forEach(m=>{ if(m.mesh) scene.remove(m.mesh); if(m.label && m.label.element) m.label.element.remove(); });
    meteors = [];
    impactEffects.forEach(e=>{ if(e.mesh) scene.remove(e.mesh); });
    impactEffects = [];
    impactCount = 0; document.getElementById('impactCount').innerText = impactCount;
  };

  document.getElementById('pause').onclick = e=>{ paused = !paused; e.target.innerText = paused ? 'Resume' : 'Pause'; };

  document.getElementById('toggleAiming').onclick = e=>{ showAiming = !showAiming; e.target.innerText = showAiming ? 'Hide Aiming' : 'Show Aiming'; scene.getObjectByName('aimingLine').visible = showAiming; };

  document.getElementById('fire').onclick = ()=> shootMeteor();

  // remove click-to-shoot: we only fire with Space or UI button

  // predicted impact marker
  const pGeo = new THREE.SphereGeometry(0.03,8,8);
  const pMat = new THREE.MeshBasicMaterial({ color:0xff5500 });
  predictedImpactMarker = new THREE.Mesh(pGeo,pMat);
  predictedImpactMarker.visible = false;
  scene.add(predictedImpactMarker);

  // yellow mouse-follow cursor (billboard)
  const mcGeo = new THREE.SphereGeometry(0.03,8,8);
  const mcMat = new THREE.MeshBasicMaterial({ color:0xffff66 });
  const mouseCursor = new THREE.Mesh(mcGeo, mcMat);
  mouseCursor.name = 'mouseCursor';
  scene.add(mouseCursor);

  // realism toggle
  const realBtn = document.getElementById('toggleRealism');
  if(realBtn) realBtn.onclick = e=>{ realistic = !realistic; e.target.innerText = realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };

  // ensure aiming line visibility initial
  const aim = scene.getObjectByName('aimingLine'); if(aim) aim.visible = showAiming;
}

// ---------------- INPUT ----------------
function onMouseMove(event) {
  mouse.x = (event.clientX/window.innerWidth)*2-1;
  mouse.y = -(event.clientY/window.innerHeight)*2+1;

  raycaster.setFromCamera(mouse, camera);
  const planeZ = new THREE.Plane(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion), -5);
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(planeZ, intersection);

  cursor.position.copy(intersection);
  // keep cursor oriented to camera
  cursor.lookAt(camera.position);
  // small offset so ring sits facing camera
  const ringMesh = cursor.getObjectByName('cursorRing');
  if(ringMesh) ringMesh.rotation.copy(new THREE.Euler(Math.PI/2,0,0));
}

function onKeyDown(event){
  if(event.code === "Space") shootMeteor();
}

// ---------------- METEORS ----------------
function shootMeteor() {
  const speedSlider = document.getElementById('speed');
  const speed = parseFloat(speedSlider.value);

  // Create meteor with physical properties
  const size = 0.5; // meters diameter (default)
  // create unit geometry in meters (1m radius) and scale to desired size in scene units
  const meteorGeo = new THREE.SphereGeometry(1, 16, 16); // 1 meter unit geometry
  const meteorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.2, roughness:0.5, emissive:0x000000 });
  const meteor = new THREE.Mesh(meteorGeo, meteorMat);

  meteor.position.copy(camera.position);
  const dir = new THREE.Vector3();
  dir.subVectors(cursor.position, camera.position).normalize();

  // Physical properties
  const density = 3000; // kg/m^3 (typical rock)
  const volume = (4/3)*Math.PI*Math.pow(size/2,3);
  const mass = density * volume; // kg
  const area = Math.PI * Math.pow(size/2,2); // m^2

  scene.add(meteor);
  const meteorLabel = createLabel("Meteor", meteor.position);
  // velocity stored in scene units per frame; we store SI m/s in physVelocity
  const physVelocity = dir.clone().multiplyScalar(speed * SCENE_SCALE); // m/s (approx)
  // scale geometry: geometry units are meters, so convert meters -> scene units
  const meterToScene = 1/SCENE_SCALE;
  const visualMin = 0.02; // scene units
  const visScale = Math.max(size * meterToScene, visualMin);
  meteor.scale.setScalar(visScale);
  meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(speed), physVelocity:physVelocity, active:true, label:meteorLabel, mass, area, size });
  labels.push(meteorLabel);
}

// ---------------- ANIMATION ----------------
function animate() {
  requestAnimationFrame(animate);
  // pulse cursor
  const ringMesh = cursor.getObjectByName && cursor.getObjectByName('cursorRing');
  if(ringMesh){
    const pulse = 1 + 0.1 * Math.sin(Date.now() * 0.005);
    cursor.scale.set(pulse, pulse, pulse);
  }

  // update aiming line from camera to cursor
  const aimingLine = scene.getObjectByName && scene.getObjectByName('aimingLine');
  if(aimingLine){
    const positions = aimingLine.geometry.attributes.position.array;
    // start = camera position
    positions[0] = camera.position.x;
    positions[1] = camera.position.y;
    positions[2] = camera.position.z;
    // end = cursor position
    positions[3] = cursor.position.x;
    positions[4] = cursor.position.y;
    positions[5] = cursor.position.z;
    aimingLine.geometry.attributes.position.needsUpdate = true;
  }

  // update counters
  document.getElementById('meteorCount').innerText = meteors.length;

  // update predicted impact (simple forward simulation)
  updatePredictedImpact();

  // update mouse-follow cursor position (slightly in front of plane)
  const mc = scene.getObjectByName('mouseCursor');
  if(mc){ mc.position.copy(cursor.position); mc.position.add(new THREE.Vector3(0,0,0)); }

  meteors.forEach(meteor=>{
    if(!meteor.active) return;
    const pos = meteor.mesh.position;
    const r = pos.length();

    if(realistic){
      // Convert scene pos to meters
      const posMeters = pos.clone().multiplyScalar(SCENE_SCALE);
      const vel = meteor.physVelocity.clone();

      // RK4 integration for position and velocity under gravity + drag
      const dt = 0.02 * simSpeed; // seconds

      const accel = (p, vlocal) => {
        const rmag = p.length();
        const g = p.clone().multiplyScalar(-G*earthMass/(rmag*rmag*rmag));
        const h = rmag - earthRadiusMeters;
        const rho0 = 1.225, H = 8000;
        const rho = Math.max(0, rho0 * Math.exp(-h/H));
        const Cd = 1.0;
        const vMag = Math.max(1e-6, vlocal.length());
        const drag = vlocal.clone().multiplyScalar(-0.5 * rho * vMag * Cd * meteor.area / meteor.mass);
        return g.add(drag);
      };

      // k1
      const k1v = accel(posMeters, vel).clone().multiplyScalar(dt);
      const k1x = vel.clone().multiplyScalar(dt);

      // k2
      const p2 = posMeters.clone().add(k1x.clone().multiplyScalar(0.5));
      const v2 = vel.clone().add(k1v.clone().multiplyScalar(0.5));
      const k2v = accel(p2, v2).clone().multiplyScalar(dt);
      const k2x = v2.clone().multiplyScalar(dt);

      // k3
      const p3 = posMeters.clone().add(k2x.clone().multiplyScalar(0.5));
      const v3 = vel.clone().add(k2v.clone().multiplyScalar(0.5));
      const k3v = accel(p3, v3).clone().multiplyScalar(dt);
      const k3x = v3.clone().multiplyScalar(dt);

      // k4
      const p4 = posMeters.clone().add(k3x);
      const v4 = vel.clone().add(k3v);
      const k4v = accel(p4, v4).clone().multiplyScalar(dt);
      const k4x = v4.clone().multiplyScalar(dt);

      const dx = k1x.clone().add(k2x.clone().multiplyScalar(2)).add(k3x.clone().multiplyScalar(2)).add(k4x).multiplyScalar(1/6);
      const dv = k1v.clone().add(k2v.clone().multiplyScalar(2)).add(k3v.clone().multiplyScalar(2)).add(k4v).multiplyScalar(1/6);

      posMeters.add(dx);
      meteor.physVelocity.add(dv);

      // convert back to scene units
      meteor.mesh.position.copy(posMeters.clone().multiplyScalar(1/SCENE_SCALE));
      if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
      // if inside atmosphere (<100km) add emissive heating by entry
      const height = posMeters.length() - earthRadiusMeters;
      if(meteor.mesh.material && height < 100000 && height > 0){
        const t = Math.max(0, Math.min(1, (100000 - height) / 100000));
        meteor.mesh.material.emissive.setHex(0xff6600);
        meteor.mesh.material.emissiveIntensity = 0.8 * t;
      } else if(meteor.mesh.material){
        meteor.mesh.material.emissiveIntensity = 0;
      }
    } else {
      // Gravity (game-like)
      const gravityAccel = pos.clone().normalize().multiplyScalar(-gravityStrength/(r*r));
      meteor.velocity.add(gravityAccel.multiplyScalar(simSpeed));
      pos.add(meteor.velocity.clone().multiplyScalar(simSpeed));
    }

    // Impact
      if(r < earthRadius+0.2){
        meteor.active=false;
        createImpact(pos.clone());
        // remove mesh from scene
        scene.remove(meteor.mesh);
        // remove label DOM element and from labels array
        if(meteor.label){
          if(meteor.label.element && meteor.label.element.parentNode){
            meteor.label.element.parentNode.removeChild(meteor.label.element);
          }
          const li = labels.indexOf(meteor.label);
          if(li!==-1) labels.splice(li,1);
        }
          impactCount++; document.getElementById('impactCount').innerText = impactCount;
          // compute impact energy (use physVelocity if available else estimate)
          try{
            let speedAtImpact = 0;
            if(meteor.physVelocity) speedAtImpact = meteor.physVelocity.length();
            else if(meteor.velocity) speedAtImpact = meteor.velocity.length() * SCENE_SCALE; // estimate m/s
            const ke = 0.5 * (meteor.mass || 1) * speedAtImpact * speedAtImpact; // Joules
            const keTons = ke / 4.184e9; // kilotons of TNT roughly
            document.getElementById('impactEnergy').innerText = `${ke.toExponential(3)} J (~${keTons.toFixed(2)} kt)`;
          }catch(e){ console.error('impact energy calc', e); document.getElementById('impactEnergy').innerText = '-'; }
      }
  });

  impactEffects.forEach(effect=>{
    effect.mesh.scale.addScalar(0.05*simSpeed);
    effect.mesh.material.opacity -= 0.02*simSpeed;
    if(effect.mesh.material.opacity<=0) scene.remove(effect.mesh);
  });
  impactEffects = impactEffects.filter(e=>e.mesh.material.opacity>0);

  // remove inactive meteors from array to avoid memory growth
  meteors = meteors.filter(m=>m.active);

  controls.update();
  renderer.render(scene, camera);
  updateLabels();
}

// Predict where a meteor fired now would hit Earth (very simple ballistic sim)
function updatePredictedImpact(){
  const speed = parseFloat(document.getElementById('speed').value);
  const origin = camera.position.clone();
  const dir = cursor.position.clone().sub(camera.position).normalize();
  const vel = dir.multiplyScalar(speed);

  let pos = origin.clone();
  let v = vel.clone();
  let hitPos = null;
  if(realistic){
    // RK4 in meters + drag
    const originM = origin.clone().multiplyScalar(SCENE_SCALE);
    const velM = v.clone().multiplyScalar(SCENE_SCALE);
    let pM = originM.clone();
    let vM = velM.clone();
    const dt = 0.02 * simSpeed;
    const steps = 2000;
    const accel = (p, vv) => {
      const rmag = p.length();
      const g = p.clone().multiplyScalar(-G*earthMass/(rmag*rmag*rmag));
      const h = rmag - earthRadiusMeters;
      const rho0 = 1.225, H=8000;
      const rho = Math.max(0, rho0 * Math.exp(-h/H));
      const Cd = 1.0;
      const vmag = Math.max(1e-6, vv.length());
      const drag = vv.clone().multiplyScalar(-0.5 * rho * vmag * Cd * 1.0 / 1.0); // area/mass omitted for prediction simplification
      return g.add(drag);
    };
    for(let i=0;i<steps;i++){
      const k1v = accel(pM, vM).clone().multiplyScalar(dt);
      const k1x = vM.clone().multiplyScalar(dt);

      const p2 = pM.clone().add(k1x.clone().multiplyScalar(0.5));
      const v2 = vM.clone().add(k1v.clone().multiplyScalar(0.5));
      const k2v = accel(p2, v2).clone().multiplyScalar(dt);
      const k2x = v2.clone().multiplyScalar(dt);

      const p3 = pM.clone().add(k2x.clone().multiplyScalar(0.5));
      const v3 = vM.clone().add(k2v.clone().multiplyScalar(0.5));
      const k3v = accel(p3, v3).clone().multiplyScalar(dt);
      const k3x = v3.clone().multiplyScalar(dt);

      const p4 = pM.clone().add(k3x);
      const v4 = vM.clone().add(k3v);
      const k4v = accel(p4, v4).clone().multiplyScalar(dt);
      const k4x = v4.clone().multiplyScalar(dt);

      const dx = k1x.clone().add(k2x.clone().multiplyScalar(2)).add(k3x.clone().multiplyScalar(2)).add(k4x).multiplyScalar(1/6);
      const dv = k1v.clone().add(k2v.clone().multiplyScalar(2)).add(k3v.clone().multiplyScalar(2)).add(k4v).multiplyScalar(1/6);

      pM.add(dx);
      vM.add(dv);

      const rScene = pM.length() / SCENE_SCALE;
      if(rScene < earthRadius+0.2){ hitPos = pM.clone().multiplyScalar(1/SCENE_SCALE); break; }
      if(rScene > 1e6) break;
    }
  } else {
    // RK4 integrator in scene units
    const dt = 0.02 * simSpeed; // small timestep
    const steps = 2000; // allow longer sim but bounded
    for(let i=0;i<steps;i++){
      const r = pos.length();
      const accel = (p=> p.clone().normalize().multiplyScalar(-gravityStrength/(p.length()*p.length())))(pos);

      // k1
      const k1v = accel.clone().multiplyScalar(dt);
      const k1x = v.clone().multiplyScalar(dt);

      // k2
      const p2 = pos.clone().add(k1x.clone().multiplyScalar(0.5));
      const v2 = v.clone().add(k1v.clone().multiplyScalar(0.5));
      const a2 = (p=> p.clone().normalize().multiplyScalar(-gravityStrength/(p.length()*p.length())))(p2);
      const k2v = a2.clone().multiplyScalar(dt);
      const k2x = v2.clone().multiplyScalar(dt);

      // k3
      const p3 = pos.clone().add(k2x.clone().multiplyScalar(0.5));
      const v3 = v.clone().add(k2v.clone().multiplyScalar(0.5));
      const a3 = (p=> p.clone().normalize().multiplyScalar(-gravityStrength/(p.length()*p.length())))(p3);
      const k3v = a3.clone().multiplyScalar(dt);
      const k3x = v3.clone().multiplyScalar(dt);

      // k4
      const p4 = pos.clone().add(k3x);
      const v4 = v.clone().add(k3v);
      const a4 = (p=> p.clone().normalize().multiplyScalar(-gravityStrength/(p.length()*p.length())))(p4);
      const k4v = a4.clone().multiplyScalar(dt);
      const k4x = v4.clone().multiplyScalar(dt);

      // combine
      const dx = k1x.clone().add(k2x.clone().multiplyScalar(2)).add(k3x.clone().multiplyScalar(2)).add(k4x).multiplyScalar(1/6);
      const dv = k1v.clone().add(k2v.clone().multiplyScalar(2)).add(k3v.clone().multiplyScalar(2)).add(k4v).multiplyScalar(1/6);

      pos.add(dx);
      v.add(dv);

      if(pos.length() < earthRadius+0.2){ hitPos = pos.clone(); break; }
      // if escaped too far, stop
      if(pos.length() > 1e4) break;
    }
  }
  if(hitPos){
    predictedImpactMarker.position.copy(hitPos);
    predictedImpactMarker.visible = true;
  } else {
    predictedImpactMarker.visible = false;
  }
}

// ---------------- IMPACT ----------------
function createImpact(position){
  const normal = position.clone().normalize();
  const geo = new THREE.RingGeometry(0.1,0.2,32);
  const mat = new THREE.MeshBasicMaterial({ color:0xff0000, side:THREE.DoubleSide, transparent:true, opacity:0.8 });
  const ring = new THREE.Mesh(geo, mat);

  const quat = new THREE.Quaternion();
  quat.setFromUnitVectors(new THREE.Vector3(0,1,0), normal);
  ring.quaternion.copy(quat);

  ring.position.copy(normal.multiplyScalar(earthRadius+0.01));
  scene.add(ring);
  impactEffects.push({ mesh:ring });
}

// ---------------- NASA FETCH ----------------
let neoPage = 0;
async function fetchAsteroidList(loadMore=false){
  const apiKey = document.getElementById('apiKey').value.trim();
  if(!apiKey) return alert("Enter NASA API key");

  if(!loadMore) { neoPage = 0; asteroidList = []; document.getElementById('asteroidSelect').innerHTML = ''; }
  try{
    const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/browse?page=${neoPage}&size=20&api_key=${apiKey}`);
    const data = await res.json();
    const select=document.getElementById('asteroidSelect');
    data.near_earth_objects.forEach(a=>{
      asteroidList.push(a);
      const option = document.createElement('option');
      option.value=a.id;
      option.textContent=`${a.name} (${a.estimated_diameter.meters.estimated_diameter_max.toFixed(0)} m)`;
      select.appendChild(option);
    });
    neoPage++;
    document.getElementById('asteroidData').innerHTML=`Fetched ${asteroidList.length} asteroids (page ${neoPage})`;
  } catch(err){
    console.error(err);
    alert("Error fetching asteroids");
  }
}

async function fetchAsteroidDetails(id){
  const apiKey = document.getElementById('apiKey').value.trim();
  if(!apiKey) return null;
  try{
    const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${id}?api_key=${apiKey}`);
    return await res.json();
  }catch(err){ console.error(err); return null; }
}

// ---------------- SPAWN REAL ASTEROID ----------------
async function spawnSelectedAsteroid(){
  const select=document.getElementById('asteroidSelect');
  if(!select.value) return alert("Select an asteroid");
  // fetch rich details for selected asteroid
  const details = await fetchAsteroidDetails(select.value) || asteroidList.find(a=>a.id===select.value);
  if(!details) return alert('Could not fetch asteroid details');

  const size = details.estimated_diameter.meters.estimated_diameter_max;
  const approach = parseFloat(details.close_approach_data[0].miss_distance.kilometers);
  const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second);

  document.getElementById('asteroidData').innerHTML=`
    <b>${details.name}</b><br>
    Diameter: ${size.toFixed(1)} m<br>
    Miss distance: ${approach.toFixed(0)} km<br>
    Velocity: ${velocity.toFixed(1)} km/s
  `;

  // Spawn at actual approach distance scaled to scene (convert km to scene units)
  // create meter-based geometry (1 meter unit) and scale to asteroid size in scene units
  const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
  const meteorMat = new THREE.MeshStandardMaterial({ color:0xaaaaaa, metalness:0.1, roughness:0.6, emissive:0x000000 });
  const meteor = new THREE.Mesh(meteorGeo, meteorMat);

  // approach is in kilometers; convert to meters then to scene units
  const approachMeters = approach * 1000;
  meteor.position.set(0,0, approachMeters / SCENE_SCALE);
  // direction toward Earth's center
  const dir = new THREE.Vector3(0,0,-1).normalize();

  // physical props
  const density = 3000;
  const volume = (4/3)*Math.PI*Math.pow(size/2,3);
  const mass = density * volume;
  const area = Math.PI * Math.pow(size/2,2);

  scene.add(meteor);
  // visual scaling so it's visible
  const meterToScene = 1/SCENE_SCALE;
  const visualMin = 0.02;
  meteor.scale.setScalar(Math.max(size * meterToScene, visualMin));
  // physVelocity: velocity is in km/s from API -> convert to m/s
  const physVel = dir.clone().multiplyScalar(velocity * 1000);
  meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(velocity/50), physVelocity:physVel, active:true, mass, area, size });
}

// Load a high-res Earth texture (example uses NASA Blue Marble - replaceable with USGS URL)
function loadHighResEarthTexture(){
  const urls = [
    'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2012044_lrg.jpg',
    // fallback USGS-style sample (CORS may block some hosts)
    'https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg'
  ];
  const loader = new THREE.TextureLoader();
  let tried = 0;
  const tryLoad = ()=>{
    if(tried>=urls.length) return alert('All texture loads failed (CORS or network)');
    const url = urls[tried++];
    loader.load(url, tex=>{
      if(!earth) return;
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      earth.material.map = tex;
      earth.material.needsUpdate = true;
    }, undefined, err=>{
      console.warn('Texture load failed (CORS/network), trying fallback', url, err);
      tryLoad();
    });
  };
  tryLoad();
}

// ---------------- UTILS ----------------
function onWindowResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
