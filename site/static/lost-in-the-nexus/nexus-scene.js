import * as THREE from 'three';
import { GLTFLoader } from '/nexus-vendor/GLTFLoader.js';
import { OrbitControls } from '/nexus-vendor/OrbitControls.js';
import { clone as cloneSkinned } from '/nexus-vendor/utils/SkeletonUtils.js';
import { MeshoptDecoder } from '/nexus-vendor/meshopt_decoder.module.js';
import { EffectComposer } from '/nexus-vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '/nexus-vendor/postprocessing/RenderPass.js';
import { OutputPass } from '/nexus-vendor/postprocessing/OutputPass.js';
import { emitterMesh } from '/lost-in-the-nexus/nexus-particles.js';
import { BloomPass } from '/lost-in-the-nexus/nexus-bloom.js';
import { applySplat, roughnessOf } from '/lost-in-the-nexus/nexus-terrain.js';
import { STAGES, LAST_SHADING_STAGE, stageFeatures, stageMaterial } from '/lost-in-the-nexus/nexus-stages.js';
import { modelInfo, materialInfo, materialControls } from '/lost-in-the-nexus/nexus-tweaks.js';
import { createFrameStats, formatStats } from '/lost-in-the-nexus/nexus-perf.js';

// The frame is gamma space end to end, so a hex colour means what it says.
THREE.ColorManagement.enabled = false;

function fetchJson(url) {
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

// The game's fill and back lights carry no specular; only the key does. three
// sorts the shadow-casting key to index 0 of the directional loop. Models shade
// the game's way: unnormalised Blinn-Phong in the key's specular colour, and
// no highlight at all without a specular map.
{
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const at = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
  const call = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const hit = chunk.indexOf(call, at);
  if (at >= 0 && hit >= 0) {
    THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, hit) +
      `#ifdef GAME_SHADING
       {
         float gameNL = dot( geometryNormal, directLight.direction );
         reflectedLight.directDiffuse += saturate( gameNL ) * directLight.color * BRDF_Lambert( material.diffuseColor );
         #ifdef GAME_SPECULAR
           if ( UNROLLED_LOOP_INDEX == 0 ) {
             float r2 = material.roughness * material.roughness;
             float power = 2.0 / ( r2 * r2 ) - 2.0;
             float blinn = pow( max( dot( geometryNormal, normalize( directLight.direction + geometryViewDir ) ), 1e-4 ), power );
             float shadow = dot( directLight.color, vec3( 1.0 ) ) / max( dot( directionalLight.color, vec3( 1.0 ) ), 1e-4 );
             reflectedLight.directSpecular += saturate( blinn * sign( gameNL ) ) * shadow * keySpecular * material.specularColor;
           }
         #endif
       }
       #else
         if ( UNROLLED_LOOP_INDEX > 0 ) {
           reflectedLight.directDiffuse += saturate( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );
         } else {
           ${call}
         }
       #endif` + chunk.slice(hit + call.length);
    THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
      .replace(
        '#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )',
        '#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && UNROLLED_LOOP_INDEX != 1'
      )
      .replace(
        'vDirectionalShadowCoord[ i ] ) : 1.0;',
        `vDirectionalShadowCoord[ i ] ) : 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 1
          if ( UNROLLED_LOOP_INDEX == 0 && receiveShadow ) {
            DirectionalLightShadow moving = directionalLightShadows[ 1 ];
            directLight.color *= getShadow( directionalShadowMap[ 1 ], moving.shadowMapSize, moving.shadowIntensity, moving.shadowBias, moving.shadowRadius, vDirectionalShadowCoord[ 1 ] );
          }
        #endif`
      );
    THREE.ShaderChunk.lights_pars_begin = `#ifdef GAME_SHADING
        uniform vec3 keySpecular;
      #endif
      ${THREE.ShaderChunk.lights_pars_begin}`;
  }
}

// The game's filmic operator. It maps luminance and scales the colour by the
// ratio, so hue and saturation pass through; the curve takes the gamma-space
// frame to linear and its shape puts the gamma back.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  /vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/,
  `vec3 CustomToneMapping( vec3 color ) {
     float luma = max( dot( color, vec3( 0.35, 0.5, 0.125 ) ), 1e-4 );
     float x = pow( luma, 2.2 ) * toneMappingExposure;
     return color * ( x * ( 12.3 * x + 0.5 ) / ( x * ( 12.3 * x + 4.0 ) + 0.02 ) ) / luma;
   }`
);

// The game's height fog, integrated along the view ray: dense low down and
// thinning exponentially with height. `fogNear` carries the density at height
// zero and `fogFar` the falloff.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogView;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogView = mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    varying vec3 vFogView;
  #endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    vec3 fogRay = transpose( mat3( viewMatrix ) ) * vFogView;
    float fogAmount = fogNear * length( fogRay ) * exp( -cameraPosition.y * fogFar );
    float fogT = clamp( fogFar * fogRay.y, -88.0, 88.0 );
    if ( abs( fogRay.y ) > 0.01 && fogT != 0.0 ) fogAmount *= ( 1.0 - exp( -fogT ) ) / fogT;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, saturate( fogAmount ) );
  #endif`;

// The environment only reflects; diffuse ambient is the ambient light's alone.
// Models reflect nothing but their own envio layer. three hands a material the
// scene's environment at the scene's intensity, whatever the material asks.
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace(
  'iblIrradiance += getIBLIrradiance( geometryNormal );',
  ''
) + `
  #if defined( GAME_SHADING ) && defined( RE_IndirectSpecular )
    radiance = vec3( 0.0 );
  #endif`;

async function inBatches(items, width, work) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
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
  // A map is lit by its CLight: an ambient and three directionals, of which only
  // the key casts shadows. three divides diffuse light by pi and the game does
  // not, so every intensity is scaled up by it.
  const ambient = new THREE.AmbientLight();
  const sun = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  const back = new THREE.DirectionalLight();
  const SUN_DIR = new THREE.Vector3();
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 3;
  // Static casters draw into the key's map only when something changes.
  // Animated ones redraw each frame into the map of a dark light at index 1,
  // which the key samples as well.
  const MOVING = 1;
  const DORMANT = 2;
  sun.shadow.autoUpdate = false;
  const sunMoving = new THREE.DirectionalLight(0x000000, 0);
  sunMoving.target = sun.target;
  sunMoving.castShadow = true;
  sunMoving.shadow.mapSize.copy(sun.shadow.mapSize);
  sunMoving.shadow.radius = sun.shadow.radius;
  scene.add(ambient, sun, sunMoving, sun.target, fill, back);

  // A restored context comes back with a default shadow map.
  renderer.domElement.addEventListener('webglcontextrestored', () => setShadows(shadowsOn));
  renderer.toneMapping = THREE.CustomToneMapping;
  // The game lights in gamma space: art is read as stored and the frame is not
  // encoded again. Lit in linear space, every shadow and midtone came out
  // lifted and the maps read washed out against the game's own frames.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const SKY_SATURATION = 0.4;

  function gammaArt(root) {
    root.traverse((node) => {
      for (const material of [node.material].flat()) {
        if (!material || material.userData.gamma) continue;
        material.userData.gamma = true;
        for (const value of Object.values(material)) {
          if (!value?.isTexture || value.colorSpace !== THREE.SRGBColorSpace) continue;
          value.colorSpace = THREE.NoColorSpace;
          value.needsUpdate = true;
        }
      }
    });
  }

  // The key's specular colour, which the game premultiplies by the map's
  // HDRSpecMultiplier.
  const keySpecular = { value: new THREE.Color() };
  const specularBase = new THREE.Color();
  let specularScale = 1;
  let frameBase = {};

  function gameShading(material, specular = Boolean(material?.specularColorMap)) {
    if (!material || material.userData.gameShaded) return;
    material.userData.gameShaded = true;
    material.defines = { ...material.defines, GAME_SHADING: '', ...(specular && { GAME_SPECULAR: '' }) };
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.uniforms.keySpecular = keySpecular;
    };
    material.needsUpdate = true;
  }

  // The core `DefaultLight`, for a map the index names no light for.
  const DEFAULT_LIGHT = {
    ambient: [0.502, 0.353, 0.667],
    exposure: 1.6,
    key: { colour: [1, 1, 0.722], strength: 1, direction: [0.648, -0.127, -0.751] },
    fill: { colour: [0.424, 0.525, 0.267], strength: 0.257, direction: [-0.836, 0.266, -0.48] },
    back: { colour: [1, 1, 0.722], strength: 0.2, direction: [0.635, -0.212, -0.743] },
  };

  function aim(light, { colour, strength, direction }) {
    light.color.setRGB(...colour);
    light.intensity = strength * Math.PI;
    // Game direction is where the light travels, x east, y north, z up.
    light.position.set(-direction[0], -direction[2], direction[1]).normalize();
  }

  // What spec-mapped metal reflects: a sky in the map's ambient colour, lit
  // from above and dark below. The game's own map is not shipped.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyColours = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: skyColours[0] }, middle: { value: skyColours[1] }, bottom: { value: skyColours[2] } },
      vertexShader: 'varying float vUp; void main() { vUp = normalize( position ).y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: `uniform vec3 top; uniform vec3 middle; uniform vec3 bottom; varying float vUp;
        void main() { gl_FragColor = vec4( vUp > 0.0 ? mix( middle, top, vUp ) : mix( middle, bottom, -vUp ), 1.0 ); }`,
    })
  );
  const skyScene = new THREE.Scene().add(sky);
  let environment = null;

  function setEnvironment(light) {
    const grey = 0.2126 * light.ambient[0] + 0.7152 * light.ambient[1] + 0.0722 * light.ambient[2];
    const [r, g, b] = light.ambient.map((c) => grey + (c - grey) * SKY_SATURATION);
    skyColours[0].setRGB(r, g, b).multiplyScalar(1.6);
    skyColours[1].setRGB(r, g, b);
    skyColours[2].setRGB(r, g, b).multiplyScalar(0.25);
    environment?.dispose();
    environment = pmrem.fromScene(skyScene, 0, 0.1, 10);
    scene.environment = environment.texture;
  }

  function setLighting(light = DEFAULT_LIGHT) {
    setEnvironment(light);
    ambient.color.setRGB(...light.ambient);
    ambient.intensity = Math.PI;
    aim(sun, light.key);
    SUN_DIR.copy(sun.position);
    const { specular = [1, 1, 1], specularStrength = 1 } = light.key;
    keySpecular.value.setRGB(...specular).multiplyScalar(specularStrength * (light.specularMultiplier ?? 1));
    for (const [node, spec] of [[fill, light.fill], [back, light.back]]) {
      node.visible = Boolean(spec);
      if (spec) aim(node, spec);
    }
    renderer.toneMappingExposure = light.exposure;
    for (const pass of blooms) pass.threshold = light.bloomThreshold ?? 0.9;
    // The density is folded into height zero, so the fog needs two numbers.
    const { fog } = light;
    scene.fog = fog
      ? new THREE.Fog(new THREE.Color(...fog.colour), fog.density * Math.exp(fog.height * fog.falloff), fog.falloff)
      : null;
    specularBase.copy(keySpecular.value);
    specularScale = 1;
    frameBase = {};
    frameBase = Object.fromEntries(frameControls().map((c) => [c.key, c.get()]));
  }

  // Placed art never moves, so the renderer's walk over every node is off.
  // Anything that does move updates its own matrices: the lights and wisps
  // each frame, animated models when they animate.
  const world = new THREE.Group();
  scene.add(world);
  scene.matrixWorldAutoUpdate = false;

  function freeze(node) {
    node.updateMatrixWorld(true);
    node.traverse((child) => (child.matrixAutoUpdate = false));
    return node;
  }

  const aspect = () => view.clientWidth / Math.max(view.clientHeight, 1);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
  const FREE_FOV = 50;
  const persp = new THREE.PerspectiveCamera(FREE_FOV, aspect(), 0.2, 6000);
  const seesAll = (cam) => {
    cam.layers.enable(MOVING);
    cam.layers.enable(DORMANT);
    return cam;
  };
  seesAll(ortho);
  seesAll(persp);
  let camera = persp;

  // The scene renders to HDR so additive glow accumulates before the tone map.
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const blooms = [new BloomPass(), new BloomPass()];
  composer.addPass(blooms[0]);
  const outputs = [new OutputPass(), new OutputPass()];
  composer.addPass(outputs[0]);
  setLighting();

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
    gammaArt(source);
    source.traverse((node) => {
      for (const material of [node.material].flat()) {
        // A lit material can fade its light by view angle too: the raven over
        // the objective castle is a white card without it.
        if (material?.userData?.emissiveFresnel) {
          applyEmissiveFresnel(material, material.userData.emissiveFresnel);
        }
        if (material?.userData?.diffuseFresnel) {
          applyDiffuseFresnel(material, material.userData.diffuseFresnel);
        }
        // A mask that could not be baked — it scrolls, or it reads the other
        // unwrap — is the material's transparency, glow art or not.
        if (material?.userData?.teamLight) applyTeamLight(material, material.userData.teamLight);
        if (material?.userData?.mask) applyMask(material, material.userData.mask);
        if (material?.userData?.flipbook) applyFlipbook(material, material.userData.flipbook);
        if (material?.userData?.roughnessInSpecularAlpha) applySpecularRoughness(material);
        if (material?.userData?.envio) applyEnvio(material, material.userData.envio);
        const glow = material?.userData?.glow;
        if (!glow) {
          gameShading(material);
          continue;
        }
        material.toneMapped = false;
        // The flat kind is unlit but still a surface: it occludes, so it keeps
        // its depth write. The vortex's star sphere is one, and drawn additively
        // its whole centre reads as a hole.
        if (glow === 'add') {
          material.blending = THREE.AdditiveBlending;
          material.depthWrite = false;
          material.fog = false;
          // Order does not matter to an additive layer; the default two-pass
          // double-sided draw also marks the material dirty twice per frame.
          material.forceSinglePass = true;
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

  // A flipbook layer plays a sprite sheet, one cell per frame, row-major from
  // the top left. Lava and the animated pools are 8x8 sheets; drawn whole they
  // tile all 64 frames over the surface. Frames crossfade, and the gradients
  // come from the unwrapped uv so the cell's own wrap leaves no mip seam.
  const flipbooks = [];
  const FLIPBOOK_SLOTS = {
    map: ['map_fragment', 'vMapUv'],
    alphaMap: ['alphamap_fragment', 'vAlphaMapUv'],
    emissiveMap: ['emissivemap_fragment', 'vEmissiveMapUv'],
    normalMap: ['normal_fragment_maps', 'vNormalMapUv'],
  };

  const flipbookHead = (columns, rows, frames = columns * rows) => /* glsl */ `
    uniform float flipFrame;
    vec4 flipbook( sampler2D sheet, vec2 uv ) {
      const vec2 grid = vec2( ${columns.toFixed(1)}, ${rows.toFixed(1)} );
      const float frames = ${frames.toFixed(1)};
      vec2 inCell = fract( uv ) / grid;
      vec2 dx = dFdx( uv ) / grid;
      vec2 dy = dFdy( uv ) / grid;
      float step = floor( flipFrame );
      float a = mod( step, frames );
      float b = mod( step + 1.0, frames );
      vec2 cellA = vec2( mod( a, grid.x ), floor( a / grid.x ) ) / grid;
      vec2 cellB = vec2( mod( b, grid.x ), floor( b / grid.x ) ) / grid;
      return mix(
        textureGrad( sheet, cellA + inCell, dx, dy ),
        textureGrad( sheet, cellB + inCell, dx, dy ),
        flipFrame - step
      );
    }
  `;

  function applyFlipbook(material, { grid: [columns, rows], fps, first, maps }) {
    if (material.userData.flipping) return;
    material.userData.flipping = true;
    const frame = { value: first };
    if (fps) flipbooks.push({ frame, fps, count: columns * rows });
    keyProgram(material, `flipbook:${columns}x${rows}:${maps}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.uniforms.flipFrame = frame;
      let fragment = shader.fragmentShader;
      for (const slot of maps) {
        const [chunk, uv] = FLIPBOOK_SLOTS[slot];
        fragment = fragment.replace(
          `#include <${chunk}>`,
          THREE.ShaderChunk[chunk].replaceAll(`texture2D( ${slot}, ${uv} )`, `flipbook( ${slot}, ${uv} )`)
        );
      }
      shader.fragmentShader = flipbookHead(columns, rows) + fragment;
    };
    material.needsUpdate = true;
  }

  // three keys its program cache on `onBeforeCompile.toString()`, which is the
  // same text for every material these injections touch: the first one to
  // compile then serves the rest, whatever constants it baked in. Each
  // injection names itself and its numbers instead.
  function keyProgram(material, tag) {
    material.programKey = (material.programKey || '') + '|' + tag;
    material.customProgramCacheKey = () => material.programKey;
  }

  // The game's CalcFresnelTerm: pow(1 - |N.V|, exp) peaks at the silhouette,
  // and the inverted mode is one minus that.
  function fresnelTerm(normal, eye, inverted, exponent, low, span) {
    const rim = `pow( max( 1.0 - abs( dot( ${normal}, ${eye} ) ), 0.0001 ), ${exponent.toFixed(2)} )`;
    return `clamp( ${low.toFixed(3)} + ${span.toFixed(3)} * ${inverted ? `( 1.0 - ${rim} )` : rim}, 0.0, 1.0 )`;
  }

  // A layer can fade by view angle, and on the game's energy that is the whole
  // effect: the Hall of Storms wall is a full cylinder of bright cyan faded out
  // wherever it faces the camera, leaving the rim of the portal. Without it the
  // hall wears a lit drum.
  function applyFresnel(material, [inverted, exponent, low, span]) {
    // Shared between a model's meshes, so the traversal reaches one several
    // times; injecting twice redeclares the varyings and it will not compile.
    if (material.userData.faded) return;
    material.userData.faded = true;
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
         diffuseColor.a *= ${fresnelTerm('normalize( vGlowNormal )', 'normalize( vGlowEye )', inverted, exponent, low, span)};`
      );
    };
    material.needsUpdate = true;
  }

  // The converter packs per-pixel roughness into the specular map's alpha.
  function applySpecularRoughness(material) {
    if (material.userData.roughened) return;
    material.userData.roughened = true;
    keyProgram(material, 'specRough');
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         #ifdef USE_SPECULAR_COLORMAP
           roughnessFactor = texture2D( specularColorMap, vSpecularColorMapUv ).a;
         #endif`
      );
    };
    material.needsUpdate = true;
  }

  // The game's metal reflects a map of its own rather than the sky: a cube
  // looked up by the reflected view ray or by the normal, or a sphere map. The
  // lookup is in view space, so the highlights follow the camera. The
  // converter lays a cube's faces side by side in DDS order, and the faces are
  // picked here: a samplerCube can share a texture unit with the shadow map of
  // a mesh that receives none, and WebGL then drops the draw.
  const REFLECTIVE_CUBE = 2;
  const REFLECTIVE_SPHERE = 3;
  const envioMaps = new Map();
  const envioUniforms = new WeakMap();

  const ENVIO_CUBE = /* glsl */ `
    vec3 envioCube( sampler2D strip, vec3 d ) {
      vec3 a = abs( d );
      float face;
      vec2 st;
      if ( a.x >= a.y && a.x >= a.z ) {
        face = d.x > 0.0 ? 0.0 : 1.0;
        st = vec2( d.x > 0.0 ? -d.z : d.z, -d.y ) / a.x;
      } else if ( a.y >= a.z ) {
        face = d.y > 0.0 ? 2.0 : 3.0;
        st = vec2( d.x, d.y > 0.0 ? d.z : -d.z ) / a.y;
      } else {
        face = d.z > 0.0 ? 4.0 : 5.0;
        st = vec2( d.z > 0.0 ? d.x : -d.x, -d.y ) / a.z;
      }
      vec2 inFace = clamp( st * 0.5 + 0.5, 0.01, 0.99 );
      return texture2D( strip, vec2( ( face + inFace.x ) / 6.0, inFace.y ) ).rgb;
    }
  `;

  function envioMap(uri) {
    if (envioMaps.has(uri)) return envioMaps.get(uri);
    const map = textures.load(asset('/lost-in-the-nexus/models/' + uri));
    // Faces sit side by side, so a mip would bleed one into the next.
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    envioMaps.set(uri, map);
    return map;
  }

  function applyEnvio(material, { uri, lookup, bright, mask, maskTiling = [1, 1] }) {
    if (material.userData.reflecting) return;
    material.userData.reflecting = true;
    const sphere = lookup === REFLECTIVE_SPHERE;
    const map = envioMap(uri);
    if (!sphere) map.flipY = false;
    const uniforms = {
      envioMap: { value: map },
      envioBright: { value: bright },
      envioMask: { value: null },
      envioMaskTiling: { value: new THREE.Vector2(...maskTiling) },
    };
    if (mask) {
      const maskMap = textures.load(asset('/lost-in-the-nexus/models/' + mask));
      maskMap.wrapS = maskMap.wrapT = THREE.RepeatWrapping;
      maskMap.flipY = false;
      uniforms.envioMask.value = maskMap;
    }
    envioUniforms.set(material, uniforms);
    keyProgram(material, `envio:${lookup}:${Boolean(mask)}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec2 vEnvioUv;\n' + shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vEnvioUv = uv;`
      );
      // The game's view space is x right, y forward, z up: three's (x, -z, y).
      const ray = lookup === REFLECTIVE_CUBE || sphere
        ? 'reflect( -geometryViewDir, geometryNormal )'
        : 'geometryNormal';
      const look = sphere
        ? `vec3 envio = texture2D( envioMap, ( ${ray} ).xy * 0.5 + 0.5 ).rgb;`
        : `vec3 v = ${ray};
           vec3 envio = envioCube( envioMap, vec3( v.x, -v.z, v.y ) );`;
      shader.fragmentShader = `varying vec2 vEnvioUv;
        uniform sampler2D envioMap;
        uniform float envioBright;
        uniform vec2 envioMaskTiling;
        ${mask ? 'uniform sampler2D envioMask;' : ''}
        ${sphere ? '' : ENVIO_CUBE}
        ${shader.fragmentShader}`.replace(
        '#include <lights_fragment_end>',
        // The layer's brightness scales its alpha too, and the mask is
        // multiplied by that alpha.
        `#include <lights_fragment_end>
         {
           ${look}
           vec3 envioAmount = vec3( envioBright * envioBright )${mask ? ' * texture2D( envioMask, vEnvioUv * envioMaskTiling ).rgb' : ''};
           reflectedLight.indirectSpecular += envio * envioAmount;
         }`
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
         totalEmissiveRadiance *= ${fresnelTerm('normal', 'normalize( vViewPosition )', inverted, exponent, low, span)};`
      );
    };
    material.needsUpdate = true;
  }

  // The same fade over lit art. The Heaven crystals are green in the diffuse
  // and that layer fades out facing the camera, which leaves the team-coloured
  // light. It runs after the normal map and before lighting reads diffuseColor.
  function applyDiffuseFresnel(material, [inverted, exponent, low, span]) {
    if (material.userData.diffuseFaded) return;
    material.userData.diffuseFaded = true;
    keyProgram(material, `diffFresnel:${inverted},${exponent},${low},${span}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         diffuseColor.rgb *= ${fresnelTerm('normal', 'normalize( vViewPosition )', inverted, exponent, low, span)};`
      );
    };
    material.needsUpdate = true;
  }

  // `team colour emissive add` on flat art: the owner's colour added as light,
  // under the layer's picked channel or as a flat amount. The Heaven moonwell's
  // rings and haze and the fountain's flames are drawn this way.
  function applyTeamLight(material, { uri, tiling = [1, 1], bright, uv = 0 }) {
    if (material.userData.teamLit) return;
    material.userData.teamLit = true;
    const uniforms = { teamEmissive: { value: TEAM_EMISSIVE[NEUTRAL] }, teamLight: { value: null } };
    if (uri) {
      const map = textures.load(asset('/lost-in-the-nexus/models/' + uri));
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.flipY = false;
      map.repeat.set(tiling[0], tiling[1]);
      uniforms.teamLight.value = map;
    }
    keyProgram(material, `teamLight:${Boolean(uri)}:${bright}:${uv}:${tiling}`);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before?.call(material, shader, renderer);
      shader.uniforms.teamEmissive = uniforms.teamEmissive;
      shader.uniforms.teamLight = uniforms.teamLight;
      // The Heaven gate's bars light through the second unwrap.
      const head = uv ? 'varying vec2 vTeamUv;\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n' : 'varying vec2 vTeamUv;\n';
      shader.vertexShader = head + shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vTeamUv = ${uv ? 'uv1' : 'uv'} * vec2( ${tiling[0].toFixed(4)}, ${tiling[1].toFixed(4)} );`
      );
      shader.fragmentShader = `varying vec2 vTeamUv;
        uniform vec3 teamEmissive;
        ${uri ? 'uniform sampler2D teamLight;' : ''}
        ${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb += teamEmissive * ${bright.toFixed(4)}${uri ? ' * texture2D( teamLight, vTeamUv ).g' : ''};`
      );
    };
    material.needsUpdate = true;
  }

  // Team colour is a mask in the art's alpha: 1 keeps the art, 0 is all team
  // colour. Only a material the converter marked asks for it — its layer reads
  // RGBA — so a gate's ward turns and the stone it hangs in does not. The game's
  // `CColorSpec` colours, one diffuse and one emissive per owner. A placement
  // with no owner is neutral, which is also where a merc camp's ring starts.
  const NEUTRAL = 2;
  const TEAM_COLOURS = [0x245cff, 0xb20000, 0xf7de0e].map((c) => new THREE.Color(c));
  const TEAM_EMISSIVE = [0x245cff, 0xff0000, 0x7ebff1].map((c) => new THREE.Color(c));
  const teamMaterials = new Map();

  function teamMaterial(source, team) {
    const { team: masked, emissiveTeam, teamTint, teamLight } = source?.userData ?? {};
    if (!masked && !emissiveTeam && !teamTint && !teamLight) return source;
    const key = `${source.uuid}|${team}`;
    const cached = teamMaterials.get(key);
    if (cached) return cached;
    const material = source.clone();
    material.userData = source.userData;
    // `clone` copies neither the key nor the injections it stands for, and
    // resets a standard material's defines.
    material.defines = { ...source.defines };
    material.programKey = source.programKey || '';
    material.customProgramCacheKey = () => material.programKey;
    material.onBeforeCompile = source.onBeforeCompile;
    if (envioUniforms.has(source)) envioUniforms.set(material, envioUniforms.get(source));
    // `team colour emissive add`: the layer is the shape of the light and the
    // owner's colour is the light. Untinted it is a grey lamp on every gate.
    if (source.userData.emissiveTeam && material.emissive) {
      material.emissive = TEAM_EMISSIVE[team].clone();
    }
    if (teamLight) {
      const before = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        before?.call(material, shader, renderer);
        shader.uniforms.teamEmissive = { value: TEAM_EMISSIVE[team] };
      };
    }
    // A capture ring's art is only the glyph's shape; the owner's colour is its colour.
    if (source.userData.teamTint) material.color.multiply(TEAM_COLOURS[team]);
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
  function waterMesh({ height, regions, colour, normals, tiling, scroll, specularity }) {
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
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...tint),
      transparent: true,
      opacity: 0.8,
      roughness: specularity ? roughnessOf(specularity) : 0.3,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    if (normals) waterSurface(material, normals, tiling, scroll);
    return new THREE.Mesh(geometry, material);
  }

  // The game ripples its water with a run of normal-map frames, drawn twice at
  // the type's world tiling and drifting apart along its scroll vectors.
  const waterClock = { value: 0 };

  function waterSurface(material, { uri, grid: [columns, rows], frames, fps }, tiling, scroll) {
    const sheet = textures.load(asset(uri));
    sheet.flipY = false;
    const frame = { value: 0 };
    if (fps) flipbooks.push({ frame, fps, count: frames });
    keyProgram(material, `water:${columns}x${rows}:${frames}`);
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        flipFrame: frame,
        waterNormals: { value: sheet },
        waterTiling: { value: new THREE.Vector4(...tiling) },
        waterScroll: { value: new THREE.Vector4(...scroll) },
        waterTime: waterClock,
      });
      shader.vertexShader = 'varying vec2 vWaterAt;\n' + shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWaterAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;`
      );
      shader.fragmentShader = `varying vec2 vWaterAt;
        uniform sampler2D waterNormals;
        uniform vec4 waterTiling;
        uniform vec4 waterScroll;
        uniform float waterTime;
        ${flipbookHead(columns, rows, frames)}
        ${shader.fragmentShader}`.replace(
        '#include <normal_fragment_maps>',
        // Map north is world -z; the sheet's +v runs north.
        `#include <normal_fragment_maps>
         {
           vec2 at = vec2( vWaterAt.x, -vWaterAt.y );
           vec3 a = flipbook( waterNormals, at * waterTiling.xy + waterScroll.xy * waterTime ).xyz * 2.0 - 1.0;
           vec3 b = flipbook( waterNormals, at * waterTiling.zw + waterScroll.zw * waterTime ).xyz * 2.0 - 1.0;
           vec3 ripple = normalize( vec3( a.xy + b.xy, a.z * b.z ) );
           normal = normalize( ( viewMatrix * vec4( ripple.x, ripple.z, -ripple.y, 0.0 ) ).xyz );
         }`
      );
    };
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
    return new THREE.CanvasTexture(canvas);
  }

  function backdropMesh(box, colour) {
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 2.2;
    const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: backdropTexture(colour),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }));
    const centre = box.getCenter(new THREE.Vector3());
    mesh.position.set(centre.x, box.max.y - BACKDROP_DROP, centre.z);
    return mesh;
  }

  // Instances share their source's buffers, so each is freed once.
  function clearWorld() {
    endInspect();
    mixers.length = 0;
    scrollers.length = 0;
    flipbooks.length = 0;
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
    setLighting(terrain?.light);
    if (terrain) {
      const ground = await loadGltf(asset(terrain.gltf));
      if (token !== loadToken) return false;
      if (ground) gammaArt(ground.scene);
      if (ground && terrain.splat) {
        await applySplat(ground.scene, terrain.splat, {
          base: asset('/lost-in-the-nexus/terrain/'),
          cells: terrain.cells,
          renderer,
          specularExponent: terrain.light?.terrainSpecularExp,
        });
        if (token !== loadToken) return false;
        ground.scene.traverse((node) => {
          for (const material of [node.material].flat()) if (material?.map) gameShading(material, true);
        });
      }
      if (ground) {
        world.add(ground.scene);
        freeze(ground.scene);
        groundBox = new THREE.Box3().setFromObject(ground.scene);
        // Only the maps that hang in daylight name one; elsewhere the scene's
        // own background is what belongs under the cut.
        if (terrain.backdrop) world.add(freeze(backdropMesh(groundBox, terrain.backdrop)));
      }
      for (const body of terrain.water || []) world.add(freeze(waterMesh(body)));
    }

    const sources = {};
    const clips = {};
    let done = 0;
    const wanted = placed.models.filter((name) => !(skip && skip(name)));
    // A model resolves only once its textures have, and all of them at once
    // run the browser out of request slots.
    await inBatches(wanted, 24, async (name) => {
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
    });
    if (token !== loadToken) return false;

    // Game x east, y north, z up -> glTF x east, y up, z south.
    for (const item of placed.instances) {
      const source = sources[item.m];
      if (!source) continue;
      const clip = clips[item.m];
      // A skinned model needs its own skeleton, which a plain clone shares.
      const node = clip ? cloneSkinned(source) : source.clone(true);
      node.userData.model = item.m;
      node.position.set(item.x, item.z, -item.y);
      node.rotation.y = item.r || 0;
      if (item.s) node.scale.multiplyScalar(item.s);
      if (models.models[item.m]?.team) applyTeam(node, item.t ?? NEUTRAL);
      world.add(node);
      freeze(node);
      if (!clip) continue;
      const parts = [];
      node.traverse((child) => {
        child.layers.set(MOVING);
        parts.push(child);
      });
      const mixer = new THREE.AnimationMixer(node);
      const action = mixer.clipAction(clip);
      action.play();
      // Or every tree sways in lockstep.
      action.time = Math.random() * clip.duration;
      // Wide enough that a shadow falling into view still moves.
      const reach = new THREE.Box3().setFromObject(node).getBoundingSphere(new THREE.Sphere());
      reach.radius *= 3;
      mixers.push({ node, parts, mixer, reach, idle: 0, awake: true });
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
    sun.shadow.needsUpdate = true;
  }

  // Toggling the shadow map changes every program, so the materials recompile.
  function setBloom(on) {
    if (inspecting) {
      inspecting.bloom = on;
      setStage(inspecting.stage);
      return;
    }
    blooms[0].enabled = on;
  }

  // three culls shadow casters by the view camera's layers, so each map
  // gets its own pass with a camera that sees only its casters.
  const staticCasters = new THREE.Camera();
  const movingCasters = new THREE.Camera();
  movingCasters.layers.set(MOVING);

  function splitShadowPass(shadowMap) {
    if (shadowMap.split) return;
    shadowMap.split = true;
    const render = shadowMap.render;
    shadowMap.render = function (lights, root) {
      render.call(this, lights.filter((light) => light === sun), root, staticCasters);
      render.call(this, lights.filter((light) => light === sunMoving), root, movingCasters);
    };
  }

  let shadowsOn = false;
  function setShadows(on) {
    shadowsOn = on;
    splitShadowPass(renderer.shadowMap);
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.enabled = on;
    sun.shadow.needsUpdate = true;
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
    sun.shadow.normalBias = ((2 * radius) / sun.shadow.mapSize.x) * (sun.shadow.radius + 1.5);
    sun.shadow.needsUpdate = true;
    sunMoving.position.copy(sun.position);
    sunMoving.shadow.normalBias = sun.shadow.normalBias;
    sunMoving.shadow.camera.copy(cam);
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

  const shotCamera = seesAll(new THREE.PerspectiveCamera(50, 1, 0.2, 6000));

  // Readback of an offscreen render: the live canvas keeps showing the player's
  // own view while a shot is developed.
  // The scene renders to HDR and goes through the same tone map as the view; the
  // output pass writes sRGB itself, so the final target stays untagged.
  function readTarget(cam, width, height, transparent = false) {
    const hdr = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType });
    const target = new THREE.WebGLRenderTarget(width, height);
    const background = scene.background;
    if (transparent) {
      scene.background = null;
      renderer.setClearAlpha(0);
    }
    const previous = renderer.getRenderTarget();
    animate(0, cam);
    renderer.setRenderTarget(hdr);
    renderer.render(scene, cam);
    if (blooms[0].enabled) {
      blooms[1].setSize(width, height);
      blooms[1].render(renderer, null, hdr);
    }
    outputs[1].render(renderer, target, hdr);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous);
    hdr.dispose();
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
  const rectCamera = seesAll(new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000));
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
  const modelCamera = seesAll(new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000));
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
  pickRay.layers.enable(MOVING);
  pickRay.layers.enable(DORMANT);
  let pressAt = null;
  let pressTime = 0;
  let onClick = null;

  function aimPick(x, y) {
    const rect = renderer.domElement.getBoundingClientRect();
    pickRay.setFromCamera(
      new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
      camera
    );
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    pressAt = [e.clientX, e.clientY];
    pressTime = performance.now();
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pressAt) return;
    const [x, y] = pressAt;
    pressAt = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 4 || performance.now() - pressTime > 350) return;
    aimPick(e.clientX, e.clientY);
    const wisp = onWispPick && pickRay.intersectObjects([...wisps.values()], false)[0];
    if (wisp) onWispPick(wisp.object.userData.wispId);
    else onClick?.(e);
  });

  // The placed model under the pointer. Surfaces that write no depth (water,
  // particles, the backdrop) let the ray through; the ground stops it.
  function pickModel(x, y) {
    aimPick(x, y);
    for (const hit of pickRay.intersectObject(world, true)) {
      let node = hit.object;
      while (node && !node.userData.model) node = node.parent;
      if (node) return node;
      if ([hit.object.material].flat().some((m) => m?.depthWrite !== false)) return null;
    }
    return null;
  }

  // Debug: one model alone under the live renderer, its materials cut at a
  // stage from STAGES. Orbit and fly work as usual; post stages switch the
  // frame's bloom and tone map.
  let inspecting = null;
  const TONE_MAP_STAGE = STAGES.length - 1;
  const BLOOM_STAGE = TONE_MAP_STAGE - 1;

  // Frame-wide constants for the debug panel. Light sliders are in game units:
  // 1 is the strength the map asks for.
  function frameControls() {
    const lit = (light) => ({ max: 3, get: () => light.intensity / Math.PI, set: (v) => (light.intensity = v * Math.PI) });
    const list = [
      ['exposure', 'Exposure', { max: 4, get: () => renderer.toneMappingExposure, set: (v) => (renderer.toneMappingExposure = v) }],
      ['bloomThreshold', 'Bloom threshold', { max: 3, get: () => blooms[0].threshold, set: (v) => blooms.forEach((pass) => (pass.threshold = v)) }],
      ['ambient', 'Ambient', lit(ambient)],
      ['key', 'Key light', lit(sun)],
      ['fill', 'Fill light', lit(fill)],
      ['back', 'Back light', lit(back)],
      ['keySpecular', 'Key specular', {
        max: 4,
        get: () => specularScale,
        set: (v) => {
          specularScale = v;
          keySpecular.value.copy(specularBase).multiplyScalar(v);
        },
      }],
    ];
    if (scene.fog) {
      const { fog } = scene;
      list.push(
        ['fogDensity', 'Fog density', { max: 4 * (frameBase.fogDensity || fog.near) || 0.02, step: 0.0001, get: () => fog.near, set: (v) => (fog.near = v) }],
        ['fogFalloff', 'Fog falloff', { max: 4 * (frameBase.fogFalloff || fog.far) || 0.5, step: 0.0001, get: () => fog.far, set: (v) => (fog.far = v) }],
      );
    }
    return list.map(([key, label, spec]) => ({ key, label, min: 0, step: 0.01, ...spec, base: frameBase[key] ?? spec.get() }));
  }

  function inspectDetails() {
    if (!inspecting) return null;
    const { node, originals, variants } = inspecting;
    const unique = [...new Set(originals.flat())];
    const apply = (material) => (fn) => {
      fn(material);
      for (const [key, copy] of variants) if (key.startsWith(`${material.uuid}|`)) fn(copy);
    };
    return {
      model: modelInfo(node),
      frame: frameControls(),
      materials: unique.map((material) => ({
        name: material.name || material.type,
        info: materialInfo(material),
        controls: materialControls(material, { envio: envioUniforms.get(material), apply: apply(material) }),
      })),
    };
  }

  // `inset` is the width in pixels the panel covers on the right; the model is
  // centred in what is left.
  function inspect(node, { inset = 0 } = {}) {
    endInspect();
    const meshes = [];
    node.traverse((child) => {
      if (child.isMesh && child.material) meshes.push(child);
    });
    const originals = meshes.map((mesh) => mesh.material);
    const hidden = [...world.children, wispGroup].filter((o) => o !== node && o.visible);
    for (const o of hidden) o.visible = false;
    inspecting = {
      node,
      meshes,
      originals,
      hidden,
      variants: new Map(),
      bloom: blooms[0].enabled,
      stage: 0,
      view: { camera, position: camera.position.clone(), target: controls.target.clone(), fov: persp.fov, centre: centre.clone(), span },
    };

    const sphere = new THREE.Box3().setFromObject(node).getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.5);
    const direction = camera.getWorldDirection(new THREE.Vector3());
    if (camera !== persp) swapCamera();
    persp.fov = FREE_FOV;
    if (inset) persp.setViewOffset(view.clientWidth, view.clientHeight, inset / 2, 0, view.clientWidth, view.clientHeight);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(FREE_FOV / 2))) * 1.1;
    controls.target.copy(sphere.center);
    persp.position.copy(sphere.center).addScaledVector(direction, -distance);
    centre.copy(sphere.center);
    span = radius;
    fitShadow();
    resize();
    controls.update();

    setStage(0);
    precompileStages(inspecting);
    return { ...stageFeatures(originals.flat()), fog: Boolean(scene.fog), bloom: inspecting.bloom };
  }

  function stageMaterials(index) {
    const { originals, variants } = inspecting;
    if (index >= LAST_SHADING_STAGE) return originals;
    const cut = (material) => {
      const key = `${material.uuid}|${index}`;
      if (!variants.has(key)) variants.set(key, stageMaterial(material, index));
      return variants.get(key);
    };
    return originals.map((m) => (Array.isArray(m) ? m.map(cut) : cut(m)));
  }

  function setStage(index) {
    if (!inspecting) return;
    inspecting.stage = index;
    const materials = stageMaterials(index);
    inspecting.meshes.forEach((mesh, i) => (mesh.material = materials[i]));
    blooms[0].enabled = inspecting.bloom && index >= BLOOM_STAGE;
    renderer.toneMapping = index === TONE_MAP_STAGE ? THREE.CustomToneMapping : THREE.NoToneMapping;
  }

  // Compiles each stage off the frame, so stepping through does not stall.
  async function precompileStages(state) {
    for (let index = 0; index < LAST_SHADING_STAGE; index++) {
      if (inspecting !== state) return;
      const current = state.stage;
      setStage(index);
      const compiled = renderer.compileAsync(scene, camera);
      setStage(current);
      await compiled;
    }
  }

  function endInspect() {
    if (!inspecting) return;
    const { meshes, originals, hidden, variants, bloom, view } = inspecting;
    inspecting = null;
    meshes.forEach((mesh, i) => (mesh.material = originals[i]));
    for (const o of hidden) o.visible = true;
    for (const material of variants.values()) material.dispose();
    blooms[0].enabled = bloom;
    renderer.toneMapping = THREE.CustomToneMapping;
    if (camera !== view.camera) swapCamera();
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    persp.fov = view.fov;
    persp.clearViewOffset();
    centre.copy(view.centre);
    span = view.span;
    fitShadow();
    resize();
    controls.update();
  }

  // Keeps the camera a little clear of whatever it is looking straight at, so
  // dollying or flying in can't push the lens through a wall or a doodad.
  // Water and glow layers draw with depthWrite off, which doubles as the
  // "not a real surface" marker here. Free flying is left alone (walls and
  // terrain are noclip while searching for a spot); this only nudges the
  // camera out when a shot is actually taken, and only far enough to clear
  // whatever it is embedded in — a narrow corridor still frames tight.
  const MIN_SHOT_DIST = 1.2;
  const surfaceRay = new THREE.Raycaster();
  surfaceRay.layers.enable(MOVING);
  surfaceRay.layers.enable(DORMANT);
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

  let frameStats = null;
  function setStats(on) {
    if (Boolean(frameStats) === on) return;
    frameStats?.dispose();
    frameStats = on ? createFrameStats(renderer) : null;
  }

  function statsText() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return frameStats && formatStats(frameStats.read(), { width: size.x, height: size.y, pixelRatio: renderer.getPixelRatio() });
  }

  // Off-screen animation waits and catches up once it is back in view.
  // Animated nodes are frozen too, so their bones cost nothing until then,
  // and a dormant layer keeps them out of both shadow passes.
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const loose = [ambient, sun, sunMoving, sun.target, fill, back, wispGroup];

  function animate(dt, view = camera) {
    for (const node of loose) node.updateMatrixWorld();
    view.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
    for (const entry of mixers) {
      entry.idle += dt;
      const awake = frustum.intersectsSphere(entry.reach);
      if (awake !== entry.awake) {
        entry.awake = awake;
        for (const part of entry.parts) part.layers.set(awake ? MOVING : DORMANT);
      }
      if (!awake) continue;
      entry.mixer.update(entry.idle);
      entry.idle = 0;
      for (const part of entry.parts) part.updateMatrix();
      entry.node.updateMatrixWorld(true);
    }
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  function render(timestamp) {
    frameStats?.begin();
    const dt = Math.min(timer.update(timestamp).getDelta(), 0.1);
    fly(dt);
    for (const { map, scroll } of scrollers) {
      map.offset.set((map.offset.x + scroll[0] * dt) % 1, (map.offset.y + scroll[1] * dt) % 1);
    }
    waterClock.value += dt;
    for (const { frame, fps, count } of flipbooks) {
      frame.value = (((frame.value + fps * dt) % count) + count) % count;
    }
    // Particles run off one clock each; their whole motion is a function of it.
    for (const mesh of emitters) mesh.userData.particles.value += dt;
    controls.update();
    animate(dt);
    composer.render();
    frameStats?.end();
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
    bloomEnabled: () => (inspecting ? inspecting.bloom : blooms[0].enabled),
    setParticles,
    setFlyEnabled,
    getShot,
    applyShot,
    renderShot,
    renderRect,
    renderModel,
    clampToSurfaces,
    setWisps,
    pickModel,
    inspect,
    setStage,
    endInspect,
    inspectDetails,
    setClickHandler: (handler) => {
      onClick = handler;
    },
    getSpan: () => span,
    getCentre: () => centre.clone(),
    shadowsEnabled: () => renderer.shadowMap.enabled,
    particlesEnabled: () => particlesWanted,
    setStats,
    statsText,
    // Lets a headless check confirm the keys move the camera.
    probe: () => controls.target.toArray().map((v) => Math.round(v)),
  };
}
