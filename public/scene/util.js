import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = THREE.MathUtils.clamp;

// Seeded random numbers, so the scene looks the same on every load. rand() returns 0..1.
export function rng(seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rand.range = (lo, hi) => lo + rand() * (hi - lo);
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  return rand;
}

// A geometry from plain arrays: { name: [values, itemSize] }.
export function geometry(attributes, index, Class = THREE.BufferGeometry) {
  const geo = new Class();
  for (const [name, [values, size]] of Object.entries(attributes)) {
    geo.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  if (index) geo.setIndex(index);
  return geo;
}

// Every shader moves its vertices, so the bounds that three.js would cull by are wrong. No mesh is culled.
export function mesh(geo, material, renderOrder = 0) {
  const m = new THREE.Mesh(geo, material);
  m.frustumCulled = false;
  m.rotation.order = 'YXZ'; // yaw, then pitch, then roll
  m.renderOrder = renderOrder;
  return m;
}

// Triangles for a grid of (nu + 1) by (nv + 1) vertices, stored row by row from `start`. `flip` turns them over.
export function gridIndices(nu, nv, start = 0, flip = false) {
  const idx = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = start + i * (nv + 1) + j, b = a + nv + 1;
      if (flip) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return idx;
}

// (a - b) x (c - d), with its length as the fourth value. Four nearby surface points give a surface normal this way.
export function cross(a, b, c, d) {
  const px = a[0] - b[0], py = a[1] - b[1], pz = a[2] - b[2], qx = c[0] - d[0], qy = c[1] - d[1], qz = c[2] - d[2];
  const x = py * qz - pz * qy, y = pz * qx - px * qz, z = px * qy - py * qx;
  return [x, y, z, Math.hypot(x, y, z)];
}

// One quad that covers the screen, for passes that draw a whole texture.
export const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const quad = mesh(new THREE.PlaneGeometry(2, 2));
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export function drawQuad(renderer, material, target) {
  quad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(quad, quadCamera);
}
