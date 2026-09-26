// Read-outs and live sliders for the inspect panel. A control reads and writes
// renderer state; `base` is the value Reset returns to.

const firstSeen = new WeakMap();

function baseOf(owner, key, value) {
  const seen = firstSeen.get(owner) || firstSeen.set(owner, {}).get(owner);
  if (!(key in seen)) seen[key] = value;
  return seen[key];
}

const fixed = (v, digits = 3) => Number(v.toFixed(digits));

export function modelInfo(node) {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  let skinned = false;
  node.traverse((child) => {
    if (!child.isMesh) return;
    meshes++;
    skinned ||= Boolean(child.isSkinnedMesh);
    const { index, attributes } = child.geometry;
    vertices += attributes.position.count;
    triangles += (index ? index.count : attributes.position.count) / 3;
  });
  const { x, y, z } = node.position;
  return [
    ['Position', `${fixed(x, 2)}, ${fixed(-z, 2)}, ${fixed(y, 2)}`],
    ['Yaw', `${fixed((node.rotation.y * 180) / Math.PI, 1)}°`],
    ['Scale', fixed(node.scale.x)],
    ['Meshes', meshes],
    ['Triangles', Math.round(triangles).toLocaleString()],
    ['Vertices', vertices.toLocaleString()],
    ['Skinned', skinned ? 'yes' : 'no'],
  ];
}

const MAPS = [
  ['map', 'Diffuse'],
  ['normalMap', 'Normal'],
  ['specularColorMap', 'Specular'],
  ['emissiveMap', 'Emissive'],
  ['alphaMap', 'Mask'],
];

// Flags the viewer sets on itself, not data from the converter.
const RUNTIME_FLAGS = new Set([
  'gamma', 'gameShaded', 'faded', 'emissiveFaded', 'diffuseFaded', 'teamLit', 'flipping', 'roughened', 'reflecting',
]);

const hex = (colour) => `#${colour.getHexString()}`;
const size = (texture) => (texture.image?.width ? `${texture.image.width}×${texture.image.height}` : 'loading');
const short = (value) => {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

export function materialInfo(material) {
  const { defines = {}, userData } = material;
  const shading = userData.glow
    ? `glow (${userData.glow})`
    : 'GAME_SPECULAR' in defines ? 'game, specular' : 'GAME_SHADING' in defines ? 'game' : 'three';
  const rows = [
    ['Type', material.type],
    ['Shading', shading],
    ['Blend', `${material.blending === 2 ? 'additive' : 'normal'}${material.transparent ? ', transparent' : ''}${material.depthWrite ? '' : ', no depth write'}`],
    ['Colour', hex(material.color)],
  ];
  if ('roughness' in material) rows.push(['Roughness / metal', `${fixed(material.roughness)} / ${fixed(material.metalness)}`]);
  if (material.emissive?.getHex()) rows.push(['Emissive', `${hex(material.emissive)} × ${fixed(material.emissiveIntensity)}`]);
  for (const [slot, label] of MAPS) {
    if (material[slot]) rows.push([`${label} map`, `${size(material[slot])}, uv${material[slot].channel}`]);
  }
  for (const [key, value] of Object.entries(userData)) {
    if (!RUNTIME_FLAGS.has(key)) rows.push([key, short(value)]);
  }
  return rows;
}

export function materialControls(material, { envio, apply }) {
  const props = [];
  if ('roughness' in material && !material.userData.roughnessInSpecularAlpha) props.push(['roughness', 'Roughness', 1]);
  if (material.isMeshPhysicalMaterial) props.push(['specularIntensity', 'Specular', 4]);
  if (material.emissive && (material.emissiveMap || material.emissive.getHex())) props.push(['emissiveIntensity', 'Emissive', 5]);
  if (material.transparent) props.push(['opacity', 'Opacity', 1]);
  const controls = props.map(([key, label, max]) => ({
    key,
    label,
    min: 0,
    max,
    step: 0.01,
    get: () => material[key],
    set: (v) => apply((m) => (m[key] = v)),
    base: baseOf(material, key, material[key]),
  }));
  if (envio) {
    controls.push({
      key: 'envioBright',
      label: 'Reflection',
      min: 0,
      max: 3,
      step: 0.01,
      get: () => envio.envioBright.value,
      set: (v) => (envio.envioBright.value = v),
      base: baseOf(material, 'envioBright', envio.envioBright.value),
    });
  }
  return controls;
}
