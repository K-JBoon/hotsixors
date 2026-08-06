import * as THREE from 'three';
import { GLTFLoader } from '/lost-in-the-nexus/vendor/GLTFLoader.js';
import { OrbitControls } from '/lost-in-the-nexus/vendor/OrbitControls.js';
import { clone as cloneSkinned } from '/lost-in-the-nexus/vendor/SkeletonUtils.js';
import { MeshoptDecoder } from '/lost-in-the-nexus/vendor/meshopt_decoder.module.js';
import { EffectComposer } from '/lost-in-the-nexus/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '/lost-in-the-nexus/vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/lost-in-the-nexus/vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/lost-in-the-nexus/vendor/postprocessing/OutputPass.js';

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

  // Glow art is flat cards of bright texture: what makes the game's read as
  // light is the bloom over it, so the scene renders through one. The threshold
  // is what keeps it off the lit ground, which is nearly as bright.
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.5);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // no going under the ground

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const mixers = [];
  const scrollers = [];
  let span = 100;
  let centre = new THREE.Vector3();
  let loadToken = 0;
  // The backdrop is far wider than the map, so framing measures the ground.
  let groundBox = null;

  function loadGltf(url) {
    return new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));
  }

  // The game's glow art — the Hall of Storms vortex, energy rings, lit windows,
  // the gate's ward — is emissive and mostly drawn additively, which glTF has no
  // mode for, so the converter tags the material and the blend is set here. A
  // few of those layers scroll, which is the only motion their geometry has.
  function applyGlow(source) {
    source.traverse((node) => {
      for (const material of [node.material].flat()) {
        const glow = material?.userData?.glow;
        if (!glow) continue;
        material.toneMapped = false;
        // The flat kind is unlit but still a surface: it occludes, so it keeps
        // its depth write. The vortex's star sphere is one, and drawn additively
        // its whole centre reads as a hole.
        if (glow === 'add') {
          material.blending = THREE.AdditiveBlending;
          material.depthWrite = false;
        }
        const scroll = material.userData.scroll;
        if (scroll && material.map) scrollers.push({ map: material.map, scroll });
        if (material.userData.mask) applyMask(material, material.userData.mask);
        if (material.userData.fresnel) applyFresnel(material, material.userData.fresnel);
      }
    });
  }

  // Half the game's moving glow is a still picture under a mask that slides
  // over it: the mana well's lightning, the watchtower's beam, the gate's ward.
  // A scrolling mask is the animation, so it stays its own texture with its own
  // UVs rather than being baked into the art's alpha.
  const textures = new THREE.TextureLoader();

  function applyMask(material, { uri, tiling, scroll }) {
    const map = textures.load(asset('/lost-in-the-nexus/models/' + uri));
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.flipY = false; // glTF UVs, and the art it masks comes in that way
    map.repeat.set(tiling[0], tiling[1]);
    material.alphaMap = map;
    material.transparent = true;
    material.needsUpdate = true;
    if (scroll[0] || scroll[1]) scrollers.push({ map, scroll });
  }

  // A layer can fade by view angle, and on the game's energy that is the whole
  // effect: the Hall of Storms wall is a full cylinder of bright cyan faded out
  // wherever it faces the camera, leaving the rim of the portal. Without it the
  // hall wears a lit drum.
  function applyFresnel(material, [inverted, exponent, low, span]) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vGlowNormal;
        varying vec3 vGlowEye;
        ${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        // An unlit material only defines `objectNormal` when something else
        // wants normals, so this reads the attribute itself.
        `#include <project_vertex>
         vGlowNormal = normalize( normalMatrix * normal );
         vGlowEye = normalize( -mvPosition.xyz );`
      );
      shader.fragmentShader = `varying vec3 vGlowNormal;
        varying vec3 vGlowEye;
        ${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float facing = abs( dot( normalize( vGlowNormal ), normalize( vGlowEye ) ) );
         float rim = pow( ${inverted ? '1.0 - facing' : 'facing'}, ${exponent.toFixed(2)} );
         diffuseColor.a *= clamp( ${low.toFixed(3)} + ${span.toFixed(3)} * rim, 0.0, 1.0 );`
      );
    };
    material.needsUpdate = true;
  }

  // Team colour is a mask in the diffuse alpha; alpha is not used for transparency
  // on these materials.
  const TEAM_COLOURS = [new THREE.Color(0x3f7fd8), new THREE.Color(0xd8452f)];
  const teamMaterials = new Map();

  function teamMaterial(source, team) {
    // Glow art has no team mask, and forcing its alpha opaque would blow it out.
    if (source.userData?.glow) return source;
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
    scrollers.length = 0;
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
        applyGlow(gltf.scene);
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

  function setBloom(on) {
    bloom.enabled = on;
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
    composer.setSize(width, height);
  }
  new ResizeObserver(resize).observe(view);

  function swapCamera() {
    const other = camera === ortho ? persp : ortho;
    const offset = camera.position.clone().sub(controls.target);
    other.position.copy(controls.target).add(offset);
    camera = other;
    renderPass.camera = camera;
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

  // Wisps mark where guessers are standing while they search; the host clicks
  // one to jump their own camera there. Kept off `world` so a map reload
  // doesn't sweep them up with clearWorld().
  const wispGroup = new THREE.Group();
  scene.add(wispGroup);
  const wispGeometry = new THREE.SphereGeometry(1.2, 12, 12);
  const wispMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.85, toneMapped: false });
  const wispMaterials = new Map(); // colour -> material, one per player colour
  function wispMaterialFor(color) {
    if (!color) return wispMaterial;
    let material = wispMaterials.get(color);
    if (!material) {
      material = wispMaterial.clone();
      material.color.set(color);
      wispMaterials.set(color, material);
    }
    return material;
  }
  const wisps = new Map(); // id -> mesh

  // The name floats above the dot as a billboarded sprite. Text is baked to a
  // canvas rather than pulled from geometry, so it stays sharp at any zoom.
  function labelSprite(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '600 40px system-ui, sans-serif';
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.width = width;
    canvas.height = 56;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillStyle = '#eaf6ff';
    ctx.strokeText(text, 12, 28);
    ctx.fillText(text, 12, 28);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, toneMapped: false }));
    sprite.scale.set((width / 56) * 1.6, 1.6, 1);
    sprite.position.y = 2.4;
    return sprite;
  }

  let onWispPick = null;

  function setWisps(entries, onPick) {
    onWispPick = onPick;
    const seen = new Set();
    for (const entry of entries) {
      seen.add(entry.id);
      let mesh = wisps.get(entry.id);
      if (!mesh) {
        mesh = new THREE.Mesh(wispGeometry, wispMaterialFor(entry.color));
        mesh.userData.wispId = entry.id;
        wispGroup.add(mesh);
        wisps.set(entry.id, mesh);
      }
      mesh.position.fromArray(entry.p);
      if (entry.name && mesh.userData.name !== entry.name) {
        if (mesh.userData.label) mesh.remove(mesh.userData.label);
        const label = labelSprite(entry.name);
        mesh.add(label);
        mesh.userData.label = label;
        mesh.userData.name = entry.name;
      }
    }
    for (const [id, mesh] of wisps) {
      if (seen.has(id)) continue;
      wispGroup.remove(mesh);
      wisps.delete(id);
    }
  }

  // A click, not a drag: OrbitControls already owns pointerdown for orbiting,
  // so this only fires the pick on a short, near-stationary press.
  const pickRay = new THREE.Raycaster();
  let pressAt = null;
  let pressTime = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pressAt = [e.clientX, e.clientY];
    pressTime = performance.now();
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pressAt) return;
    const [x, y] = pressAt;
    pressAt = null;
    if (!onWispPick || !wisps.size) return;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 4 || performance.now() - pressTime > 350) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pickRay.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      camera
    );
    const hit = pickRay.intersectObjects([...wisps.values()], false)[0];
    if (hit) onWispPick(hit.object.userData.wispId);
  });

  // Keeps the camera a little clear of whatever it is looking straight at, so
  // dollying or flying in can't push the lens through a wall or a doodad.
  // Water and glow layers draw with depthWrite off, which doubles as the
  // "not a real surface" marker here. Free flying is left alone (walls and
  // terrain are noclip while searching for a spot); this only nudges the
  // camera out when a shot is actually taken, and only far enough to clear
  // whatever it is embedded in — a narrow corridor still frames tight.
  const MIN_SHOT_DIST = 1.2;
  const surfaceRay = new THREE.Raycaster();
  const viewDir = new THREE.Vector3();
  function clampToSurfaces() {
    camera.getWorldDirection(viewDir);
    surfaceRay.set(camera.position, viewDir);
    surfaceRay.far = MIN_SHOT_DIST;
    const hit = surfaceRay.intersectObject(world, true).find((h) => h.object.material?.depthWrite !== false);
    if (!hit || hit.distance >= MIN_SHOT_DIST) return;
    const push = MIN_SHOT_DIST - hit.distance;
    camera.position.addScaledVector(viewDir, -push);
    controls.target.addScaledVector(viewDir, -push);
  }

  const clock = new THREE.Clock();
  function render() {
    const dt = Math.min(clock.getDelta(), 0.1);
    fly(dt);
    for (const mixer of mixers) mixer.update(dt);
    for (const { map, scroll } of scrollers) {
      map.offset.set((map.offset.x + scroll[0] * dt) % 1, (map.offset.y + scroll[1] * dt) % 1);
    }
    controls.update();
    composer.render();
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
    setBloom,
    setFlyEnabled,
    getShot,
    applyShot,
    renderShot,
    clampToSurfaces,
    setWisps,
    getSpan: () => span,
    getCentre: () => centre.clone(),
    shadowsEnabled: () => renderer.shadowMap.enabled,
    bloomEnabled: () => bloom.enabled,
    // Lets a headless check confirm the keys move the camera.
    probe: () => controls.target.toArray().map((v) => Math.round(v)),
  };
}
