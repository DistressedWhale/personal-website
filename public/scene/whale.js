import * as THREE from 'three';
import { common } from './glsl.js';
import { TAU, geometry, mesh, gridIndices, cross } from './util.js';

const L = 25;      // length in metres
const NOSE_Z = 11; // z of the nose tip. The whale faces +Z; u = 0 is the nose and u = 1 the tail.

// Monotone cubic interpolation through [u, value] keys. It never overshoots, so the outline has no bumps.
function curve(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Body outline as fractions of the length: half width, height above the spine, depth below the spine.
const halfWidth = curve([
  [0, 0], [0.006, 0.017], [0.02, 0.031], [0.06, 0.049], [0.12, 0.061], [0.22, 0.070], [0.32, 0.073],
  [0.45, 0.067], [0.58, 0.052], [0.70, 0.035], [0.80, 0.022], [0.90, 0.012], [0.96, 0.008], [0.99, 0.005], [1, 0],
]);
const topHeight = curve([
  [0, 0], [0.006, 0.006], [0.02, 0.011], [0.06, 0.020], [0.12, 0.032], [0.22, 0.048], [0.32, 0.058],
  [0.45, 0.062], [0.58, 0.056], [0.70, 0.045], [0.80, 0.034], [0.90, 0.022], [0.96, 0.013], [0.99, 0.007], [1, 0],
]);
const bottomDepth = curve([
  [0, 0], [0.006, 0.010], [0.02, 0.022], [0.06, 0.042], [0.12, 0.058], [0.22, 0.070], [0.32, 0.074],
  [0.45, 0.068], [0.58, 0.054], [0.70, 0.042], [0.80, 0.032], [0.90, 0.021], [0.96, 0.013], [0.99, 0.007], [1, 0],
]);

// Body surface. u runs from nose to tail. v runs once around: 0 is the back, 0.5 is the belly.
function bodyPoint(u, v) {
  const s = Math.sin(v * TAU), c = Math.cos(v * TAU);
  // The head has a squarer cross-section than the rest of the body.
  const e = 0.78 + 0.22 * Math.min(1, u / 0.3);
  const sx = Math.sign(s) * Math.pow(Math.abs(s), e);
  const sy = Math.sign(c) * Math.pow(Math.abs(c), e);
  return [halfWidth(u) * L * sx, (c >= 0 ? topHeight(u) : bottomDepth(u)) * L * sy, NOSE_Z - u * L];
}

// A fin is a wing. t runs along the span, v once around the section. `le` and `te` give the leading and
// trailing edge, `thick` the half thickness.
const finPoint = (fin) => (t, v) => {
  const along = 0.5 * (1 - Math.cos(v * TAU));
  const le = fin.le(t), te = fin.te(t);
  const y = fin.thick(t) * Math.sin(v * TAU) * (0.35 + 0.65 * Math.sqrt(1 - along * 0.85));
  return [fin.span * t, y, le + (te - le) * along];
};
const fluke = {
  span: 3.5,
  le: (t) => -2.35 * Math.pow(t, 1.5),
  te: (t) => -1.5 - 0.52 * Math.sin(Math.min(t * 3, 1) * Math.PI * 0.5) - 0.4 * t,
  thick: (t) => 0.23 * Math.pow(1 - t, 0.8) + 0.004,
};
const flipper = {
  span: 3.4,
  le: (t) => -1.25 * Math.pow(t, 1.7),
  te: (t) => -1.25 * Math.pow(t, 1.7) - (0.98 * Math.pow(1 - Math.pow(t, 2.2), 0.7) + 0.02),
  thick: (t) => 0.10 * (1 - t) + 0.006,
};
const dorsal = {
  span: 0.5,
  le: (t) => -0.72 * Math.pow(t, 0.9),
  te: (t) => -0.95 + 0.2 * t,
  thick: (t) => 0.06 * (1 - t) + 0.003,
};

// Samples a parametric surface on a grid. Normals come from the surface function, not the mesh, so the
// duplicate seam vertices get the same normal. `flip` turns the surface inside out.
function sampleSurface(fn, nu, nv, flip) {
  const pos = [], nor = [], par = [];
  const e = 1e-3;
  const normalAt = (u, v) => cross(fn(u, v + e), fn(u, v - e), fn(Math.min(u + e, 1), v), fn(Math.max(u - e, 0), v));
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      let n = normalAt(u, v);
      // At a pole the surface shrinks to a point. Take the normal from just inside it.
      if (n[3] < 1e-7) n = normalAt(u < 0.5 ? u + 0.004 : u - 0.004, v);
      const s = (flip ? -1 : 1) / (n[3] || 1);
      pos.push(...fn(u, v));
      nor.push(n[0] * s, n[1] * s, n[2] * s);
      par.push(u, v);
    }
  }
  return { pos, nor, par, idx: gridIndices(nu, nv, 0, flip) };
}

const BODY = 0, FLUKE = 1, FLIPPER = 2, DORSAL = 3; // values of aPart

function buildGeometry() {
  const out = { pos: [], nor: [], uv: [], part: [], span: [], idx: [] };
  const v3 = new THREE.Vector3();
  // Adds one surface to the whale. `mirror` adds its mirror image on the other side instead.
  const add = (surf, part, matrix, mirror) => {
    const start = out.pos.length / 3, flipX = mirror ? -1 : 1;
    const normalMatrix = matrix && new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < surf.pos.length; i += 3) {
      v3.fromArray(surf.pos, i);
      if (matrix) v3.applyMatrix4(matrix);
      out.pos.push(flipX * v3.x, v3.y, v3.z);
      v3.fromArray(surf.nor, i);
      if (matrix) v3.applyMatrix3(normalMatrix).normalize();
      out.nor.push(flipX * v3.x, v3.y, v3.z);
      // The body keeps its surface coordinate for the skin pattern. A fin keeps its place along the span, for bending.
      const u = surf.par[(i / 3) * 2], v = surf.par[(i / 3) * 2 + 1];
      if (part === BODY) { out.uv.push(u, v); out.span.push(0); } else { out.uv.push(-1, 0); out.span.push(u); }
      out.part.push(part);
    }
    for (let i = 0; i < surf.idx.length; i += 3) {
      const a = surf.idx[i] + start, b = surf.idx[i + 1] + start, c = surf.idx[i + 2] + start;
      if (mirror) out.idx.push(a, c, b);
      else out.idx.push(a, b, c);
    }
  };
  const pair = (surf, part, matrix) => { add(surf, part, matrix, false); add(surf, part, matrix, true); };

  add(sampleSurface(bodyPoint, 150, 72, false), BODY, null, false);
  pair(sampleSurface(finPoint(fluke), 28, 20, true), FLUKE, new THREE.Matrix4().makeTranslation(0, 0, NOSE_Z - 0.945 * L));

  // Flippers point out, back and down from low on the side of the chest.
  const span = new THREE.Vector3(0.74, -0.36, -0.57).normalize();
  const fwd = new THREE.Vector3(0, 0.12, 1);
  fwd.addScaledVector(span, -fwd.dot(span)).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, span);
  const u0 = 0.265;
  pair(sampleSurface(finPoint(flipper), 24, 18, true), FLIPPER, new THREE.Matrix4().makeBasis(span, up, fwd)
    .setPosition(halfWidth(u0) * L * 0.80, -bottomDepth(u0) * L * 0.52, NOSE_Z - u0 * L));

  const u1 = 0.765;
  add(sampleSurface(finPoint(dorsal), 12, 14, true), DORSAL, new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1))
    .setPosition(0, topHeight(u1) * L - 0.08, NOSE_Z - u1 * L), false);

  return geometry({
    position: [out.pos, 3], normal: [out.nor, 3], aUV: [out.uv, 2], aPart: [out.part, 1], aSpan: [out.span, 1],
  }, out.idx);
}

const constants = /* glsl */ `
const float LEN = ${L.toFixed(1)};
const float NOSE_Z = ${NOSE_Z.toFixed(1)};
`;

const vertexShader = /* glsl */ `
attribute vec2 aUV;
attribute float aPart;
attribute float aSpan;
uniform float uSwimPhase;    // radians
uniform float uAmp;          // tail stroke size in metres
uniform float uFlipperPhase; // radians
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRest;
varying vec2 vUV;
varying float vPart;
varying vec3 vAxis;
${constants}
const float WAVE = 3.5; // radians of swim wave along the body

// Size of the up and down motion along the body. Small at the head, largest at the tail.
float env(float s) { return 0.05 - 0.42 * s + 1.35 * s * s; }
float denv(float s) { return -0.42 + 2.7 * s; }

// Lift and tilt of the spine at s, the distance from the nose as a fraction of the length.
void bend(float s, out float lift, out float ang) {
  float th = uSwimPhase - WAVE * s;
  lift = uAmp * env(s) * sin(th);
  float dlift = uAmp * (denv(s) * sin(th) - WAVE * env(s) * cos(th));
  ang = atan(-dlift / LEN);
}

void main() {
  vec3 p = position;
  vRest = position;
  vUV = aUV;
  vPart = aPart;

  if (aPart > 1.5 && aPart < 2.5) p.y += aSpan * aSpan * 0.5 * sin(uFlipperPhase + 0.6 * sign(p.x)); // flippers

  // A body vertex turns about the spine at its own place. The stiff fluke turns as one piece about the
  // tail stock, and takes its tilt from further down the body wave, so it trails the body.
  bool isFluke = aPart > 0.5 && aPart < 1.5;
  float s = isFluke ? 0.945 : (NOSE_Z - p.z) / LEN;
  float pivotZ = NOSE_Z - s * LEN;
  float lift, ang, unused;
  bend(s, lift, ang);
  if (isFluke) bend(1.12, unused, ang);
  float c = cos(ang), sn = sin(ang);
  float dz = isFluke ? p.z - pivotZ : 0.0;
  vec3 q = vec3(p.x, lift + p.y * c + dz * sn, (isFluke ? pivotZ : p.z) - p.y * sn + dz * c);
  vec3 n = vec3(normal.x, normal.y * c + normal.z * sn, -normal.y * sn + normal.z * c);

  vec4 w = modelMatrix * vec4(q, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vAxis = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragmentShader = /* glsl */ `
${common}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRest;
varying vec2 vUV;
varying float vPart;
varying vec3 vAxis;
${constants}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  bool body = vPart < 0.5;
  float u = body ? vUV.x : (NOSE_Z - vRest.z) / LEN;
  float v = vUV.y;
  float belly = body ? 1.0 - smoothstep(0.10, 0.30, abs(v - 0.5)) : 1.0 - smoothstep(-0.3, 0.1, normalize(vNormal).y);

  // Blue whale skin is slate blue with paler mottling.
  vec2 muv = body ? vec2(u * 7.0, v * 4.0) : vRest.xz * 0.30 + vRest.y * 0.2;
  float n1 = texture(uNoise, muv).r;
  float n2 = texture(uNoise, muv * 2.7 + 0.37).g;
  float n3 = texture(uNoise, muv * 8.0 + 0.11).b;
  float mottle = smoothstep(0.46, 0.70, n1 * 0.55 + n2 * 0.45);
  float speck = smoothstep(0.60, 0.78, n3);
  vec3 albedo = mix(vec3(0.115, 0.185, 0.265), vec3(0.300, 0.395, 0.470), mottle * 0.55 + speck * 0.22);
  albedo = mix(albedo, albedo * 1.25 + vec3(0.03, 0.04, 0.04), belly * 0.55);
  albedo *= 0.88 + 0.24 * n2;

  if (body) {
    // Throat grooves run from the chin to the navel.
    float zone = (1.0 - smoothstep(0.17, 0.25, abs(v - 0.5)))
               * (1.0 - smoothstep(0.50, 0.58, u)) * smoothstep(0.004, 0.03, u);
    float q = v * 150.0;
    float aa = 1.0 - smoothstep(0.20, 0.55, fwidth(q));
    float groove = zone * aa;
    vec3 around = normalize(cross(N, vAxis));
    N = normalize(N + around * sin(q * TAU) * 0.42 * groove);
    albedo *= 1.0 - 0.30 * groove * smoothstep(0.2, 1.0, -cos(q * TAU));

    // Mouth line and eye.
    float side = smoothstep(0.03, 0.10, abs(v - 0.5)) * smoothstep(0.03, 0.10, 0.5 - abs(v - 0.5));
    float mouthY = 0.10 + 0.26 * smoothstep(0.015, 0.11, u) - 0.80 * smoothstep(0.135, 0.215, u);
    float mouth = (1.0 - smoothstep(0.012, 0.045, abs(vRest.y - mouthY)))
                * smoothstep(0.004, 0.02, u) * (1.0 - smoothstep(0.205, 0.215, u)) * side;
    albedo *= 1.0 - 0.6 * mouth;
    float eye = length(vec2((u - 0.226) * LEN, vRest.y + 0.30));
    albedo = mix(albedo, vec3(0.01, 0.012, 0.016), (1.0 - smoothstep(0.07, 0.11, eye)) * side);
    albedo *= 1.0 + 0.25 * (smoothstep(0.10, 0.12, eye) - smoothstep(0.12, 0.24, eye)) * side;
  }

  // The whale has its own lighting: a softer sun wrap and a stronger rim than shadeSurface.
  float depth = -vWorld.y;
  float ndl = dot(N, uSunWater);
  float caustic = causticAt(vWorld);
  vec3 sun = sunAt(depth) * clamp((ndl + 0.30) / 1.30, 0.0, 1.0) * mix(1.0, caustic, 0.9 * smoothstep(-0.05, 0.35, ndl));
  vec3 col = albedo * (sun * 1.25 + skyLight(N, depth) * 1.5);
  vec3 H = normalize(uSunWater + V);
  col += sunAt(depth) * (pow(max(dot(N, H), 0.0), 48.0) * smoothstep(0.0, 0.2, ndl)) * 0.22 * (0.3 + caustic);
  col += waterBg(reflect(-V, N)) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.75;
  gl_FragColor = vec4(fogged(col, vWorld), 1.0);
}
`;

export function createWhale(shared) {
  const uniforms = { ...shared, uSwimPhase: { value: 0 }, uAmp: { value: 1.4 }, uFlipperPhase: { value: 0 } };
  const whale = {
    mesh: mesh(buildGeometry(), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })),
    velocity: new THREE.Vector3(), // metres per second, through the water
    focus: new THREE.Vector3(),    // the point that the camera looks at
    update(time, dt) {
      // Stroke and glide: the whale beats its tail hard for a while, then eases off.
      const effort = 0.62 + 0.38 * Math.sin(time * 0.083) * Math.sin(time * 0.031 + 1.0);
      const speed = 2.6 + 1.6 * effort;
      uniforms.uSwimPhase.value = (uniforms.uSwimPhase.value + dt * TAU * (0.13 + 0.10 * effort)) % TAU;
      uniforms.uFlipperPhase.value = (uniforms.uFlipperPhase.value + dt * 0.45) % TAU;
      uniforms.uAmp.value = 0.75 + 0.95 * effort;

      // Slow changes of depth and course, each with its rate of change.
      const y = -17 + 6.5 * Math.sin(time * 0.027) + 3.0 * Math.sin(time * 0.0113 + 2.0);
      const climb = 6.5 * 0.027 * Math.cos(time * 0.027) + 3.0 * 0.0113 * Math.cos(time * 0.0113 + 2.0);
      const yaw = 0.16 * Math.sin(time * 0.019) + 0.08 * Math.sin(time * 0.043 + 0.7);
      const yawRate = 0.16 * 0.019 * Math.cos(time * 0.019) + 0.08 * 0.043 * Math.cos(time * 0.043 + 0.7);

      // The body rocks against the tail stroke. It pitches with the climb and rolls into its turns.
      const recoil = Math.sin(uniforms.uSwimPhase.value - 0.9) * effort;
      whale.mesh.position.set(0, y + 0.10 * recoil, 0);
      whale.mesh.rotation.set(-(Math.atan2(climb, speed) * 1.6 + 0.018 * recoil), yaw, -yawRate * 22 + 0.03 * Math.sin(time * 0.07));
      whale.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
      whale.focus.set(Math.sin(yaw) * 3, y + 0.5, Math.cos(yaw) * 3);
    },
  };
  return whale;
}
