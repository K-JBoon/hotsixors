import * as THREE from 'three';
import { GLTFLoader } from '/lost-in-the-nexus/vendor/GLTFLoader.js';
import { OrbitControls } from '/lost-in-the-nexus/vendor/OrbitControls.js';
import { clone as cloneSkinned } from '/lost-in-the-nexus/vendor/SkeletonUtils.js';
import { MeshoptDecoder } from '/lost-in-the-nexus/vendor/meshopt_decoder.module.js';

function fetchJson(url) {
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

// The scene, its loader and the fly camera. Both the viewer page and the guessing
// game drive this; anything page-specific (pickers, gates, storage) stays out.
export async function createNexusScene({ view, assets = '', pitch = 55, hotkeys = {} }) {
  const asset = (path) => assets + path;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1018);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x36302a, 2.2));
  const SUN_DIR = new THREE.Vector3(-60, 90, 60).normalize();
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
  // The backdrop is far wider than the map, so framing measures the ground.
  let groundBox = null;

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

  // The ground is cut away where the map declares no terrain, so the holes in a
  // map like Sky Temple look straight through to whatever is behind the scene.
  // This is what the game shows under them: sky, fading out to the void before
  // the plane's own edge can read as an edge.
  const BACKDROP_DROP = 30; // below the ground's surface, just under its skirt

  function backdropTexture(colour) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(
      size / 2, size / 2, 0, size / 2, size / 2, size / 2
    );
    const rgb = colour.join(',');
    gradient.addColorStop(0, `rgba(${rgb},1)`);
    gradient.addColorStop(0.55, `rgba(${rgb},0.85)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function backdropMesh(box, colour) {
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 2.2;
    const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: backdropTexture(colour),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const centre = box.getCenter(new THREE.Vector3());
    mesh.position.set(centre.x, box.max.y - BACKDROP_DROP, centre.z);
    return mesh;
  }

  // Instances share their source's buffers, so each is freed once.
  function clearWorld() {
    mixers.length = 0;
    groundBox = null;
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

  async function loadMap(slug, onStatus = () => {}) {
    const token = ++loadToken;
    clearWorld();
    onStatus('Loading terrain…');

    const [placed, models] = await Promise.all([
      fetchJson(asset(`/lost-in-the-nexus/maps3d/${slug}.json`)),
      fetchJson(asset('/lost-in-the-nexus/models/index.json')),
    ]);
    if (token !== loadToken) return false;
    if (!placed || !models) {
      onStatus('That battleground has not been converted yet.');
      return false;
    }

    const terrain = terrainIndex[slug];
    if (terrain) {
      const ground = await loadGltf(asset(terrain.gltf));
      if (token !== loadToken) return false;
      if (ground) {
        world.add(ground.scene);
        groundBox = new THREE.Box3().setFromObject(ground.scene);
        // Only the maps that hang in daylight name one; elsewhere the scene's
        // own background is what belongs under the cut.
        if (terrain.backdrop) world.add(backdropMesh(groundBox, terrain.backdrop));
      }
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
        onStatus(`Loading models ${done}/${placed.models.length}…`);
      }
    }));
    if (token !== loadToken) return false;

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

    markShadows();
    return true;
  }

  // Translucent surfaces (water, glow planes) would cast an opaque blob.
  function markShadows() {
    world.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = ![node.material].flat().some((m) => m?.transparent);
      node.receiveShadow = true;
    });
  }

  // Toggling the shadow map changes every program, so the materials recompile.
  function setShadows(on) {
    renderer.shadowMap.enabled = on;
    world.traverse((node) => {
      for (const m of [node.material].flat()) if (m) m.needsUpdate = true;
    });
  }

  // One ortho shadow camera over the framed area; a tighter fit buys resolution.
  function fitShadow() {
    const radius = span * 1.6;
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(SUN_DIR, radius * 2.5);
    const cam = sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = radius * 5;
    cam.updateProjectionMatrix();
    sun.shadow.normalBias = (2 * radius) / sun.shadow.mapSize.x * 1.5;
  }

  function frame({ span: wantSpan, cx, cy, flat } = {}) {
    const box = groundBox || new THREE.Box3().setFromObject(world);
    const size = box.getSize(new THREE.Vector3());
    centre = box.getCenter(new THREE.Vector3());
    // The ground hangs a skirt well below its surface; aim at the surface.
    if (groundBox) centre.y = box.max.y;
    span = Math.max(size.x, size.z) * 0.55 || 100;
    if (wantSpan) span = wantSpan;
    if (cx !== undefined) centre.x = cx;
    if (cy !== undefined) centre.z = -cy;
    if (flat && camera !== ortho) swapCamera();
    fitShadow();
    resetCamera();
  }

  const eye = new THREE.Vector3();
  {
    const rad = THREE.MathUtils.degToRad(pitch);
    eye.set(0, Math.sin(rad), Math.cos(rad));
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

  let flying = true;
  const held = new Set();
  addEventListener('keydown', (e) => {
    if (!flying || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    hotkeys[key]?.();
    held.add(key);
  });
  addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

  function setFlyEnabled(on) {
    flying = on;
    controls.enabled = on;
    if (!on) held.clear();
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const step = new THREE.Vector3();
  const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e'];
  const RAMP_SECONDS = 1.1;
  const CREEP = 0.2;
  let throttle = 0;

  function fly(dt) {
    if (!MOVE_KEYS.some((key) => held.has(key))) {
      throttle = 0;
      return;
    }
    throttle = Math.min(1, throttle + dt / RAMP_SECONDS);
    const ramp = CREEP + (1 - CREEP) * throttle * throttle;
    const speed = (held.has('shift') ? 3 : 1) * span * 0.5 * dt * ramp;
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

  // A shot is a camera pose, not an image: peers rebuild the picture locally.
  function getShot() {
    return {
      p: camera.position.toArray(),
      t: controls.target.toArray(),
      fov: persp.fov,
    };
  }

  function poseCamera(cam, shot, camAspect) {
    cam.position.fromArray(shot.p);
    cam.up.set(0, 1, 0);
    cam.lookAt(new THREE.Vector3().fromArray(shot.t));
    cam.fov = shot.fov || 50;
    cam.aspect = camAspect;
    cam.updateProjectionMatrix();
    return cam;
  }

  function applyShot(shot) {
    if (camera === ortho) swapCamera();
    camera.position.fromArray(shot.p);
    controls.target.fromArray(shot.t);
    persp.fov = shot.fov || 50;
    resize();
    controls.update();
  }

  const shotCamera = new THREE.PerspectiveCamera(50, 1, 0.2, 6000);
  // Readback of an offscreen render: the live canvas keeps showing the player's
  // own view while a shot is developed.
  function renderShot(shot, width, height) {
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    poseCamera(shotCamera, shot, width / height);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, shotCamera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous);
    target.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    const stride = width * 4;
    // GL reads bottom-up.
    for (let y = 0; y < height; y++) {
      image.data.set(pixels.subarray(y * stride, y * stride + stride), (height - 1 - y) * stride);
    }
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/webp', 0.85);
    return url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/jpeg', 0.85);
  }

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

  return {
    maps,
    terrainIndex,
    loadMap,
    frame,
    resetCamera,
    swapCamera,
    setShadows,
    setFlyEnabled,
    getShot,
    applyShot,
    renderShot,
    getSpan: () => span,
    getCentre: () => centre.clone(),
    shadowsEnabled: () => renderer.shadowMap.enabled,
    // Lets a headless check confirm the keys move the camera.
    probe: () => controls.target.toArray().map((v) => Math.round(v)),
  };
}
