import * as THREE from 'three';
import { common, facing } from './glsl.js';
import { TAU, rng, clamp, geometry, mesh, gridIndices } from './util.js';

// Pack fish: tuna and pilot fish share one body shape and one shader. Each fish holds a slot in the frame
// of the pack mesh and wanders around it.

// A fish about one unit long that faces +Z: smooth body, crescent tail, dorsal fin and two pectoral fins.
function spindleGeometry() {
  const pos = [], nor = [], fin = [];
  const RINGS = 11, SIDES = 10, SLIM = 0.62; // width of the body as a share of its height
  const halfHeight = (t) => 0.135 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85) + 0.004;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS, h = halfHeight(t);
    const slope = (halfHeight(Math.min(t + 0.01, 1)) - halfHeight(Math.max(t - 0.01, 0))) / (0.02 * 0.92);
    for (let j = 0; j <= SIDES; j++) {
      const a = (j / SIDES) * TAU, cx = Math.sin(a), cy = Math.cos(a);
      const n = new THREE.Vector3(cx / SLIM, cy, slope).normalize();
      pos.push(h * SLIM * cx, h * cy, 0.5 - 0.92 * t);
      nor.push(n.x, n.y, n.z);
      fin.push(0);
    }
  }
  const idx = gridIndices(RINGS, SIDES);
  // A flat fin: a fan of triangles around its first point.
  const flat = (points, normal) => {
    const start = pos.length / 3;
    for (const p of points) { pos.push(...p); nor.push(...normal); fin.push(1); }
    for (let i = 1; i < points.length - 1; i++) idx.push(start, start + i, start + i + 1);
  };
  flat([[0, 0, -0.38], [0, 0.24, -0.66], [0, 0.03, -0.50], [0, -0.03, -0.50], [0, -0.24, -0.66]], [1, 0, 0]); // tail
  flat([[0, 0.12, 0.08], [0, 0.20, -0.05], [0, 0.11, -0.13]], [1, 0, 0]);                                    // dorsal
  flat([[0.07, -0.04, 0.16], [0.20, -0.13, -0.04], [0.075, -0.05, 0.05]], [0.3, 0.95, 0]);                   // pectorals
  flat([[-0.07, -0.04, 0.16], [-0.20, -0.13, -0.04], [-0.075, -0.05, 0.05]], [-0.3, 0.95, 0]);
  return geometry({ position: [pos, 3], normal: [nor, 3], aFin: [fin, 1] }, idx, THREE.InstancedBufferGeometry);
}

// `slots` lists the fish as { x, y, z, size, wander }. `look` sets the colours and the tail beat.
function createPack(shared, { slots, look, seed }) {
  const rand = rng(seed);
  const geo = spindleGeometry();
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Float32Array(slots.flatMap((s) => [s.x, s.y, s.z])), 3));
  // phase, scale (about the length in metres), wander distance in metres, whole wander cycles per loop
  geo.setAttribute('aVary', new THREE.InstancedBufferAttribute(new Float32Array(
    slots.flatMap((s) => [rand() * TAU, s.size, s.wander, Math.round(34 + rand() * 40)])), 4));
  geo.instanceCount = slots.length;

  const uniforms = {
    ...shared,
    uBeat: { value: 0 },
    uBeatAmp: { value: look.beatAmp },
    uBack: { value: new THREE.Color(...look.back) },
    uBelly: { value: new THREE.Color(...look.belly) },
    uFin: { value: new THREE.Color(...look.fin) },
    uStripes: { value: look.stripes },
    uFlash: { value: look.flash },
  };
  const pack = mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      ${common}
      attribute vec3 aSlot;
      attribute vec4 aVary;
      attribute float aFin;
      uniform float uBeat, uBeatAmp;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vBody;
      varying float vFin;
      void main() {
        float w = TAU / LOOP * uLoop;
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
        ${facing}
        // Dark back, pale belly. The split sits a little above the middle of the side.
        float side = smoothstep(-0.02, 0.07, vBody.y);
        vec3 albedo = mix(uBelly, uBack, side);
        float bands = smoothstep(0.15, 0.55, sin(vBody.z * TAU * uStripes + 1.2));
        albedo = mix(albedo, uBack * 0.35, bands * step(0.5, uStripes) * 0.85);
        albedo = mix(albedo, uFin, vFin);
        gl_FragColor = vec4(shadeSurface(albedo, N, V, vWorld, 30.0, uFlash * (1.0 - side * 0.7)), 1.0);
      }
    `,
  }));
  return { mesh: pack, beat: uniforms.uBeat };
}

// Tuna: fast packs that come from behind, weave, hunt a bait ball, and overtake the whale.
// `prey` lists the centres of the bait balls.
export function createTuna(shared, rand, prey) {
  const look = {
    back: [0.035, 0.075, 0.150], belly: [0.62, 0.68, 0.72], fin: [0.30, 0.27, 0.10],
    stripes: 0, flash: 1.1, beatAmp: 0.055,
  };
  const packs = [0, 1].map((k) => {
    const slots = [];
    for (let i = 0; i < 34; i++) {
      // A long cloud of fish that narrows toward both ends.
      const z = rand.range(-12, 12), taper = 1 - Math.abs(z) / 16;
      slots.push({ x: rand.range(-4.5, 4.5) * taper, y: rand.range(-1.8, 1.8) * taper, z, size: rand.range(1.1, 1.8), wander: 0.55 });
    }
    return {
      ...createPack(shared, { slots, look, seed: 500 + k }),
      pos: new THREE.Vector3(0, -20, 9999), heading: 0, speed: 7,
      wait: 6 + k * 38,     // seconds until the pack sets off
      weave: rand.range(0, TAU),
      target: null,         // the bait ball that the pack hunts
    };
  });
  // Small fish flee from two spheres per pack. A pack that waits is parked far away.
  const threats = packs.flatMap(() => [{ x: 0, y: 9999, z: 0, r: 6.5 }, { x: 0, y: 9999, z: 0, r: 6.5 }]);

  const launch = (t, whaleY) => {
    const side = rand.sign();
    t.pos.set(side * rand.range(11, 34), 0, rand.range(-150, -125));
    t.pos.y = clamp(whaleY + rand.range(-9, 7), -40, -7);
    t.heading = -side * rand.range(0, 0.10);
    t.speed = rand.range(6.4, 8.6);
    const ahead = prey.filter((p) => p.z > -70 && p.z < 170);
    t.target = ahead.length ? ahead[Math.floor(rand() * ahead.length)] : null;
  };

  function swim(t, dt, velocity, whaleY) {
    t.mesh.visible = t.wait <= 0;
    if (t.wait > 0) {
      t.wait -= dt;
      if (t.wait <= 0) launch(t, whaleY);
      return;
    }
    t.weave += dt * 0.21;
    let hunting = 0; // 0 far from the target .. 1 on it
    if (t.target) {
      const dx = t.target.x - t.pos.x, dz = t.target.z - t.pos.z;
      if (dz > 3) {
        // Turn toward the bait ball, at a limited rate, and match its depth.
        t.heading += clamp(Math.atan2(dx, dz) - t.heading, -0.4 * dt, 0.4 * dt);
        t.pos.y += clamp(t.target.y - t.pos.y, -1.6 * dt, 1.6 * dt);
        hunting = 1 - Math.min(Math.hypot(dx, dz) / 60, 1);
      } else {
        t.target = null; // the pack is through
      }
    }
    // A pack weaves while it travels and runs straight when it attacks.
    const yaw = t.heading + (0.13 * Math.sin(t.weave) + 0.05 * Math.sin(t.weave * 2.7)) * (1 - hunting);
    const climb = 0.16 * Math.sin(t.weave * 0.6 + 1) * (1 - hunting);
    // Steer around the whale instead of through it.
    const near = Math.max(0, 1 - Math.abs(t.pos.x) / 12) * Math.max(0, 1 - Math.abs(t.pos.z) / 34);
    t.heading += Math.sign(t.pos.x || 1) * near * 0.5 * dt;
    t.pos.x += (Math.sin(yaw) * t.speed - velocity.x) * dt;
    t.pos.z += (Math.cos(yaw) * t.speed - velocity.z) * dt;
    t.pos.y = Math.min(t.pos.y + climb * t.speed * 0.25 * dt, -6);
    t.mesh.position.copy(t.pos);
    t.mesh.rotation.set(-climb * 0.25, yaw, 0);
    t.beat.value = (t.beat.value + dt * TAU * 2.6) % TAU;
    if (t.pos.z > 170 || Math.abs(t.pos.x) > 170) t.wait = rand.range(25, 70);
  }

  return {
    group: new THREE.Group().add(...packs.map((t) => t.mesh)),
    threats,
    target: () => packs[0].pos,
    // `velocity` is the velocity of the whale. Everything else moves against it.
    update(dt, velocity, whaleY) {
      packs.forEach((t, k) => {
        swim(t, dt, velocity, whaleY);
        for (let end = 0; end < 2; end++) {
          const spot = threats[k * 2 + end], along = end ? 6 : -6;
          spot.x = t.pos.x + Math.sin(t.heading) * along;
          spot.y = t.wait > 0 ? 9999 : t.pos.y;
          spot.z = t.pos.z + Math.cos(t.heading) * along;
        }
      });
    },
  };
}

// Pilot fish: small striped fish that hold station around the head of the whale.
export function createPilotFish(shared, rand, whaleMesh) {
  const slots = [];
  for (let i = 0; i < 16; i++) {
    if (i < 6) {
      // In front of the snout.
      const a = rand.range(0, TAU), r = rand.range(0.4, 1.5);
      slots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 - 0.2, z: rand.range(12.0, 14.5), size: rand.range(0.38, 0.55), wander: 0.22 });
    } else {
      // Beside and below the head and chest, clear of the skin.
      const a = rand.range(0.55 * Math.PI, 1.45 * Math.PI), r = rand.range(2.9, 3.7);
      slots.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, z: rand.range(2.5, 9.0), size: rand.range(0.38, 0.55), wander: 0.28 });
    }
  }
  const pack = createPack(shared, {
    slots, seed: 901,
    look: { back: [0.10, 0.17, 0.26], belly: [0.55, 0.64, 0.70], fin: [0.06, 0.09, 0.14], stripes: 3.2, flash: 0.5, beatAmp: 0.075 },
  });
  return {
    group: pack.mesh,
    update(dt) {
      // The pack frame is the whale without its swim bend. The head bends little, so the fish stay clear of it.
      pack.mesh.position.copy(whaleMesh.position);
      pack.mesh.rotation.copy(whaleMesh.rotation);
      pack.beat.value = (pack.beat.value + dt * TAU * 3.1) % TAU;
    },
  };
}
