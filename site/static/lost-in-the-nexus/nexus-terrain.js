import * as THREE from 'three';

// Paints the ground the way the game does: eight weighted layers per pixel out of
// the block's texture set, each sampled at full size, with its own relief and
// shine. The converter's baked albedo stays on the material as the fallback.

const SLOTS = 24; // three texture sets of eight

async function decode(url, size) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob(), {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'high',
      colorSpaceConversion: 'none',
    });
  } catch {
    return null;
  }
}

// Opaque art only: a 2D canvas stores premultiplied colour, which would lose
// whatever sits under a low alpha.
async function layers(urls, size, fill, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const stride = size * size * 4;
  const data = new Uint8Array(stride * Math.max(urls.length, 1));
  const images = await Promise.all(urls.map((url) => (url ? decode(url, size) : null)));
  images.forEach((image, i) => {
    if (!image) {
      for (let p = i * stride; p < (i + 1) * stride; p += 4) data.set(fill, p);
      return;
    }
    context.drawImage(image, 0, 0);
    data.set(context.getImageData(0, 0, size, size).data, i * stride);
    image.close();
  });
  const texture = new THREE.DataArrayTexture(data, size, size, Math.max(urls.length, 1));
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function plain(loader, url, { repeat = false, nearest = false } = {}) {
  const texture = loader.load(url);
  texture.flipY = false;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  if (nearest) {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  }
  return texture;
}

function blank(value) {
  const texture = new THREE.DataTexture(new Uint8Array(value), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

// Blinn-Phong exponent to three's perceptual roughness: alpha^2 = 2 / (n + 2).
const roughnessOf = (exponent) => Math.pow(2 / (Math.max(exponent, 1) + 2), 0.25);

export async function applySplat(scene, splat, { base, cells, renderer, specularExponent = 30 }) {
  const loader = new THREE.TextureLoader();
  const url = (file) => base + file;
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const [colour, surface] = await Promise.all([
    layers(splat.tiles.map((t) => t.colour && url(t.colour)), splat.tileSize, [128, 128, 128, 255], anisotropy),
    layers(splat.tiles.map((t) => t.surface && url(t.surface)), splat.surfaceSize, [128, 128, 0, 255], anisotropy),
  ]);

  let sets = blank([0, 0, 0, 255]);
  if (splat.sets) {
    const { w, h, data } = splat.sets;
    sets = new THREE.DataTexture(Uint8Array.from(data), w, h, THREE.RedFormat);
    sets.minFilter = THREE.NearestFilter;
    sets.magFilter = THREE.NearestFilter;
    sets.needsUpdate = true;
  }
  const slots = new Float32Array(SLOTS).fill(-1);
  splat.slots.forEach((layer, i) => {
    if (i < SLOTS) slots[i] = layer;
  });

  const uniforms = {
    splatColour: { value: colour },
    splatSurface: { value: surface },
    splatMask0: { value: plain(loader, url(splat.masks[0])) },
    splatMask1: { value: plain(loader, url(splat.masks[1])) },
    splatMask2: { value: plain(loader, url(splat.masks[2])) },
    splatSets: { value: sets },
    splatSlots: { value: slots },
    splatTiling: { value: new THREE.Vector4(...splat.tiling) },
    splatCells: { value: new THREE.Vector2(cells[0], cells[1]) },
    splatSteep: { value: splat.steep ? plain(loader, url(splat.steep)) : blank([0, 0, 0, 255]) },
    splatCliff: { value: splat.cliff ? plain(loader, url(splat.cliff), { repeat: true }) : blank([128, 128, 128, 255]) },
    splatDecals: { value: splat.decals ? plain(loader, url(splat.decals)) : blank([0, 0, 0, 0]) },
    splatRoughness: { value: roughnessOf(specularExponent) },
  };
  if (splat.cliff) uniforms.splatCliff.value.anisotropy = anisotropy;

  const done = new Set();
  scene.traverse((node) => {
    for (const material of [node.material].flat()) {
      if (!material?.map || done.has(material)) continue;
      done.add(material);
      // Terrain shine is the lights' alone; the ambient reflection is for models.
      material.envMapIntensity = 0;
      material.customProgramCacheKey = () => 'splat';
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = SPLAT_HEAD + shader.fragmentShader
          .replace('#include <map_fragment>', SPLAT_COLOUR)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SPLAT_RELIEF}`)
          .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPLAT_SHINE}`);
      };
      material.needsUpdate = true;
    }
  });
}

const SPLAT_HEAD = /* glsl */ `
  uniform highp sampler2DArray splatColour;
  uniform highp sampler2DArray splatSurface;
  uniform sampler2D splatMask0;
  uniform sampler2D splatMask1;
  uniform sampler2D splatMask2;
  uniform sampler2D splatSets;
  uniform float splatSlots[ ${SLOTS} ];
  uniform vec4 splatTiling;
  uniform vec2 splatCells;
  uniform sampler2D splatSteep;
  uniform sampler2D splatCliff;
  uniform sampler2D splatDecals;
  uniform float splatRoughness;
  vec2 splatRelief;
  float splatShine;
`;

// Tile uv is the map's uvtiling repeat over the whole ground; one texture set
// per 8x8 block of cells; the eight mask weights sum to one.
const SPLAT_COLOUR = /* glsl */ `
  #ifdef USE_MAP
  {
    vec2 at = vMapUv;
    vec2 tile = at * splatTiling.xy + splatTiling.zw;
    ivec2 block = clamp( ivec2( at * splatCells / 8.0 ), ivec2( 0 ), textureSize( splatSets, 0 ) - 1 );
    int set = int( texelFetch( splatSets, block, 0 ).r * 255.0 + 0.5 );
    vec3 m0 = texture( splatMask0, at ).rgb;
    vec3 m1 = texture( splatMask1, at ).rgb;
    vec3 m2 = texture( splatMask2, at ).rgb;
    float weight[ 8 ] = float[ 8 ]( m0.r, m0.g, m0.b, m1.r, m1.g, m1.b, m2.r, m2.g );
    vec3 ground = vec3( 0.0 );
    splatRelief = vec2( 0.0 );
    splatShine = 0.0;
    for ( int i = 0; i < 8; i ++ ) {
      float layer = splatSlots[ min( set * 8 + i, ${SLOTS - 1} ) ];
      if ( weight[ i ] < 0.002 || layer < 0.0 ) continue;
      ground += texture( splatColour, vec3( tile, layer ) ).rgb * weight[ i ];
      vec3 surface = texture( splatSurface, vec3( tile, layer ) ).rgb;
      splatRelief += ( surface.xy * 2.0 - 1.0 ) * weight[ i ];
      splatShine += surface.b * weight[ i ];
    }
    float steep = texture( splatSteep, at ).r;
    ground = mix( ground, texture( splatCliff, tile * 2.0 ).rgb, steep );
    vec4 decal = texture( splatDecals, at );
    ground = mix( ground, decal.rgb, decal.a );
    float bare = ( 1.0 - steep ) * ( 1.0 - decal.a );
    splatRelief *= bare;
    splatShine *= bare;
    diffuseColor.rgb *= ground;
  }
  #endif
`;

// +u is east and +v north on the ground, which is world +x and -z.
const SPLAT_RELIEF = /* glsl */ `
  {
    vec3 east = normalize( ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
    vec3 north = normalize( ( viewMatrix * vec4( 0.0, 0.0, -1.0, 0.0 ) ).xyz );
    east = normalize( east - normal * dot( normal, east ) );
    north = normalize( north - normal * dot( normal, north ) );
    float up = sqrt( saturate( 1.0 - dot( splatRelief, splatRelief ) ) );
    normal = normalize( east * splatRelief.x + north * splatRelief.y + normal * up );
  }
`;

const SPLAT_SHINE = /* glsl */ `
  material.roughness = min( splatRoughness + geometryRoughness, 1.0 );
  material.specularColor = vec3( splatShine );
  material.specularColorBlended = material.specularColor;
`;
