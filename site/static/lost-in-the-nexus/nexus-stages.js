// Render stages in the order the model's fragment shader and the frame's passes
// run them. Each stage adds one step to the stage before it. Stages up to fog
// cut the real material's shader; bloom and tone map are frame passes.
export const STAGES = [
  { id: 'geometry', title: 'Geometry' },
  { id: 'uv', title: 'UV' },
  { id: 'diffuse', title: 'Diffuse' },
  { id: 'normal', title: 'Normal map' },
  { id: 'emissive', title: 'Emissive and glow' },
  { id: 'specular', title: 'Specular' },
  { id: 'envio', title: 'Reflection' },
  { id: 'fog', title: 'Fog' },
  { id: 'bloom', title: 'Bloom' },
  { id: 'tonemap', title: 'Tone map' },
];

const stage = Object.fromEntries(STAGES.map(({ id }, i) => [id, i]));
export const LAST_SHADING_STAGE = stage.fog;

export function stageFeatures(materials) {
  const has = (test) => materials.some(test);
  return {
    uv: has((m) => m.map),
    normal: has((m) => m.normalMap),
    emissive: has((m) => m.userData.glow || m.emissiveMap || m.emissive?.getHex()),
    specular: has((m) => m.defines && 'GAME_SPECULAR' in m.defines),
    envio: has((m) => m.userData.envio),
  };
}

const CHECKER = /* glsl */ `
  #if DEBUG_STAGE == ${stage.uv}
    vec3 stageChecker( vec2 uv ) {
      vec2 cell = floor( uv * 8.0 );
      float odd = mod( cell.x + cell.y, 2.0 );
      return mix( vec3( fract( uv ), 0.35 ), vec3( 0.85 ), odd * 0.5 );
    }
  #endif
`;

const ALBEDO = /* glsl */ `
  #if DEBUG_STAGE < ${stage.diffuse}
    diffuseColor.rgb = vec3( 0.6 );
    #if DEBUG_STAGE == ${stage.uv} && defined( USE_MAP )
      diffuseColor.rgb = stageChecker( vMapUv );
    #endif
  #endif
`;

function before(shader, anchor, code) {
  return shader.replace(anchor, `${code}\n${anchor}`);
}

// Anchors are includes the viewer's own injections append to but never replace.
function cutShader(fragment) {
  let out = CHECKER + fragment.replace('#include <fog_fragment>', '');
  if (!out.includes('#include <lights_physical_fragment>')) {
    return before(out, '#include <specularmap_fragment>', ALBEDO);
  }
  out = before(out, '#include <emissivemap_fragment>', `
    #if DEBUG_STAGE < ${stage.normal}
      normal = nonPerturbedNormal;
    #endif`);
  out = before(out, '#include <lights_physical_fragment>', `${ALBEDO}
    #if DEBUG_STAGE < ${stage.emissive}
      totalEmissiveRadiance = vec3( 0.0 );
    #endif`);
  out = out.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
    #if DEBUG_STAGE < ${stage.specular}
      material.specularColor = vec3( 0.0 );
      material.specularColorBlended = vec3( 0.0 );
      material.specularF90 = 0.0;
    #endif`);
  return before(out, '#include <aomap_fragment>', `
    #if DEBUG_STAGE < ${stage.envio}
      reflectedLight.indirectSpecular = vec3( 0.0 );
    #endif`);
}

// A copy of the material cut at `index`. Unlit glow art is emissive in the game,
// so it stays hidden until that stage.
export function stageMaterial(source, index) {
  const material = source.clone();
  material.userData = source.userData;
  material.defines = { ...source.defines, DEBUG_STAGE: index };
  material.programKey = `${source.programKey || ''}|stage:${index}`;
  material.customProgramCacheKey = () => material.programKey;
  const inject = source.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    inject?.call(material, shader, renderer);
    shader.fragmentShader = cutShader(shader.fragmentShader);
  };
  if (source.userData.glow && index < stage.emissive) material.visible = false;
  return material;
}
