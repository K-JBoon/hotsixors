import * as THREE from 'three';
import { GLTFLoader } from '/nexus-vendor/GLTFLoader.js';
import { OrbitControls } from '/nexus-vendor/OrbitControls.js';
import { clone as cloneSkinned } from '/nexus-vendor/utils/SkeletonUtils.js';
import { MeshoptDecoder } from '/nexus-vendor/meshopt_decoder.module.js';
import { EffectComposer } from '/nexus-vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '/nexus-vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/nexus-vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/nexus-vendor/postprocessing/OutputPass.js';
import { emitterMesh } from '/lost-in-the-nexus/nexus-particles.js';

function fetchJson(url) {
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

// The scene, its loader and the fly camera. Both the viewer page and the guessing
// game drive this; anything page-specific (pickers, gates, storage) stays out.
export async function createNexusScene({ view, assets = '', pitch = 55, hotkeys = {} }) {
  const asset = (path) => assets + path;

  // Ask for the discrete GPU, and refuse a context that would fall back to a
  // software rasteriser; only if the browser has nothing else do we take it.
  function makeRenderer() {
    const options = { antialias: true, alpha: true, powerPreference: 'high-performance' };
    try {
      return new THREE.WebGLRenderer({ ...options, failIfMajorPerformanceCaveat: true });
    } catch {
      return new THREE.WebGLRenderer(options);
    }
  }

  const renderer = makeRenderer();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1018);
  // Most of the light is the sun. A strong ambient fills every shadow and the
  // map reads as one flat grey sheet: against the game's own frame the contrast
  // was half and the ground lost its warmth.
  scene.add(new THREE.HemisphereLight(0xa8c4f0, 0x6b5a42, 0.6));
  const SUN_DIR = new THREE.Vector3(-60, 90, 60).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d8, 4.0);
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
  const FREE_FOV = 50;
  const persp = new THREE.PerspectiveCamera(FREE_FOV, aspect(), 0.2, 6000);
  let camera = persp;

  // Glow art is flat cards of bright texture: what makes the game's read as
  // light is the bloom over it, so the scene renders through one. The threshold
  // is what keeps it off the lit ground, which is nearly as bright.
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 0.85);
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
  const emitters = [];  // the particle systems of the loaded map
  let particlesWanted = false;
  let emitterSource = null;  // what addEmitters needs to build them on demand
  let span = 100;
  let centre = new THREE.Vector3();
  let loadToken = 0;
  // The backdrop is far wider than the map, so framing measures the ground.
  let groundBox = null;

  function loadGltf(url) {
    return new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));
  }

  let modelsPromise = null;
  function modelsIndex() {
    modelsPromise ||= fetchJson(asset('/lost-in-the-nexus/models/index.json'));
    return modelsPromise;
  }

  // The game's glow art — the Hall of Storms vortex, energy rings, lit windows,
  // the gate's ward — is emissive and mostly drawn additively, which glTF has no
  // mode for, so the converter tags the material and the blend is set here. A
  // few of those layers scroll, which is the only motion their geometry has.
  function applyGlow(source) {
    source.traverse((node) => {
      for (const material of [node.material].flat()) {
        // A lit material can fade its light by view angle too: the raven over
        // the objective castle is a white card without it.
        if (material?.userData?.emissiveFresnel) {
          applyEmissiveFresnel(material, material.userData.emissiveFresnel);
        }
        // A mask that could not be baked — it scrolls, or it reads the other
        // unwrap — is the material's transparency, glow art or not.
        if (material?.userData?.mask) applyMask(material, material.userData.mask);
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
        if (material.userData.fresnel) applyFresnel(material, material.userData.fresnel);
      }
    });
  }

  // Half the game's moving glow is a still picture under a mask that slides
  // over it: the mana well's lightning, the watchtower's beam, the gate's ward.
  // A scrolling mask is the animation, so it stays its own texture with its own
  // UVs rather than being baked into the art's alpha.
  const textures = new THREE.TextureLoader();

  function applyMask(material, { uri, tiling, scroll, offset = [0, 0], uv = 0 }) {
    const map = textures.load(asset('/lost-in-the-nexus/models/' + uri));
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.flipY = false; // glTF UVs, and the art it masks comes in that way
    map.repeat.set(tiling[0], tiling[1]);
    map.offset.set(offset[0], offset[1]);
    // A mask can read the model's second unwrap while the art reads the first.
    map.channel = uv;
    material.alphaMap = map;
    material.transparent = true;
    material.needsUpdate = true;
    if (scroll[0] || scroll[1]) scrollers.push({ map, scroll });
  }

  // three keys its program cache on `onBeforeCompile.toString()`, which is the
  // same text for every material these injections touch: the first one to
  // compile then serves the rest, whatever constants it baked in. Each
  // injection names itself and its numbers instead.
  function keyProgram(material, tag) {
    material.programKey = (material.programKey || '') + '|' + tag;
    material.customProgramCacheKey = () => material.programKey;
  }

  // A layer can fade by view angle, and on the game's energy that is the whole
  // effect: the Hall of Storms wall is a full cylinder of bright cyan faded out
  // wherever it faces the camera, leaving the rim of the portal. Without it the
  // hall wears a lit drum.
  function applyFresnel(material, [inverted, exponent, low, span]) {
    keyProgram(material, `fresnel:${inverted},${exponent},${low},${span}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
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

  // The same fade over a lit material's emissive pass. By the emissive stage a
  // standard material has already resolved `normal`, and it carries the view
  // vector throughout, so this needs no varyings of its own. `vNormal` would
  // not do: a flat-shaded material never declares it.
  function applyEmissiveFresnel(material, [inverted, exponent, low, span]) {
    // Materials are shared between a model's meshes, so the traversal reaches
    // one several times; injecting twice redeclares the locals and the shader
    // will not compile.
    if (material.userData.emissiveFaded) return;
    material.userData.emissiveFaded = true;
    keyProgram(material, `emisFresnel:${inverted},${exponent},${low},${span}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float emisFacing = abs( dot( normal, normalize( vViewPosition ) ) );
         float emisRim = pow( ${inverted ? '1.0 - emisFacing' : 'emisFacing'}, ${exponent.toFixed(2)} );
         totalEmissiveRadiance *= clamp( ${low.toFixed(3)} + ${span.toFixed(3)} * emisRim, 0.0, 1.0 );`
      );
    };
    material.needsUpdate = true;
  }

  // Team colour is a mask in the art's alpha: 1 keeps the art, 0 is all team
  // colour. Only a material the converter marked asks for it — its layer reads
  // RGBA — so a gate's ward turns and the stone it hangs in does not.
  const TEAM_COLOURS = [new THREE.Color(0x3f7fd8), new THREE.Color(0xd8452f)];
  const teamMaterials = new Map();

  function teamMaterial(source, team) {
    if (!source?.userData?.team && !source?.userData?.emissiveTeam) return source;
    const key = `${source.uuid}|${team}`;
    const cached = teamMaterials.get(key);
    if (cached) return cached;
    const material = source.clone();
    material.userData = source.userData;
    // `clone` copies neither the key nor the injections it stands for.
    material.programKey = source.programKey || '';
    material.customProgramCacheKey = () => material.programKey;
    // `team colour emissive add`: the layer is the shape of the light and the
    // owner's colour is the light. Untinted it is a grey lamp on every gate.
    if (source.userData.emissiveTeam && material.emissive) {
      material.emissive = TEAM_COLOURS[team].clone();
    }
    if (source.userData.team) {
      keyProgram(material, `team:${team}`);
      const before = source.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        before?.call(material, shader, renderer);
        shader.uniforms.teamColour = { value: TEAM_COLOURS[team] };
        shader.fragmentShader = 'uniform vec3 teamColour;\n' + shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           #ifdef USE_MAP
             float teamMask = 1.0 - texture2D( map, vMapUv ).a;
             float shade = dot( diffuseColor.rgb, vec3( 0.3333 ) );
             diffuseColor.rgb = mix( diffuseColor.rgb, teamColour * ( 0.35 + 1.3 * shade ), teamMask );
           #endif`
        );
      };
    }
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
    emitters.length = 0;
    emitterSource = null;
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
      // A particle system carries its art in a uniform rather than a slot.
      for (const uniform of Object.values(material.uniforms || {})) {
        if (uniform?.value?.isTexture) uniform.value.dispose();
      }
      material.dispose();
    }
    teamMaterials.clear();
  }

  async function loadMap(slug, onStatus = () => {}, { skip } = {}) {
    const token = ++loadToken;
    clearWorld();
    onStatus('Loading terrain…');

    const [placed, models] = await Promise.all([
      fetchJson(asset(`/lost-in-the-nexus/maps3d/${slug}.json`)),
      modelsIndex(),
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
    const wanted = placed.models.filter((name) => !(skip && skip(name)));
    await Promise.all(wanted.map(async (name) => {
      const entry = models.models[name];
      // An emitter-only model has no geometry at all: a chimney's smoke, the
      // fireflies over a hedge, the swirl in the Hall of Storms portal.
      const gltf = entry?.gltf && (await loadGltf(asset(entry.gltf)));
      if (gltf) {
        sources[name] = gltf.scene;
        applyGlow(gltf.scene);
        if (gltf.animations.length) clips[name] = gltf.animations[0];
      }
      if (token === loadToken && ++done % 8 === 0) {
        onStatus(`Loading models ${done}/${wanted.length}…`);
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

    emitterSource = { instances: placed.instances, models, wanted };
    if (particlesWanted) addEmitters();
    markShadows();
    return true;
  }

  // One instanced system per emitter, covering every placement of the model it
  // belongs to, so a map's hundred chimneys are a single draw call.
  function addEmitters() {
    if (!emitterSource) return;
    const { instances, models, wanted } = emitterSource;
    const placements = new Map();
    for (const item of instances) {
      if (!models.models[item.m]?.particles) continue;
      const list = placements.get(item.m) || placements.set(item.m, []).get(item.m);
      list.push(item);
    }
    for (const [name, list] of placements) {
      if (!wanted.includes(name)) continue;
      for (const spec of models.models[name].particles) {
        const texture = textures.load(asset('/lost-in-the-nexus/models/' + spec.uri));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        const mesh = emitterMesh(spec, texture, list);
        if (!mesh) continue;
        world.add(mesh);
        emitters.push(mesh);
      }
    }
  }

  // Off by default, so a map costs nothing until the reader asks for it. The
  // systems are built on the first yes and thrown away on a no.
  function setParticles(on) {
    if (on === particlesWanted) return;
    particlesWanted = on;
    if (on) {
      addEmitters();
      return;
    }
    for (const mesh of emitters) {
      world.remove(mesh);
      mesh.geometry.dispose();
      for (const uniform of Object.values(mesh.material.uniforms)) {
        if (uniform?.value?.isTexture) uniform.value.dispose();
      }
      mesh.material.dispose();
    }
    emitters.length = 0;
  }

  // Translucent surfaces (water, glow planes) would cast an opaque blob.
  // The game keeps a good half of its art out of the shadow pass and sorts the
  // rest of a model's translucent parts by hand; both ride in the material.
  function markShadows() {
    world.traverse((node) => {
      if (!node.isMesh) return;
      const materials = [node.material].flat().filter(Boolean);
      node.castShadow = !materials.some((m) => m.transparent || m.userData?.noShadow);
      node.receiveShadow = !materials.some((m) => m.userData?.noShadowReceived);
      const priority = materials.find((m) => m.userData?.priority)?.userData?.priority;
      if (priority) node.renderOrder = priority;
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
    persp.fov = FREE_FOV;
    ortho.position.copy(centre).addScaledVector(eye, 2000);
    persp.position.copy(centre).addScaledVector(eye, span * 1.6);
    ortho.top = span;
    ortho.bottom = -span;
    controls.target.copy(centre);
    resize();
    controls.update();
  }

  // The client's own camera: fixed pitch, fixed height, narrow lens. Distance
  // and field of view together set how much ground a match shows.
  const HOTS_PITCH = 60;
  const HOTS_DIST = 25;
  const HOTS_FOV = 40;
  const hotsEye = new THREE.Vector3(
    0,
    Math.sin(THREE.MathUtils.degToRad(HOTS_PITCH)),
    Math.cos(THREE.MathUtils.degToRad(HOTS_PITCH)),
  );

  // Keeps whatever the reader is looking at, put on the ground, and drops the
  // game camera over it.
  function hotsCamera() {
    if (camera !== persp) swapCamera();
    controls.target.y = centre.y;
    persp.fov = HOTS_FOV;
    persp.position.copy(controls.target).addScaledVector(hotsEye, HOTS_DIST);
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
  function readTarget(cam, width, height, transparent = false) {
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const background = scene.background;
    if (transparent) {
      scene.background = null;
      renderer.setClearAlpha(0);
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous);
    target.dispose();
    scene.background = background;
    renderer.setClearAlpha(1);

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
    return canvas;
  }

  function renderShot(shot, width, height) {
    const canvas = readTarget(poseCamera(shotCamera, shot, width / height), width, height);
    const url = canvas.toDataURL('image/webp', 0.85);
    return url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/jpeg', 0.85);
  }

  // Straight-down orthographic plate of a game-coordinate rect, at the replay
  // viewer's pixels per game unit. Image north is +y, which is how the viewer
  // reads its minimaps.
  const rectCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
  function renderRect({ minX, minY, maxX, maxY, pxPerUnit = 4, transparent = false, format = 'image/png', quality = 0.92 }) {
    const w = maxX - minX;
    const h = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cz = -(minY + maxY) / 2;
    rectCamera.position.set(cx, 3000, cz);
    rectCamera.up.set(0, 0, -1);
    rectCamera.lookAt(cx, 0, cz);
    rectCamera.left = -w / 2;
    rectCamera.right = w / 2;
    rectCamera.top = h / 2;
    rectCamera.bottom = -h / 2;
    rectCamera.updateProjectionMatrix();
    centre.set(cx, 0, cz);
    span = Math.max(w, h) / 2;
    fitShadow();
    const canvas = readTarget(rectCamera, Math.round(w * pxPerUnit), Math.round(h * pxPerUnit), transparent);
    return canvas.toDataURL(format, quality);
  }

  // One model alone on transparent ground, pitched the way the replay viewer
  // pastes it over a flat map. The anchor is where the instance's own origin
  // lands in the image, so the viewer can place it from a world position.
  const modelCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
  const SPRITE_PAD = 0.15; // game units of margin, so antialiasing has room
  async function renderModel(name, { pxPerUnit = 26, pitch: spritePitch = 60, team, r = 0, s = 0, format = 'image/png', quality = 0.92 } = {}) {
    const models = await modelsIndex();
    const entry = models?.models?.[name];
    const gltf = entry?.gltf && (await loadGltf(asset(entry.gltf)));
    if (!gltf) return null;
    clearWorld();
    applyGlow(gltf.scene);
    if (team !== undefined && entry.team) applyTeam(gltf.scene, team);
    const node = gltf.scene;
    node.rotation.y = r;
    if (s) node.scale.setScalar(s);
    node.updateMatrixWorld(true);
    world.add(node);
    markShadows();

    const box = new THREE.Box3().setFromObject(node);
    const target = box.getCenter(new THREE.Vector3());
    const reach = box.getSize(new THREE.Vector3()).length() || 1;
    const rad = THREE.MathUtils.degToRad(spritePitch);
    modelCamera.position.copy(target).addScaledVector(new THREE.Vector3(0, Math.sin(rad), Math.cos(rad)), reach * 3 + 100);
    modelCamera.up.set(0, 1, 0);
    modelCamera.lookAt(target);
    modelCamera.updateMatrixWorld();
    const toCamera = modelCamera.matrixWorldInverse;

    const point = new THREE.Vector3();
    let left = Infinity;
    let right = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          point.set(x, y, z).applyMatrix4(toCamera);
          left = Math.min(left, point.x);
          right = Math.max(right, point.x);
          bottom = Math.min(bottom, point.y);
          top = Math.max(top, point.y);
        }
      }
    }
    // An empty or unbounded box means the model brought no drawable geometry.
    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(bottom) || !Number.isFinite(top)) return null;
    left -= SPRITE_PAD;
    right += SPRITE_PAD;
    bottom -= SPRITE_PAD;
    top += SPRITE_PAD;
    modelCamera.left = left;
    modelCamera.right = right;
    modelCamera.top = top;
    modelCamera.bottom = bottom;
    modelCamera.updateProjectionMatrix();

    centre.copy(target);
    span = reach;
    fitShadow();

    const worldW = right - left;
    const worldH = top - bottom;
    const width = Math.max(1, Math.round(worldW * pxPerUnit));
    const height = Math.max(1, Math.round(worldH * pxPerUnit));
    const origin = point.set(0, 0, 0).applyMatrix4(toCamera);
    const png = readTarget(modelCamera, width, height, true).toDataURL(format, quality);
    return {
      png,
      w: width,
      h: height,
      worldW: Number(worldW.toFixed(3)),
      worldH: Number(worldH.toFixed(3)),
      anchorX: Number(((origin.x - left) / worldW).toFixed(4)),
      anchorY: Number(((top - origin.y) / worldH).toFixed(4)),
    };
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
    // Particles run off one clock each; their whole motion is a function of it.
    for (const mesh of emitters) mesh.userData.particles.value += dt;
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
    hotsCamera,
    setShadows,
    setBloom,
    setParticles,
    setFlyEnabled,
    getShot,
    applyShot,
    renderShot,
    renderRect,
    renderModel,
    clampToSurfaces,
    setWisps,
    getSpan: () => span,
    getCentre: () => centre.clone(),
    shadowsEnabled: () => renderer.shadowMap.enabled,
    bloomEnabled: () => bloom.enabled,
    particlesEnabled: () => particlesWanted,
    // Lets a headless check confirm the keys move the camera.
    probe: () => controls.target.toArray().map((v) => Math.round(v)),
  };
}
