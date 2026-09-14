import * as THREE from 'three';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uLife;        // longest life; a particle's own is in aLife
  uniform float uGravity;
  uniform float uDrag;
  uniform vec3 uColour[6];    // two sets of start / middle / end
  uniform vec4 uAlpha;        // start, middle, end alphas of set 0 and 1 packed
  uniform vec4 uAlphaB;
  uniform vec3 uMid;          // where the middle key sits: colour, alpha, size
  uniform vec3 uHold;         // how long it holds there
  uniform vec2 uGrid;         // flipbook rows, columns

  attribute vec3 aOrigin;     // where this particle is born, in world units
  attribute vec3 aDir;        // its launch direction
  attribute float aSpeed;
  attribute float aLife;
  attribute float aPhase;     // 0..1 through its life at t = 0
  attribute vec3 aScale;      // start, middle and end size
  attribute vec2 aSpin;       // angle at birth, and turn per second
  attribute float aBlend;     // which of the two rolled colour sets, 0..1
  attribute float aCell;      // flipbook cell

  varying vec2 vUv;
  varying vec4 vColour;

  // A three-key ramp: rise to the middle, hold, then fall to the end.
  float keyed( float t, float mid, float hold ) {
    float rest = max( 1.0 - mid - hold, 1e-4 );
    if ( t < mid ) return 0.5 * t / max( mid, 1e-4 );
    if ( t < mid + hold ) return 0.5;
    return 0.5 + 0.5 * ( t - mid - hold ) / rest;
  }

  vec3 ramp3( float k, vec3 a, vec3 b, vec3 c ) {
    return k < 0.5 ? mix( a, b, k * 2.0 ) : mix( b, c, k * 2.0 - 1.0 );
  }

  float ramp1( float k, float a, float b, float c ) {
    return k < 0.5 ? mix( a, b, k * 2.0 ) : mix( b, c, k * 2.0 - 1.0 );
  }

  void main() {
    float age = mod( uTime + aPhase * aLife, aLife );
    float t = age / aLife;

    // Constant launch velocity with a linear drag, and gravity on world up.
    float travel = uDrag > 0.001
      ? ( 1.0 - exp( -uDrag * age ) ) / uDrag
      : age;
    vec3 centre = aOrigin + aDir * ( aSpeed * travel );
    centre.y += 0.5 * uGravity * age * age;

    float size = ramp1( keyed( t, uMid.z, uHold.z ), aScale.x, aScale.y, aScale.z );
    float turn = aSpin.x + aSpin.y * age;

    vec3 colour = mix(
      ramp3( keyed( t, uMid.x, uHold.x ), uColour[0], uColour[1], uColour[2] ),
      ramp3( keyed( t, uMid.x, uHold.x ), uColour[3], uColour[4], uColour[5] ),
      aBlend
    );
    float alphaKey = keyed( t, uMid.y, uHold.y );
    float alpha = mix(
      ramp1( alphaKey, uAlpha.x, uAlpha.y, uAlpha.z ),
      ramp1( alphaKey, uAlphaB.x, uAlphaB.y, uAlphaB.z ),
      aBlend
    );
    vColour = vec4( colour, alpha );

    // Billboard: the quad's corners are laid out in view space, so a particle
    // always faces the camera whatever the model under it is doing.
    vec4 view = modelViewMatrix * vec4( centre, 1.0 );
    float c = cos( turn );
    float s = sin( turn );
    vec2 corner = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * size;
    view.xy += corner;
    gl_Position = projectionMatrix * view;

    // The flipbook is a grid of cells over the one texture.
    float cell = floor( aCell );
    vec2 step = 1.0 / uGrid.yx;
    vUv = ( uv + vec2( mod( cell, uGrid.y ), floor( cell / uGrid.y ) ) ) * step;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColour;

  void main() {
    vec4 art = texture2D( uMap, vUv );
    vec3 rgb = art.rgb * vColour.rgb;
    float alpha = art.a * vColour.a;
    if ( alpha < 0.004 ) discard;
    // Additive art carries its brightness in the colour, not in coverage.
    gl_FragColor = vec4( uAdditive > 0.5 ? rgb * alpha : rgb, alpha );
  }
`;

function random(state) {
  // One deterministic stream, so a reload puts every particle back where it was.
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}

function shape(spec, roll) {
  const [sx, sy, sz] = spec.size;
  const r = spec.radius;
  const a = roll() * Math.PI * 2;
  switch (spec.area) {
    case 0: // a point
      return [0, 0, 0];
    case 1: // a plane
      return [(roll() - 0.5) * sx, (roll() - 0.5) * sy, 0];
    case 2: // a sphere
    case 4: {
      const u = roll() * 2 - 1;
      const p = Math.sqrt(1 - u * u) * r * Math.cbrt(roll());
      return [Math.cos(a) * p, Math.sin(a) * p, u * r * Math.cbrt(roll())];
    }
    case 3: { // a cylinder
      const p = r * Math.sqrt(roll());
      return [Math.cos(a) * p, Math.sin(a) * p, (roll() - 0.5) * sz];
    }
    default:
      return [(roll() - 0.5) * sx, (roll() - 0.5) * sy, (roll() - 0.5) * sz];
  }
}

// Game x east, y north, z up -> glTF x east, y up, z south, the same flip the
// placements get.
function toWorld([x, y, z]) {
  return [x, z, -y];
}

// A system runs for the length of its longest life, and holds `rate` a second
// alive at any moment. The model's own cap is the ceiling.
function population(spec) {
  const life = Math.max(spec.life[0], spec.life[1]);
  return Math.max(1, Math.min(spec.max, Math.ceil(spec.rate * life)));
}

/**
 * One instanced mesh drawing `spec` at every one of `placements`.
 * A placement is { x, y, z, r } in game coordinates, as the map files store it.
 */
export function emitterMesh(spec, texture, placements) {
  const per = population(spec);
  const count = per * placements.length;
  if (!count) return null;

  // Its own quad rather than a shared one: disposing a map's systems would
  // otherwise free buffers the next map's systems are still pointing at.
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.attributes.position = quad.attributes.position;
  geometry.attributes.uv = quad.attributes.uv;
  geometry.instanceCount = count;

  const origin = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const life = new Float32Array(count);
  const phase = new Float32Array(count);
  const scale = new Float32Array(count * 3);
  const spin = new Float32Array(count * 2);
  const blend = new Float32Array(count);
  const cell = new Float32Array(count);

  const state = { seed: 20130327 };
  const roll = () => random(state);
  const [rows, columns] = spec.grid;
  const cells = rows * columns;
  const at = toWorld(spec.at);

  for (let p = 0; p < placements.length; p++) {
    const place = placements[p];
    const turn = place.r || 0;
    // The emitter hangs off a bone of the model, which turns with the placement.
    const bx = at[0] * Math.cos(turn) + at[2] * Math.sin(turn);
    const bz = -at[0] * Math.sin(turn) + at[2] * Math.cos(turn);
    for (let i = 0; i < per; i++) {
      const n = p * per + i;
      const [ox, oy, oz] = toWorld(shape(spec, roll));
      origin[n * 3] = place.x + bx + ox;
      origin[n * 3 + 1] = place.z + at[1] + oy;
      origin[n * 3 + 2] = -place.y + bz + oz;

      // The spread is a cone about the emitter's own up; a negative speed is
      // how the game pulls particles inwards, which is most of the vortex.
      const cone = Math.max(spec.spread[0], spec.spread[1]);
      const tilt = cone * Math.sqrt(roll());
      const about = roll() * Math.PI * 2;
      dir[n * 3] = Math.sin(tilt) * Math.cos(about);
      dir[n * 3 + 1] = Math.cos(tilt);
      dir[n * 3 + 2] = Math.sin(tilt) * Math.sin(about);

      speed[n] = spec.speed[0] + (spec.speed[1] - spec.speed[0]) * roll();
      life[n] = Math.max(0.05, spec.life[0] + (spec.life[1] - spec.life[0]) * roll());
      phase[n] = roll();
      const s = roll();
      for (let k = 0; k < 3; k++) {
        scale[n * 3 + k] = spec.scale[0][k] + (spec.scale[1][k] - spec.scale[0][k]) * s;
      }
      spin[n * 2] = spec.spin[0][0] + (spec.spin[1][0] - spec.spin[0][0]) * roll();
      spin[n * 2 + 1] = spec.spin[0][1] + (spec.spin[1][1] - spec.spin[0][1]) * roll();
      blend[n] = roll();
      cell[n] = Math.floor(roll() * cells);
    }
  }

  const attribute = (data, size) => new THREE.InstancedBufferAttribute(data, size);
  geometry.setAttribute('aOrigin', attribute(origin, 3));
  geometry.setAttribute('aDir', attribute(dir, 3));
  geometry.setAttribute('aSpeed', attribute(speed, 1));
  geometry.setAttribute('aLife', attribute(life, 1));
  geometry.setAttribute('aPhase', attribute(phase, 1));
  geometry.setAttribute('aScale', attribute(scale, 3));
  geometry.setAttribute('aSpin', attribute(spin, 2));
  geometry.setAttribute('aBlend', attribute(blend, 1));
  geometry.setAttribute('aCell', attribute(cell, 1));

  const [setA, setB] = spec.colour;
  const colours = [];
  for (const set of [setA, setB]) {
    for (const key of set) colours.push(new THREE.Vector3(key[0] / 255, key[1] / 255, key[2] / 255));
  }
  const additive = spec.blend >= 2;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: Math.max(spec.life[0], spec.life[1]) },
      uGravity: { value: spec.gravity },
      uDrag: { value: spec.drag },
      uColour: { value: colours },
      uAlpha: { value: new THREE.Vector4(...setA.map((k) => k[3] / 255), 0) },
      uAlphaB: { value: new THREE.Vector4(...setB.map((k) => k[3] / 255), 0) },
      uMid: { value: new THREE.Vector3(...spec.mid) },
      uHold: { value: new THREE.Vector3(...spec.hold) },
      uGrid: { value: new THREE.Vector2(rows, columns) },
      uMap: { value: texture },
      uAdditive: { value: additive ? 1 : 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Every particle is placed in world units already, and a billboard has no
  // meaningful bounds, so the frustum test would cull the whole system.
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.particles = material.uniforms.uTime;
  return mesh;
}
