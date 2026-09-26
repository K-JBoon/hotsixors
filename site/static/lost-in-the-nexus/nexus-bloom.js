import * as THREE from 'three';
import { Pass, FullScreenQuad } from '/nexus-vendor/postprocessing/Pass.js';

// The game's bloom: a 4x4 box downscale, a bright pass that keeps what lies
// above the threshold, a separable gaussian, all added back onto the HDR frame
// ahead of the tone map.
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

const shrink = () => new THREE.ShaderMaterial({
  uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0 } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D source;
    uniform vec2 texel;
    uniform float threshold;
    varying vec2 vUv;
    void main() {
      vec3 c = 0.25 * (
        texture2D( source, vUv + texel * vec2( -1.0, -1.0 ) ).rgb +
        texture2D( source, vUv + texel * vec2( 1.0, -1.0 ) ).rgb +
        texture2D( source, vUv + texel * vec2( -1.0, 1.0 ) ).rgb +
        texture2D( source, vUv + texel * vec2( 1.0, 1.0 ) ).rgb );
      gl_FragColor = vec4( max( c - threshold, 0.0 ), 1.0 );
    }
  `,
  depthTest: false,
  depthWrite: false,
});

// Nine taps along one axis, sigma of two texels at quarter size.
const WEIGHTS = [0.2042, 0.1802, 0.1238, 0.0663, 0.0276];

const blur = () => new THREE.ShaderMaterial({
  uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D source;
    uniform vec2 step;
    varying vec2 vUv;
    const float weights[5] = float[5]( ${WEIGHTS.map((w) => w.toFixed(4)).join(', ')} );
    void main() {
      vec3 c = texture2D( source, vUv ).rgb * weights[0];
      for ( int i = 1; i < 5; i++ ) {
        c += texture2D( source, vUv + step * float( i ) ).rgb * weights[i];
        c += texture2D( source, vUv - step * float( i ) ).rgb * weights[i];
      }
      gl_FragColor = vec4( c, 1.0 );
    }
  `,
  depthTest: false,
  depthWrite: false,
});

const add = () => new THREE.ShaderMaterial({
  uniforms: { source: { value: null } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D source;
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4( texture2D( source, vUv ).rgb, 1.0 );
    }
  `,
  // Adds colour only, so a transparent frame keeps its alpha.
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
  depthTest: false,
  depthWrite: false,
  transparent: true,
});

export class BloomPass extends Pass {
  constructor(threshold = 1) {
    super();
    this.needsSwap = false;
    this.threshold = threshold;
    const target = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.half = target();
    this.quarter = target();
    this.spare = target();
    this.shrink = shrink();
    this.blur = blur();
    this.add = add();
    this.quad = new FullScreenQuad();
  }

  setSize(width, height) {
    this.half.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.quarter.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.spare.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
  }

  draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  // `readBuffer` holds the HDR frame; the bloom lands back on it.
  render(renderer, writeBuffer, readBuffer) {
    const { shrink: s, blur: b } = this;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    s.uniforms.source.value = readBuffer.texture;
    s.uniforms.texel.value.set(0.5 / readBuffer.width, 0.5 / readBuffer.height);
    s.uniforms.threshold.value = 0;
    this.draw(renderer, s, this.half);

    s.uniforms.source.value = this.half.texture;
    s.uniforms.texel.value.set(0.5 / this.half.width, 0.5 / this.half.height);
    s.uniforms.threshold.value = this.threshold;
    this.draw(renderer, s, this.quarter);

    b.uniforms.source.value = this.quarter.texture;
    b.uniforms.step.value.set(1 / this.quarter.width, 0);
    this.draw(renderer, b, this.spare);
    b.uniforms.source.value = this.spare.texture;
    b.uniforms.step.value.set(0, 1 / this.quarter.height);
    this.draw(renderer, b, this.quarter);

    this.add.uniforms.source.value = this.quarter.texture;
    this.draw(renderer, this.add, readBuffer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    for (const t of [this.half, this.quarter, this.spare]) t.dispose();
    for (const m of [this.shrink, this.blur, this.add]) m.dispose();
    this.quad.dispose();
  }
}
