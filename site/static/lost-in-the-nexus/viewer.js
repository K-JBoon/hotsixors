import * as THREE from 'three';
import { GLTFLoader } from '/lost-in-the-nexus/vendor/GLTFLoader.js';
import { OrbitControls } from '/lost-in-the-nexus/vendor/OrbitControls.js';
import { clone as cloneSkinned } from '/lost-in-the-nexus/vendor/SkeletonUtils.js';
import { MeshoptDecoder } from '/lost-in-the-nexus/vendor/meshopt_decoder.module.js';

const view = document.getElementById('nexus-view');
const status = document.getElementById('nexus-status');
const picker = document.getElementById('nexus-map');

// Geometry lives in an R2 bucket rather than alongside the page: it is hundreds
// of megabytes over tens of thousands of files. The indexes store site-absolute
// paths, so everything is resolved through here; an empty base is same-origin,
// which is what a local build serves.
const ASSETS = document.querySelector('.nexus-page')?.dataset.nexusAssets || '';
const asset = (path) => ASSETS + path;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1018);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x36302a, 2.2));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
sun.position.set(-60, 90, 60);
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const aspect = () => view.clientWidth / Math.max(view.clientHeight, 1);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
const persp = new THREE.PerspectiveCamera(50, aspect(), 0.2, 6000);
let camera = persp;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // no going under the ground

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const mixers = [];
let span = 100;
let centre = new THREE.Vector3();
let loadToken = 0;

function fetchJson(url) {
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

function loadGltf(url) {
  return new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));
}

// Team colour is a mask in the diffuse alpha; alpha is not used for transparency
// on these materials.
const TEAM_COLOURS = [new THREE.Color(0x3f7fd8), new THREE.Color(0xd8452f)];
const teamMaterials = new Map();

function teamMaterial(source, team) {
  const key = `${source.uuid}|${team}`;
  const cached = teamMaterials.get(key);
  if (cached) return cached;
  const material = source.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.teamColour = { value: TEAM_COLOURS[team] };
    shader.fragmentShader = 'uniform vec3 teamColour;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       #ifdef USE_MAP
         float teamMask = 1.0 - texture2D( map, vMapUv ).a;
         float shade = dot( diffuseColor.rgb, vec3( 0.3333 ) );
         diffuseColor.rgb = mix( diffuseColor.rgb, teamColour * ( 0.35 + 1.3 * shade ), teamMask );
       #endif
       diffuseColor.a = 1.0;`
    );
  };
  material.needsUpdate = true;
  teamMaterials.set(key, material);
  return material;
}

function applyTeam(node, team) {
  node.traverse((child) => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((m) => teamMaterial(m, team))
      : teamMaterial(child.material, team);
  });
}

// A flat plane at the type's height, clipped to the map's water regions; the
// terrain occludes it elsewhere. Regions overlap and a translucent quad drawn
// twice goes muddy, so the union is rasterised and each row's runs become a quad.
function waterMesh({ height, regions, colour }) {
  let maxX = 0;
  let maxY = 0;
  for (const [, , x2, y2] of regions) {
    maxX = Math.max(maxX, Math.ceil(x2));
    maxY = Math.max(maxY, Math.ceil(y2));
  }
  const covered = new Uint8Array(maxX * maxY);
  for (const [x1, y1, x2, y2] of regions) {
    for (let y = Math.floor(y1); y < Math.ceil(y2); y++) {
      for (let x = Math.floor(x1); x < Math.ceil(x2); x++) covered[y * maxX + x] = 1;
    }
  }

  const verts = [];
  const faces = [];
  for (let y = 0; y < maxY; y++) {
    let run = -1;
    for (let x = 0; x <= maxX; x++) {
      const on = x < maxX && covered[y * maxX + x];
      if (on && run < 0) run = x;
      if (on || run < 0) continue;
      const base = verts.length / 3;
      verts.push(run, height, -y, x, height, -y, x, height, -y - 1, run, height, -y - 1);
      faces.push(base, base + 1, base + 2, base, base + 2, base + 3);
      run = -1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  // The catalog colour tints refracted ground rather than a lit surface, so it
  // needs damping before a lit material uses it.
  const tint = (colour || [0.05, 0.2, 0.3]).slice(0, 3).map((c) => c * 0.5);
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: new THREE.Color(...tint),
    transparent: true,
    opacity: 0.8,
    roughness: 0.3,
    metalness: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
}

// Instances share their source's buffers, so each is freed once.
function clearWorld() {
  mixers.length = 0;
  const geometries = new Set();
  const materials = new Set();
  world.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const m of [node.material].flat()) if (m) materials.add(m);
  });
  for (const child of [...world.children]) world.remove(child);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    material.dispose();
  }
  teamMaterials.clear();
}

async function loadMap(slug) {
  const token = ++loadToken;
  clearWorld();
  status.hidden = false;
  status.textContent = 'Loading terrain…';

  const [placed, models] = await Promise.all([
    fetchJson(asset(`/lost-in-the-nexus/maps3d/${slug}.json`)),
    fetchJson(asset('/lost-in-the-nexus/models/index.json')),
  ]);
  if (token !== loadToken) return;
  if (!placed || !models) {
    status.textContent = 'That battleground has not been converted yet.';
    return;
  }

  const terrain = terrainIndex[slug];
  if (terrain) {
    const ground = await loadGltf(asset(terrain.gltf));
    if (token !== loadToken) return;
    if (ground) world.add(ground.scene);
    for (const body of terrain.water || []) world.add(waterMesh(body));
  }

  const sources = {};
  const clips = {};
  let done = 0;
  await Promise.all(placed.models.map(async (name) => {
    const entry = models.models[name];
    const gltf = entry && (await loadGltf(asset(entry.gltf)));
    if (gltf) {
      sources[name] = gltf.scene;
      if (gltf.animations.length) clips[name] = gltf.animations[0];
    }
    if (token === loadToken && ++done % 8 === 0) {
      status.textContent = `Loading models ${done}/${placed.models.length}…`;
    }
  }));
  if (token !== loadToken) return;

  // Game x east, y north, z up -> glTF x east, y up, z south.
  for (const item of placed.instances) {
    const source = sources[item.m];
    if (!source) continue;
    const clip = clips[item.m];
    // A skinned model needs its own skeleton, which a plain clone shares.
    const node = clip ? cloneSkinned(source) : source.clone(true);
    node.position.set(item.x, item.z, -item.y);
    node.rotation.y = item.r || 0;
    if (item.s) node.scale.multiplyScalar(item.s);
    if (item.t !== undefined && models.models[item.m]?.team) applyTeam(node, item.t);
    world.add(node);
    if (clip) {
      const mixer = new THREE.AnimationMixer(node);
      const action = mixer.clipAction(clip);
      action.play();
      // Or every tree sways in lockstep.
      action.time = Math.random() * clip.duration;
      mixers.push(mixer);
    }
  }

  frame();
  status.hidden = true;
}

// Query params can frame a spot instead of the whole map.
function frame() {
  const box = new THREE.Box3().setFromObject(world);
  const size = box.getSize(new THREE.Vector3());
  centre = box.getCenter(new THREE.Vector3());
  span = Math.max(size.x, size.z) * 0.55 || 100;
  const params = new URLSearchParams(location.search);
  if (params.has('span')) span = Number(params.get('span')) || span;
  if (params.has('cx')) centre.x = Number(params.get('cx'));
  if (params.has('cy')) centre.z = -Number(params.get('cy'));
  if (params.get('cam') === 'flat' && camera !== ortho) swapCamera();
  resetCamera();
}

const eye = new THREE.Vector3();
{
  const params = new URLSearchParams(location.search);
  const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch')) || 55);
  eye.set(0, Math.sin(pitch), Math.cos(pitch));
}

function resetCamera() {
  ortho.position.copy(centre).addScaledVector(eye, 2000);
  persp.position.copy(centre).addScaledVector(eye, span * 1.6);
  ortho.top = span;
  ortho.bottom = -span;
  controls.target.copy(centre);
  resize();
  controls.update();
}

function resize() {
  const width = view.clientWidth;
  const height = Math.max(view.clientHeight, 1);
  if (camera.isOrthographicCamera) {
    const half = (ortho.top - ortho.bottom) / 2;
    camera.left = -half * aspect();
    camera.right = half * aspect();
  } else {
    camera.aspect = aspect();
  }
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(view);

function swapCamera() {
  const other = camera === ortho ? persp : ortho;
  const offset = camera.position.clone().sub(controls.target);
  other.position.copy(controls.target).add(offset);
  camera = other;
  controls.object = camera;
  resize();
  controls.update();
}

// The canvas is not focusable, so the key target is whatever was clicked last:
// only a form control may swallow these.
const typing = (node) => node?.isContentEditable || node?.matches?.('input, textarea, select');

const held = new Set();
addEventListener('keydown', (e) => {
  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'c') swapCamera();
  if (key === 'r') resetCamera();
  held.add(key);
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const step = new THREE.Vector3();
function fly(dt) {
  if (!held.size) return;
  const speed = (held.has('shift') ? 3 : 1) * span * 0.5 * dt;
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  right.crossVectors(forward, camera.up).normalize();
  step.set(0, 0, 0);
  if (held.has('w')) step.addScaledVector(forward, speed);
  if (held.has('s')) step.addScaledVector(forward, -speed);
  if (held.has('d')) step.addScaledVector(right, speed);
  if (held.has('a')) step.addScaledVector(right, -speed);
  if (held.has('e')) step.y += speed;
  if (held.has('q')) step.y -= speed;
  camera.position.add(step);
  controls.target.add(step);
}

// Lets a headless check confirm the keys move the camera.
window.__nexusProbe = () => controls.target.toArray().map((v) => Math.round(v));

const clock = new THREE.Clock();
function render() {
  const dt = Math.min(clock.getDelta(), 0.1);
  fly(dt);
  for (const mixer of mixers) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();

// Both indexes are a few kilobytes; nothing heavy loads until the reader asks.
const [maps, terrainIndex] = await Promise.all([
  fetchJson(asset('/lost-in-the-nexus/maps3d/index.json')).then((v) => v || {}),
  fetchJson(asset('/lost-in-the-nexus/terrain/index.json')).then((v) => v || {}),
]);

function megabytes(slug) {
  const bytes = (maps[slug]?.bytes || 0) + (terrainIndex[slug]?.bytes || 0);
  return bytes ? `${Math.round(bytes / 1e6)} MB` : 'tens of megabytes';
}

const DEFAULT_MAP = 'cursed-hollow';
const wanted = new URLSearchParams(location.search).get('map');
const slugs = Object.keys(maps).sort((a, b) => (maps[a].name || a).localeCompare(maps[b].name || b));
for (const slug of slugs) {
  picker.add(new Option(`${maps[slug].name || slug} (${megabytes(slug)})`, slug));
}
picker.value = maps[wanted] ? wanted : (maps[DEFAULT_MAP] ? DEFAULT_MAP : slugs[0]);

const AUTOLOAD = 'hotsixors.nexus.autoload';
const gate = document.getElementById('nexus-gate');
const gateButton = document.getElementById('nexus-gate-load');
const gateSize = document.getElementById('nexus-gate-size');
const gateRemember = document.getElementById('nexus-gate-remember');

function describeGate() {
  gateSize.textContent = megabytes(picker.value);
  gateButton.textContent = `Load ${maps[picker.value]?.name || picker.value}`;
}

function start(slug) {
  const next = new URLSearchParams(location.search);
  next.set('map', slug);
  history.replaceState(null, '', `?${next}`);
  loadMap(slug);
}

picker.onchange = () => {
  // Keeping focus would send WASD into the dropdown.
  picker.blur();
  if (gate.hidden) start(picker.value);
  else describeGate();
};

let remembered = false;
try {
  remembered = localStorage.getItem(AUTOLOAD) === 'true';
} catch {
  // Private mode: ask every time.
}

if (!picker.value) {
  status.textContent = 'No battlegrounds available.';
} else if (remembered) {
  await loadMap(picker.value);
} else {
  status.hidden = true;
  describeGate();
  gate.hidden = false;
  gateButton.onclick = () => {
    if (gateRemember.checked) {
      try {
        localStorage.setItem(AUTOLOAD, 'true');
      } catch {
        // Nothing to persist to; the choice lasts this visit.
      }
    }
    gate.hidden = true;
    start(picker.value);
  };
}
