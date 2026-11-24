import * as THREE from 'three';
import { common } from './glsl.js';
import { TAU, clamp, geometry, mesh, gridIndices, cross } from './util.js';

// Manta rays: flat diamonds with wings that flap as a wave from the body to the tips.

const HALF_SPAN = 2.7; // metres

// Wing surface. s runs across the span from -1 to 1, c along the chord from the leading edge to the trailing edge.
function wingPoint(s, c, side) {
  const a = Math.abs(s);
  // The bump near the middle of the leading edge makes the two head fins.
  const le = 0.95 - 1.05 * Math.pow(a, 1.25) + 0.26 * Math.exp(-Math.pow((a - 0.13) / 0.05, 2));
  const te = -0.95 + 0.85 * Math.pow(a, 0.75);
  const thick = 0.36 * Math.pow(1 - a, 1.6) * Math.pow(Math.sin(Math.PI * c), 0.6);
  return [s * HALF_SPAN, side > 0 ? thick : -0.35 * thick, (le + (te - le) * c) * 1.5];
}

function mantaGeometry() {
  const pos = [], nor = [], span = [], top = [], uv = [], idx = [];
  const NS = 30, NC = 12, e = 1e-3;
  // The back, then the belly.
  for (const side of [1, -1]) {
    idx.push(...gridIndices(NS, NC, pos.length / 3));
    for (let i = 0; i <= NS; i++) {
      for (let j = 0; j <= NC; j++) {
        const s = (i / NS) * 2 - 1, c = j / NC;
        const n = cross(wingPoint(Math.min(s + e, 1), c, side), wingPoint(Math.max(s - e, -1), c, side),
          wingPoint(s, Math.min(c + e, 1), side), wingPoint(s, Math.max(c - e, 0), side));
        // The normal points up on the back and down on the belly.
        const scale = n[3] > 1e-9 ? (Math.sign(n[1]) === side ? 1 : -1) / n[3] : 0;
        pos.push(...wingPoint(s, c, side));
        nor.push(...(scale ? [n[0] * scale, n[1] * scale, n[2] * scale] : [0, side, 0]));
        span.push(s); top.push(side); uv.push(s, c);
      }
    }
  }
  // Whip tail: two thin crossed strips.
  const SEGMENTS = 6;
  for (const upright of [0, 1]) {
    idx.push(...gridIndices(SEGMENTS, 1, pos.length / 3));
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS, w = 0.05 * (1 - t) + 0.004;
      for (const sign of [-1, 1]) {
        pos.push(upright ? 0 : sign * w, upright ? sign * w : 0, -1.40 - 3.0 * t);
        nor.push(upright ? 1 : 0, upright ? 0 : 1, 0);
        span.push(0); top.push(1); uv.push(0, 1);
      }
    }
  }
  return geometry({ position: [pos, 3], normal: [nor, 3], aSpan: [span, 1], aTop: [top, 1], aUV: [uv, 2] }, idx);
}

function createManta(shared, geo) {
  const uniforms = { ...shared, uFlap: { value: 0 } };
  const manta = mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSpan;
      attribute float aTop;
      attribute vec2 aUV;
      uniform float uFlap;
      const float FLAP = 0.85; // metres of wing travel at the tip
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUV;
      varying float vTop;
      void main() {
        float a = abs(aSpan);
        float ph = uFlap - a * 1.3;
        vec3 p = position;
        p.y += FLAP * pow(a, 1.5) * sin(ph);
        p.x *= 1.0 - 0.07 * a * abs(sin(ph));
        // Tilt the normal by the slope of the bent wing.
        float slope = FLAP * (1.5 * sqrt(a) * sin(ph) - 1.3 * pow(a, 1.5) * cos(ph)) / ${HALF_SPAN.toFixed(1)} * sign(aSpan);
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
        // Back: near black with a pale shoulder patch on each side. Belly: white with dark spots and a dark rim.
        float shoulder = smoothstep(0.10, 0.20, a) * (1.0 - smoothstep(0.42, 0.62, a))
                       * smoothstep(0.10, 0.20, c) * (1.0 - smoothstep(0.34, 0.50, c + a * 0.25));
        vec3 back = mix(vec3(0.022, 0.034, 0.055), vec3(0.24, 0.30, 0.36), shoulder * 0.8);
        float rim = smoothstep(0.55, 0.95, c + a * 0.35) + smoothstep(0.70, 1.0, a);
        float spots = smoothstep(0.62, 0.70, n) * (1.0 - smoothstep(0.5, 0.7, a));
        vec3 belly = mix(vec3(0.70, 0.76, 0.80), vec3(0.06, 0.08, 0.11), clamp(rim * 0.75 + spots * 0.7, 0.0, 1.0));
        gl_FragColor = vec4(shadeSurface(vTop > 0.0 ? back : belly, N, V, vWorld, 20.0, 0.10), 1.0);
      }
    `,
  }));
  return { mesh: manta, flap: uniforms.uFlap };
}

// Three slow gliders that the whale catches up with and passes. The second one keeps company with the first.
export function createMantas(shared, rand) {
  const geo = mantaGeometry();
  const mantas = [0, 1, 2].map(() => ({
    ...createManta(shared, geo),
    flapStart: rand.range(0, TAU),
    speed: 1.9,
    turn: rand.range(0, TAU),      // phase of the slow turns and climbs
    rate: rand.range(0.035, 0.06), // how fast that phase runs
  }));
  for (const m of mantas) m.flap.value = m.flapStart;

  // Puts a manta at distance z ahead, or beside and behind a `buddy`.
  const place = (m, z, buddy) => {
    if (buddy) {
      m.mesh.position.copy(buddy.mesh.position).add(new THREE.Vector3(rand.range(4, 7) * rand.sign(), rand.range(-2, 2), rand.range(-7, -4)));
      m.turn = buddy.turn + 0.3;
      m.rate = buddy.rate;
    } else {
      m.mesh.position.set(rand.range(13, 48) * rand.sign(), rand.range(-40, -9), z);
    }
    m.speed = rand.range(1.5, 2.2);
    m.mesh.scale.setScalar(rand.range(0.85, 1.2));
  };
  place(mantas[0], 55);
  place(mantas[1], 60, mantas[0]);
  place(mantas[2], 150);

  // Small fish flee from one sphere per manta.
  const threats = mantas.map((m) => ({ x: 0, y: 0, z: 0, r: 4.5, from: m.mesh.position }));

  return {
    group: new THREE.Group().add(...mantas.map((m) => m.mesh)),
    threats,
    target: () => mantas[0].mesh.position,
    // `velocity` is the velocity of the whale. Everything else moves against it.
    update(dt, velocity) {
      mantas.forEach((m, k) => {
        m.turn += dt * m.rate;
        const yaw = 0.55 * Math.sin(m.turn) + 0.2 * Math.sin(m.turn * 0.37 + k);
        const yawRate = (0.55 * Math.cos(m.turn) + 0.2 * 0.37 * Math.cos(m.turn * 0.37 + k)) * m.rate;
        const climb = 0.18 * Math.sin(m.turn * 0.8 + k * 2);
        const p = m.mesh.position;
        p.x += (Math.sin(yaw) * m.speed - velocity.x) * dt;
        p.z += (Math.cos(yaw) * m.speed - velocity.z) * dt;
        p.y = clamp(p.y + climb * m.speed * dt, -46, -6);
        m.mesh.rotation.set(-climb, yaw, -yawRate * 9); // a manta rolls into its turns
        // Wings beat faster on the way up than on a level glide.
        m.flap.value = (m.flap.value + dt * TAU * (0.20 + 0.10 * Math.max(climb, 0) / 0.18)) % TAU;
        if (p.z < -130 || Math.abs(p.x) > 150) {
          // The second manta rejoins the first, if the first is still well ahead.
          if (k === 1 && mantas[0].mesh.position.z > 60) place(m, 0, mantas[0]);
          else place(m, rand.range(130, 190));
        }
      });
      for (const t of threats) { t.x = t.from.x; t.y = t.from.y; t.z = t.from.z; }
    },
  };
}
