import * as THREE from 'three';
import { common } from './glsl.js';

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

function bodyPoint(u, v) {
  const th = v * Math.PI * 2; // 0 is the back, half a turn is the belly
  const s = Math.sin(th), c = Math.cos(th);
  // The head has a squarer cross-section than the rest of the body.
  const e = 0.78 + 0.22 * Math.min(1, u / 0.3);
  const sx = Math.sign(s) * Math.pow(Math.abs(s), e);
  const sy = Math.sign(c) * Math.pow(Math.abs(c), e);
  return [halfWidth(u) * L * sx, (c >= 0 ? topHeight(u) : bottomDepth(u)) * L * sy, NOSE_Z - u * L];
}

// A fin is a wing: `le` and `te` give the leading and trailing edge along the span, `thick` the half thickness.
function finPoint(spec) {
  return (t, v) => {
    const ph = v * Math.PI * 2;
    const along = 0.5 * (1 - Math.cos(ph));
    const le = spec.le(t), te = spec.te(t);
    const y = spec.thick(t) * Math.sin(ph) * (0.35 + 0.65 * Math.sqrt(1 - along * 0.85));
    return [spec.span * t, y, le + (te - le) * along];
  };
}

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

// Samples a parametric surface on a grid. Normals come from the surface function, not the mesh, so the duplicate seam vertices get the same normal.
function sampleSurface(fn, nu, nv, flip) {
  const pos = [], nor = [], par = [], idx = [];
  const e = 1e-3;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalAt = (u, v) => {
    const du = sub(fn(Math.min(u + e, 1), v), fn(Math.max(u - e, 0), v));
    const dv = sub(fn(u, v + e), fn(u, v - e));
    const n = cross(dv, du);
    return [n, Math.hypot(n[0], n[1], n[2])];
  };
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      pos.push(...fn(u, v));
      let [n, len] = normalAt(u, v);
      // At a pole the surface shrinks to a point. Take the normal from just inside it.
      if (len < 1e-7) [n, len] = normalAt(u < 0.5 ? u + 0.004 : u - 0.004, v);
      const s = (flip ? -1 : 1) / (len || 1);
      nor.push(n[0] * s, n[1] * s, n[2] * s);
      par.push(u, v);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1, c = a + 1, d = b + 1;
      if (flip) idx.push(a, b, c, c, b, d);
      else idx.push(a, c, b, c, d, b);
    }
  }
  return { pos, nor, par, idx };
}

function buildGeometry() {
  const out = { pos: [], nor: [], uv: [], part: [], span: [], idx: [] };
  const v3 = new THREE.Vector3();
  const add = (surf, part, matrix, mirror) => {
    const start = out.pos.length / 3;
    const normalMatrix = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    for (let i = 0; i < surf.pos.length / 3; i++) {
      v3.set(surf.pos[i * 3], surf.pos[i * 3 + 1], surf.pos[i * 3 + 2]);
      if (matrix) v3.applyMatrix4(matrix);
      out.pos.push(mirror ? -v3.x : v3.x, v3.y, v3.z);
      v3.set(surf.nor[i * 3], surf.nor[i * 3 + 1], surf.nor[i * 3 + 2]);
      if (normalMatrix) v3.applyMatrix3(normalMatrix).normalize();
      out.nor.push(mirror ? -v3.x : v3.x, v3.y, v3.z);
      if (part === 0) out.uv.push(surf.par[i * 2], surf.par[i * 2 + 1]);
      else out.uv.push(-1, 0);
      out.part.push(part);
      out.span.push(part === 0 ? 0 : surf.par[i * 2]);
    }
    for (let i = 0; i < surf.idx.length; i += 3) {
      const a = surf.idx[i] + start, b = surf.idx[i + 1] + start, c = surf.idx[i + 2] + start;
      if (mirror) out.idx.push(a, c, b);
      else out.idx.push(a, b, c);
    }
  };

  add(sampleSurface(bodyPoint, 150, 72, false), 0, null, false);

  const flukeSurf = sampleSurface(finPoint(fluke), 28, 20, true);
  const flukeAt = new THREE.Matrix4().makeTranslation(0, 0, NOSE_Z - 0.945 * L);
  add(flukeSurf, 1, flukeAt, false);
  add(flukeSurf, 1, flukeAt, true);

  // Flippers point out, back and down from low on the side of the chest.
  const flipSurf = sampleSurface(finPoint(flipper), 24, 18, true);
  const span = new THREE.Vector3(0.74, -0.36, -0.57).normalize();
  const fwd = new THREE.Vector3(0, 0.12, 1);
  fwd.addScaledVector(span, -fwd.dot(span)).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, span);
  const u0 = 0.265;
  const flipAt = new THREE.Matrix4().makeBasis(span, up, fwd)
    .setPosition(halfWidth(u0) * L * 0.80, -bottomDepth(u0) * L * 0.52, NOSE_Z - u0 * L);
  add(flipSurf, 2, flipAt, false);
  add(flipSurf, 2, flipAt, true);

  const dorsalSurf = sampleSurface(finPoint(dorsal), 12, 14, true);
  const u1 = 0.765;
  const dorsalAt = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1))
    .setPosition(0, topHeight(u1) * L - 0.08, NOSE_Z - u1 * L);
  add(dorsalSurf, 3, dorsalAt, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  geo.setAttribute('aUV', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(out.part, 1));
  geo.setAttribute('aSpan', new THREE.Float32BufferAttribute(out.span, 1));
  geo.setIndex(out.idx);
  return geo;
}

const vertexShader = /* glsl */ `
attribute vec2 aUV;
attribute float aPart;
attribute float aSpan;
uniform float uSwimPhase;  // swim cycle
uniform float uAmp;    // tail stroke size in metres
uniform float uFlipperPhase;   // flipper cycle
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRest;
varying vec2 vUV;
varying float vPart;
varying vec3 vAxis;

const float LEN = ${L.toFixed(1)};
const float NOSE_Z = ${NOSE_Z.toFixed(1)};
const float WAVE = 3.5; // radians of swim wave along the body

// Size of the up and down motion along the body. Small at the head, largest at the tail.
float env(float s) { return 0.05 - 0.42 * s + 1.35 * s * s; }
float denv(float s) { return -0.42 + 2.7 * s; }

void bend(float s, out float lift, out float ang) {
  float th = uSwimPhase - WAVE * s;
  lift = uAmp * env(s) * sin(th);
  float dlift = uAmp * (denv(s) * sin(th) - WAVE * env(s) * cos(th));
  ang = atan(-dlift / LEN);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  vRest = position;
  vUV = aUV;
  vPart = aPart;

  if (aPart > 1.5 && aPart < 2.5) {
    p.y += aSpan * aSpan * 0.5 * sin(uFlipperPhase + 0.6 * sign(p.x));
  }

  float s = (NOSE_Z - p.z) / LEN;
  float lift, ang;
  vec3 q;
  if (aPart > 0.5 && aPart < 1.5) {
    // The fluke is stiff. It turns about the tail stock and trails the body wave.
    float pivot = 0.945;
    float unused;
    bend(pivot, lift, unused);
    bend(1.12, unused, ang);
    float zp = NOSE_Z - pivot * LEN;
    float dz = p.z - zp;
    float c = cos(ang), sn = sin(ang);
    q = vec3(p.x, lift + p.y * c + dz * sn, zp - p.y * sn + dz * c);
    n = vec3(n.x, n.y * c + n.z * sn, -n.y * sn + n.z * c);
  } else {
    bend(s, lift, ang);
    float c = cos(ang), sn = sin(ang);
    q = vec3(p.x, lift + p.y * c, p.z - p.y * sn);
    n = vec3(n.x, n.y * c + n.z * sn, -n.y * sn + n.z * c);
  }

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

const float LEN = ${L.toFixed(1)};
const float NOSE_Z = ${NOSE_Z.toFixed(1)};

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

  float depth = -vWorld.y;
  float ndl = dot(N, uSunWater);
  float wrap = clamp((ndl + 0.30) / 1.30, 0.0, 1.0);
  float caustic = causticAt(vWorld);
  vec3 sun = sunAt(depth) * wrap * mix(1.0, caustic, 0.9 * smoothstep(-0.05, 0.35, ndl));

  // Light scattered by the water arrives from everywhere, strongest from above.
  float skyward = N.y * 0.5 + 0.5;
  vec3 ambient = mix(vec3(0.010, 0.060, 0.110), vec3(0.060, 0.330, 0.470), skyward * skyward)
               * exp(-AMBIENT_LOSS * depth);

  vec3 col = albedo * (sun * 1.25 + ambient * 1.5);

  vec3 H = normalize(uSunWater + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * smoothstep(0.0, 0.2, ndl);
  col += sunAt(depth) * spec * 0.22 * (0.3 + caustic);

  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += waterBg(reflect(-V, N)) * rim * 0.75;

  gl_FragColor = vec4(fogged(col, vWorld), 1.0);
}
`;

export function createWhale(shared) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uSwimPhase: { value: 0 },
      uAmp: { value: 1.4 },
      uFlipperPhase: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.frustumCulled = false;
  mesh.rotation.order = 'YXZ';
  return { mesh, uniforms: material.uniforms };
}
