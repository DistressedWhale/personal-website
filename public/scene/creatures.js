import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';

const TAU = Math.PI * 2;
const LOOP = 600; // seconds. Shader motion repeats exactly over this time, so the wrap shows no jump.

// ---------------------------------------------------------------------------------------------
// Pack fish: tuna and pilot fish share one body shape and one shader. Each fish holds a slot in the frame of the pack mesh and wanders around it.

function spindleGeometry() {
  // A fish about one unit long that faces +Z: smooth body, crescent tail, dorsal fin and two pectoral fins.
  const pos = [], nor = [], fin = [], idx = [];
  const RINGS = 11, SIDES = 10;
  const halfHeight = (t) => 0.135 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85) + 0.004;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const z = 0.5 - 0.92 * t;
    const h = halfHeight(t), w = h * 0.62;
    const dh = (halfHeight(Math.min(t + 0.01, 1)) - halfHeight(Math.max(t - 0.01, 0))) / (0.02 * 0.92);
    for (let j = 0; j <= SIDES; j++) {
      const a = (j / SIDES) * TAU;
      const cx = Math.sin(a), cy = Math.cos(a);
      pos.push(w * cx, h * cy, z);
      const n = new THREE.Vector3(cx / 0.62, cy, dh).normalize();
      nor.push(n.x, n.y, n.z);
      fin.push(0);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const flat = (points, normal) => {
    const start = pos.length / 3;
    for (const p of points) { pos.push(...p); nor.push(...normal); fin.push(1); }
    for (let i = 1; i < points.length - 1; i++) idx.push(start, start + i, start + i + 1);
  };
  flat([[0, 0, -0.38], [0, 0.24, -0.66], [0, 0.03, -0.50], [0, -0.03, -0.50], [0, -0.24, -0.66]], [1, 0, 0]);
  flat([[0, 0.12, 0.08], [0, 0.20, -0.05], [0, 0.11, -0.13]], [1, 0, 0]);
  flat([[0.07, -0.04, 0.16], [0.20, -0.13, -0.04], [0.075, -0.05, 0.05]], [0.3, 0.95, 0]);
  flat([[-0.07, -0.04, 0.16], [-0.20, -0.13, -0.04], [-0.075, -0.05, 0.05]], [-0.3, 0.95, 0]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1));
  geo.setIndex(idx);
  return geo;
}

function createPack(shared, loop, { slots, look, seed }) {
  const rand = rng(seed);
  const count = slots.length;
  const slot = new Float32Array(count * 3);
  const vary = new Float32Array(count * 4);
  slots.forEach((s, i) => {
    slot.set([s.x, s.y, s.z], i * 3);
    // phase, scale (about the length in metres), wander distance in metres, whole wander cycles per loop
    vary.set([rand() * TAU, s.size, s.wander, Math.round(34 + rand() * 40)], i * 4);
  });
  const geo = spindleGeometry();
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 3));
  geo.setAttribute('aVary', new THREE.InstancedBufferAttribute(vary, 4));
  geo.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      ...shared,
      uLoop: loop,
      uBeat: { value: 0 },
      uBeatAmp: { value: look.beatAmp },
      uBack: { value: new THREE.Color(...look.back) },
      uBelly: { value: new THREE.Color(...look.belly) },
      uFin: { value: new THREE.Color(...look.fin) },
      uStripes: { value: look.stripes },
      uFlash: { value: look.flash },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSlot;
      attribute vec4 aVary;
      attribute float aFin;
      uniform float uLoop, uBeat, uBeatAmp;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vBody;
      varying float vFin;
      const float TAU = 6.2831853;
      void main() {
        float w = TAU / ${LOOP.toFixed(1)} * uLoop;
        float c = aVary.w;
        vec3 wander = aVary.z * vec3(sin(w * c + aVary.x),
                                    0.6 * sin(w * (c + 3.0) + aVary.x * 1.7),
                                    1.5 * sin(w * (c - 2.0) + aVary.x * 2.3));
        // The fish turns its nose toward the side it drifts to.
        float yaw = 0.22 * cos(w * c + aVary.x) * min(aVary.z, 1.0);

        vec3 p = position;
        vec3 n = normal;
        float flex = 1.0 - smoothstep(-0.66, 0.30, p.z);
        float beat = sin(uBeat + aVary.x * 3.0 - p.z * 4.5);
        p.x += beat * uBeatAmp * flex;
        n.z += beat * uBeatAmp * 3.0 * n.x * flex;

        float cy = cos(yaw), sy = sin(yaw);
        p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
        n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);

        vec4 world = modelMatrix * vec4(aSlot + wander + p * aVary.y, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        vBody = position;
        vFin = aFin;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform vec3 uBack, uBelly, uFin;
      uniform float uStripes, uFlash;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vBody;
      varying float vFin;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        // Dark back, pale belly. The split sits a little above the middle of the side.
        float side = smoothstep(-0.02, 0.07, vBody.y);
        vec3 albedo = mix(uBelly, uBack, side);
        float bands = smoothstep(0.15, 0.55, sin(vBody.z * TAU * uStripes + 1.2));
        albedo = mix(albedo, uBack * 0.35, bands * step(0.5, uStripes) * 0.85);
        albedo = mix(albedo, uFin, vFin);
        gl_FragColor = vec4(shadeSurface(albedo, N, V, vWorld, 30.0, uFlash * (1.0 - side * 0.7)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.rotation.order = 'YXZ';
  return { mesh, uniforms: material.uniforms };
}

// ---------------------------------------------------------------------------------------------
// Manta ray: a flat diamond with wings that flap as a wave from the body to the tips.

const MANTA_HALF_SPAN = 2.7;

function mantaGeometry() {
  const pos = [], nor = [], span = [], top = [], uv = [], idx = [];
  const NS = 30, NC = 12;
  const point = (s, c, side) => {
    const a = Math.abs(s);
    // The bump near the middle of the leading edge makes the two head fins.
    const le = 0.95 - 1.05 * Math.pow(a, 1.25) + 0.26 * Math.exp(-Math.pow((a - 0.13) / 0.05, 2));
    const te = -0.95 + 0.85 * Math.pow(a, 0.75);
    const th = 0.36 * Math.pow(1 - a, 1.6) * Math.pow(Math.sin(Math.PI * c), 0.6);
    return [s * MANTA_HALF_SPAN, side > 0 ? th : -0.35 * th, (le + (te - le) * c) * 1.5];
  };
  for (const side of [1, -1]) {
    const start = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * 2 - 1;
      for (let j = 0; j <= NC; j++) {
        const c = j / NC;
        const p = point(s, c, side);
        const e = 1e-3;
        const a = point(Math.min(s + e, 1), c, side), b = point(Math.max(s - e, -1), c, side);
        const d = point(s, Math.min(c + e, 1), side), f = point(s, Math.max(c - e, 0), side);
        const ds = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dc = [d[0] - f[0], d[1] - f[1], d[2] - f[2]];
        let n = [ds[1] * dc[2] - ds[2] * dc[1], ds[2] * dc[0] - ds[0] * dc[2], ds[0] * dc[1] - ds[1] * dc[0]];
        const len = Math.hypot(...n);
        n = len > 1e-9 ? n.map((x) => x / len) : [0, 1, 0];
        if (Math.sign(n[1]) !== side) n = n.map((x) => -x);
        pos.push(...p); nor.push(...n); span.push(s); top.push(side); uv.push(s, c);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NC; j++) {
        const a = start + i * (NC + 1) + j, b = a + NC + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  // Whip tail: two thin crossed strips.
  for (const upright of [0, 1]) {
    const start = pos.length / 3;
    const SEG = 6;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const z = -1.40 - 3.0 * t, w = 0.05 * (1 - t) + 0.004;
      for (const sgn of [-1, 1]) {
        pos.push(upright ? 0 : sgn * w, upright ? sgn * w : 0, z);
        nor.push(upright ? 1 : 0, upright ? 0 : 1, 0);
        span.push(0); top.push(1); uv.push(0, 1);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  geo.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function createManta(shared, geometry) {
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uFlap: { value: 0 }, uFlapAmp: { value: 0.85 } },
    vertexShader: /* glsl */ `
      attribute float aSpan;
      attribute float aTop;
      attribute vec2 aUV;
      uniform float uFlap, uFlapAmp;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUV;
      varying float vTop;
      void main() {
        float a = abs(aSpan);
        float ph = uFlap - a * 1.3;
        vec3 p = position;
        p.y += uFlapAmp * pow(a, 1.5) * sin(ph);
        p.x *= 1.0 - 0.07 * a * abs(sin(ph));
        // Tilt the normal by the slope of the bent wing.
        float slope = uFlapAmp * (1.5 * sqrt(a) * sin(ph) - 1.3 * pow(a, 1.5) * cos(ph)) / ${MANTA_HALF_SPAN.toFixed(1)} * sign(aSpan);
        vec3 n = normalize(vec3(normal.x - slope * normal.y, normal.y + slope * normal.x, normal.z));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        vUV = aUV;
        vTop = aTop;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUV;
      varying float vTop;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float a = abs(vUV.x), c = vUV.y;
        float n = texture(uNoise, vUV * vec2(1.6, 1.1) + 0.3).r;
        // Top: near black with a pale shoulder patch on each side. Belly: white with dark spots and a dark rim.
        float shoulder = smoothstep(0.10, 0.20, a) * (1.0 - smoothstep(0.42, 0.62, a))
                    * smoothstep(0.10, 0.20, c) * (1.0 - smoothstep(0.34, 0.50, c + a * 0.25));
        vec3 back = mix(vec3(0.022, 0.034, 0.055), vec3(0.24, 0.30, 0.36), shoulder * 0.8);
        float rim = smoothstep(0.55, 0.95, c + a * 0.35) + smoothstep(0.70, 1.0, a);
        float spots = smoothstep(0.62, 0.70, n) * (1.0 - smoothstep(0.5, 0.7, a));
        vec3 belly = mix(vec3(0.70, 0.76, 0.80), vec3(0.06, 0.08, 0.11), clamp(rim * 0.75 + spots * 0.7, 0.0, 1.0));
        vec3 albedo = vTop > 0.0 ? back : belly;
        gl_FragColor = vec4(shadeSurface(albedo, N, V, vWorld, 20.0, 0.10), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.rotation.order = 'YXZ';
  return { mesh, uniforms: material.uniforms };
}

// ---------------------------------------------------------------------------------------------
// Jellyfish: a bell that pulses, with thin tentacles and four frilled arms. Drawn as soft glowing glass.

function jellyGeometry() {
  const pos = [], bell = [], hang = [], around = [], idx = [];
  const RINGS = 9, SIDES = 16;
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j <= SIDES; j++) {
      pos.push(0, 0, 0);
      bell.push(i / RINGS); hang.push(0); around.push((j / SIDES) * TAU);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // position.x holds the half width of a ribbon, position.y its radius from the centre, position.z its length.
  const ribbon = (angle, radius, length, width, segments) => {
    const start = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      for (const sgn of [-1, 1]) {
        pos.push(sgn * width * (1 - 0.7 * t), radius, length);
        bell.push(1); hang.push(Math.max(t, 0.001)); around.push(angle);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (let k = 0; k < 10; k++) ribbon((k / 10) * TAU + 0.2, 0.96, 3.2 + (k % 3) * 0.6, 0.022, 10);
  for (let k = 0; k < 4; k++) ribbon((k / 4) * TAU + 0.7, 0.22, 1.7, 0.16, 8);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aBell', new THREE.Float32BufferAttribute(bell, 1));
  geo.setAttribute('aHang', new THREE.Float32BufferAttribute(hang, 1));
  geo.setAttribute('aAround', new THREE.Float32BufferAttribute(around, 1));
  geo.setIndex(idx);
  return geo;
}

function createJellies(shared, loop, blooms, perBloom) {
  const rand = rng(77);
  const count = blooms * perBloom;
  const place = new Float32Array(count * 4);
  const vary = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    place.set([(rand() - 0.5) * 50, (rand() - 0.5) * 16, (rand() - 0.5) * 50, Math.floor(i / perBloom)], i * 4);
    // phase, bell radius in metres, pulses per loop, tint. The pulse count is even, because the tentacles sway at half the pulse rate.
    vary.set([rand() * TAU, 0.30 + rand() * rand() * 0.6, 2 * Math.round(75 + rand() * 55), rand()], i * 4);
  }
  const geo = jellyGeometry();
  geo.setAttribute('aPlace', new THREE.InstancedBufferAttribute(place, 4));
  geo.setAttribute('aVary', new THREE.InstancedBufferAttribute(vary, 4));
  geo.instanceCount = count;

  const centers = [];
  for (let i = 0; i < blooms; i++) centers.push(new THREE.Vector3());
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uLoop: loop, uBloom: { value: centers } },
    vertexShader: /* glsl */ `
      ${common}
      #define BLOOMS ${blooms}
      attribute float aBell, aHang, aAround;
      attribute vec4 aPlace, aVary;
      uniform float uLoop;
      uniform vec3 uBloom[BLOOMS];
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vRibbon;
      void main() {
        float w = TAU / ${LOOP.toFixed(1)} * uLoop;
        float pulse = w * aVary.z + aVary.x;
        // The bell snaps shut and opens slowly.
        float squeeze = pow(0.5 + 0.5 * sin(pulse), 2.5);
        float cs = cos(aAround), sn = sin(aAround);
        vec3 p, n;
        if (aHang > 0.0) {
          float rimR = position.y * (1.0 - 0.30 * squeeze);
          float t = aHang;
          float sway = 0.16 * t * sin(pulse - t * 5.0 + aAround * 2.0);
          float r = rimR + sway + 0.10 * t * sin(pulse * 0.5 + aAround);
          vec3 tangent = vec3(-sn, 0.0, cs);
          p = vec3(cs * r, -0.02 - t * position.z + 0.10 * squeeze * t, sn * r) + tangent * position.x;
          n = vec3(cs, 0.0, sn);
        } else {
          float phi = aBell * 1.5708;
          float r = sin(phi) * (1.0 - 0.30 * squeeze * aBell * aBell);
          float y = cos(phi) * (0.72 + 0.20 * squeeze);
          p = vec3(cs * r, y, sn * r);
          n = normalize(vec3(cs * sin(phi), cos(phi) * 1.3, sn * sin(phi)));
        }
        // Each pulse pushes the animal up a little, then it sinks back.
        vec3 world = uBloom[int(aPlace.w + 0.5)] + aPlace.xyz + p * aVary.y;
        world.y += 0.22 * aVary.y * sin(pulse - 1.3);
        world.y = min(world.y, -1.5);

        vec3 toEye = cameraPosition - world;
        float dist = length(toEye);
        float depth = -world.y;
        vec3 light = sunAt(depth) * (0.25 + 0.75 * causticAt(world))
                   + vec3(0.03, 0.16, 0.24) * exp(-AMBIENT_LOSS * depth);
        vec3 tint = mix(vec3(0.55, 0.80, 1.00), vec3(1.00, 0.62, 0.78), aVary.w * aVary.w);
        vColor = tint * light * exp(-EXT * dist) * smoothstep(3.0, 9.0, dist);
        vNormal = n;
        vView = toEye / dist;
        vRibbon = aHang;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vRibbon;
      void main() {
        // Glass looks brightest where the surface turns away from the eye.
        float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float glow = vRibbon > 0.0 ? 0.20 * (1.0 - 0.75 * vRibbon) : 0.10 + 0.55 * edge;
        gl_FragColor = vec4(vColor * glow, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, centers };
}

// ---------------------------------------------------------------------------------------------

export function createCreatures(shared, whaleMesh, prey) {
  const rand = rng(1234);
  const range = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const loop = { value: 0 };

  // Tuna: fast packs that come from behind, weave, and overtake the whale.
  const tunaLook = {
    back: [0.035, 0.075, 0.150], belly: [0.62, 0.68, 0.72], fin: [0.30, 0.27, 0.10],
    stripes: 0, flash: 1.1, beatAmp: 0.055,
  };
  const tuna = [0, 1].map((k) => {
    const slots = [];
    for (let i = 0; i < 34; i++) {
      const z = range(-12, 12);
      const taper = 1 - Math.abs(z) / 16;
      slots.push({ x: range(-4.5, 4.5) * taper, y: range(-1.8, 1.8) * taper, z, size: range(1.1, 1.8), wander: 0.55 });
    }
    const pack = createPack(shared, loop, { slots, look: tunaLook, seed: 500 + k });
    group.add(pack.mesh);
    return { ...pack, pos: new THREE.Vector3(0, -20, 9999), heading: 0, speed: 7, wait: 6 + k * 38, beat: 0, weave: range(0, TAU), target: null };
  });

  // Pilot fish: small striped fish that hold station around the head of the whale.
  const escortFrame = new THREE.Group();
  escortFrame.rotation.order = 'YXZ';
  group.add(escortFrame);
  const escortSlots = [];
  for (let i = 0; i < 16; i++) {
    if (i < 6) {
      // In front of the snout.
      const a = range(0, TAU), r = range(0.4, 1.5);
      escortSlots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 - 0.2, z: range(12.0, 14.5), size: range(0.38, 0.55), wander: 0.22 });
    } else {
      // Beside and below the head and chest, clear of the skin.
      const a = range(0.55 * Math.PI, 1.45 * Math.PI), r = range(2.9, 3.7);
      escortSlots.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, z: range(2.5, 9.0), size: range(0.38, 0.55), wander: 0.28 });
    }
  }
  const escorts = createPack(shared, loop, {
    slots: escortSlots, seed: 901,
    look: { back: [0.10, 0.17, 0.26], belly: [0.55, 0.64, 0.70], fin: [0.06, 0.09, 0.14], stripes: 3.2, flash: 0.5, beatAmp: 0.075 },
  });
  escortFrame.add(escorts.mesh);
  let escortBeat = 0;

  // Manta rays: slow gliders that the whale catches up with and passes.
  const mantaGeo = mantaGeometry();
  const mantas = [0, 1, 2].map((k) => {
    const m = createManta(shared, mantaGeo);
    group.add(m.mesh);
    return { ...m, flap: range(0, TAU), speed: 1.9, turn: range(0, TAU), rate: range(0.035, 0.06), heading: 0, scale: 1 };
  });
  const placeManta = (m, z, buddy) => {
    if (buddy) {
      m.mesh.position.copy(buddy.mesh.position).add(new THREE.Vector3(range(4, 7) * (rand() < 0.5 ? -1 : 1), range(-2, 2), range(-7, -4)));
      m.turn = buddy.turn + 0.3;
      m.rate = buddy.rate;
    } else {
      m.mesh.position.set(range(13, 48) * (rand() < 0.5 ? -1 : 1), range(-40, -9), z);
    }
    m.speed = range(1.5, 2.2);
    m.scale = range(0.85, 1.2);
    m.mesh.scale.setScalar(m.scale);
  };
  placeManta(mantas[0], 55);
  placeManta(mantas[1], 60, mantas[0]);
  placeManta(mantas[2], 150);

  // Jellyfish: loose blooms that hang in the water while the whale swims past.
  const BLOOMS = 2;
  const jellies = createJellies(shared, loop, BLOOMS, 42);
  group.add(jellies.mesh);
  const placeBloom = (i, z) => jellies.centers[i].set(range(16, 42) * (rand() < 0.5 ? -1 : 1), range(-30, -13), z);
  placeBloom(0, 95);
  placeBloom(1, 230);

  const launchTuna = (t, whaleY) => {
    const side = rand() < 0.5 ? -1 : 1;
    t.pos.set(side * range(11, 34), 0, range(-150, -125));
    t.pos.y = THREE.MathUtils.clamp(whaleY + range(-9, 7), -40, -7);
    t.heading = -side * range(0, 0.10);
    t.speed = range(6.4, 8.6);
    // Pick a bait ball that is still ahead and hunt it.
    const ahead = prey.filter((p) => p.z > -70 && p.z < 170);
    t.target = ahead.length ? ahead[Math.floor(rand() * ahead.length)] : null;
  };

  // Animals that small fish flee from, as spheres. An absent pack is parked far away.
  const threats = [];
  for (let i = 0; i < tuna.length * 2; i++) threats.push({ x: 0, y: 9999, z: 0, r: 6.5 });
  for (let i = 0; i < mantas.length; i++) threats.push({ x: 0, y: 9999, z: 0, r: 4.5 });

  // Points a test view can look at, chosen with ?focus=tuna and so on.
  const targets = {
    tuna: () => tuna[0].pos,
    manta: () => mantas[0].mesh.position,
    jelly: () => jellies.centers[0],
  };

  return {
    group,
    targets,
    threats,
    // `velocity` is the velocity of the whale. Everything else moves against it.
    update(time, dt, velocity) {
      loop.value = time % LOOP;
      const whaleY = whaleMesh.position.y;

      for (const t of tuna) {
        if (t.wait > 0) {
          t.wait -= dt;
          if (t.wait <= 0) launchTuna(t, whaleY);
          t.mesh.visible = false;
          continue;
        }
        t.mesh.visible = true;
        t.weave += dt * 0.21;
        let hunting = 0;
        if (t.target) {
          const dx = t.target.x - t.pos.x, dz = t.target.z - t.pos.z;
          if (dz > 3) {
            // Turn toward the bait ball, at a limited rate, and match its depth.
            const want = Math.atan2(dx, dz);
            t.heading += THREE.MathUtils.clamp(want - t.heading, -0.4 * dt, 0.4 * dt);
            t.pos.y += THREE.MathUtils.clamp(t.target.y - t.pos.y, -1.6 * dt, 1.6 * dt);
            hunting = 1 - Math.min(Math.hypot(dx, dz) / 60, 1);
          } else {
            t.target = null;
          }
        }
        // A pack weaves while it travels and runs straight when it attacks.
        const yaw = t.heading + (0.13 * Math.sin(t.weave) + 0.05 * Math.sin(t.weave * 2.7)) * (1 - hunting);
        // Steer around the whale instead of through it.
        const near = Math.max(0, 1 - Math.abs(t.pos.x) / 12) * Math.max(0, 1 - Math.abs(t.pos.z) / 34);
        t.heading += Math.sign(t.pos.x || 1) * near * 0.5 * dt;
        const climb = 0.16 * Math.sin(t.weave * 0.6 + 1) * (1 - hunting);
        t.pos.x += (Math.sin(yaw) * t.speed - velocity.x) * dt;
        t.pos.z += (Math.cos(yaw) * t.speed - velocity.z) * dt;
        t.pos.y = Math.min(t.pos.y + climb * t.speed * 0.25 * dt, -6);
        t.mesh.position.copy(t.pos);
        t.mesh.rotation.set(-climb * 0.25, yaw, 0);
        t.beat = (t.beat + dt * TAU * 2.6) % TAU;
        t.uniforms.uBeat.value = t.beat;
        if (t.pos.z > 170 || Math.abs(t.pos.x) > 170) t.wait = range(25, 70);
      }

      escortFrame.position.copy(whaleMesh.position);
      escortFrame.rotation.copy(whaleMesh.rotation);
      escortBeat = (escortBeat + dt * TAU * 3.1) % TAU;
      escorts.uniforms.uBeat.value = escortBeat;

      mantas.forEach((m, k) => {
        m.turn += dt * m.rate;
        const yaw = 0.55 * Math.sin(m.turn) + 0.2 * Math.sin(m.turn * 0.37 + k);
        const yawRate = (0.55 * Math.cos(m.turn) + 0.2 * 0.37 * Math.cos(m.turn * 0.37 + k)) * m.rate;
        const climb = 0.18 * Math.sin(m.turn * 0.8 + k * 2);
        const p = m.mesh.position;
        p.x += (Math.sin(yaw) * m.speed - velocity.x) * dt;
        p.z += (Math.cos(yaw) * m.speed - velocity.z) * dt;
        p.y = THREE.MathUtils.clamp(p.y + climb * m.speed * dt, -46, -6);
        // A manta rolls into its turns.
        m.mesh.rotation.set(-climb, yaw, -yawRate * 9);
        // Wings beat faster on the way up than on a level glide.
        m.flap = (m.flap + dt * TAU * (0.20 + 0.10 * Math.max(climb, 0) / 0.18)) % TAU;
        m.uniforms.uFlap.value = m.flap;
        if (p.z < -130 || Math.abs(p.x) > 150) {
          const lead = k === 1 ? mantas[0] : null;
          if (lead && lead.mesh.position.z > 60) placeManta(m, 0, lead);
          else placeManta(m, range(130, 190));
        }
      });

      tuna.forEach((t, k) => {
        for (let end = 0; end < 2; end++) {
          const spot = threats[k * 2 + end];
          const along = end ? 6 : -6;
          spot.x = t.pos.x + Math.sin(t.heading) * along;
          spot.y = t.wait > 0 ? 9999 : t.pos.y;
          spot.z = t.pos.z + Math.cos(t.heading) * along;
        }
      });
      mantas.forEach((m, k) => {
        const spot = threats[tuna.length * 2 + k];
        spot.x = m.mesh.position.x; spot.y = m.mesh.position.y; spot.z = m.mesh.position.z;
      });

      for (let i = 0; i < BLOOMS; i++) {
        const c = jellies.centers[i];
        c.x -= velocity.x * dt;
        c.z -= velocity.z * dt;
        if (c.z < -150 || Math.abs(c.x) > 150) placeBloom(i, range(170, 300));
      }
    },
  };
}
