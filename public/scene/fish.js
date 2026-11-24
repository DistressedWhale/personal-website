import * as THREE from 'three';
import { common, facing } from './glsl.js';
import { TAU, rng, clamp, geometry, mesh } from './util.js';

// Sardine schools, simulated as boids: keep clear, match heading, stay together. Each school adds one rule
// for its pattern, and every fish flees from large animals.
//
//   ball    a bait ball that turns about its upright axis
//   roam    a loose school that chases a wandering point
//   split   like roam, with two points that drift apart and back, so the school divides and rejoins
//   stream  a long ribbon on a steady course

const SCHOOLS = [
  { kind: 'ball', count: 640 },
  { kind: 'ball', count: 560 },
  { kind: 'roam', count: 620 },
  { kind: 'split', count: 560 },
  { kind: 'stream', count: 640 },
];
const TOTAL = SCHOOLS.reduce((n, s) => n + s.count, 0);

const SEE = 1.35;       // metres. A fish reacts to neighbours inside this distance.
const CLEAR = 0.62;     // metres. Closer than this, neighbours push apart.
const ENOUGH = 26;      // a fish stops counting neighbours here, which bounds the cost of a dense clump
const MAX_FORCE = 18;   // metres per second squared
const MAX_STEP = 1 / 30; // seconds. A longer frame takes a step of this size, so the rules stay stable.
const BUCKETS = 4096;   // size of the hash grid, a power of two
const WHALE_SPOTS = [8, 0.5, -8]; // the whale counts as three spheres, at these distances along its body

// Offsets of the 27 grid cells around a fish: its own cell first, then opposite pairs.
const NEIGHBOUR_CELLS = [0, 0, 0];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x * 9 + y * 3 + z > 0) NEIGHBOUR_CELLS.push(x, y, z, -x, -y, -z);
}

// A flat diamond body with a tail fin, in flat-shaded triangles. The fish faces +Z.
function sardineGeometry() {
  const nose = [0, 0, 0.5], top = [0, 0.15, 0.08], bot = [0, -0.13, 0.08];
  const left = [0.055, 0, 0.1], right = [-0.055, 0, 0.1], stock = [0, 0, -0.32];
  const tailTop = [0, 0.16, -0.56], tailBot = [0, -0.16, -0.56];
  const triangles = [
    [nose, left, top], [nose, top, right], [nose, bot, left], [nose, right, bot],
    [stock, top, left], [stock, right, top], [stock, left, bot], [stock, bot, right],
    [stock, tailBot, tailTop],
  ];
  const pos = [], nor = [];
  for (const [a, b, c] of triangles) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    pos.push(...a, ...b, ...c);
    nor.push(...n, ...n, ...n);
  }
  return geometry({ position: [pos, 3], normal: [nor, 3] }, null, THREE.InstancedBufferGeometry);
}

const vertexShader = /* glsl */ `
  #define SCHOOLS ${SCHOOLS.length}
  attribute vec3 aPos;
  attribute vec3 aVel;
  attribute vec3 aInfo; // school index, scale, tail phase
  uniform vec3 uAnchor[SCHOOLS];
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 centre = uAnchor[int(aInfo.x + 0.5)] + aPos;
    vec3 fwd = aVel / max(length(aVel), 0.001);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd) + vec3(0.0001, 0.0, 0.0));
    vec3 up = cross(fwd, right);

    vec3 p = position;
    float beat = sin(aInfo.z - p.z * 5.0);
    p.x += beat * 0.10 * (0.55 - p.z);
    // A fish that comes close to the camera shrinks away, so it never fills the screen.
    p *= aInfo.y * smoothstep(5.0, 11.0, distance(centre, cameraPosition));
    vec3 n = normal;
    n.z += beat * 0.25 * n.x;

    vWorld = centre + right * p.x + up * p.y + fwd * p.z;
    vNormal = normalize(right * n.x + up * n.y + fwd * n.z);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${common}
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    ${facing}
    float depth = -vWorld.y;
    // Silver sides with a dark back. The sardines have their own lighting, with a strong flash and no rim.
    vec3 albedo = mix(vec3(0.50, 0.62, 0.68), vec3(0.05, 0.10, 0.16), smoothstep(0.2, 0.9, N.y));
    float ndl = dot(N, uSunWater);
    float caustic = causticAt(vWorld);
    vec3 sun = sunAt(depth) * clamp((ndl + 0.4) / 1.4, 0.0, 1.0) * mix(1.0, caustic, 0.7);
    vec3 ambient = mix(vec3(0.012, 0.07, 0.12), vec3(0.06, 0.33, 0.47), N.y * 0.5 + 0.5)
                 * exp(-AMBIENT_LOSS * depth);
    vec3 col = albedo * (sun * 1.4 + ambient * 1.6);
    // Scales flash when a side catches the sun.
    vec3 H = normalize(uSunWater + V);
    col += sunAt(depth) * pow(max(dot(N, H), 0.0), 24.0) * 1.6 * (0.4 + caustic);
    gl_FragColor = vec4(fogged(col, vWorld), 1.0);
  }
`;

export function createFish(shared) {
  const rand = rng(41);

  // Per fish, three numbers each. Positions are relative to the anchor of the school. Velocities are relative to the water.
  const pos = new Float32Array(TOTAL * 3);
  const vel = new Float32Array(TOTAL * 3);
  const info = new Float32Array(TOTAL * 3);   // school index, scale (about the length in metres), tail phase
  const social = new Float32Array(TOTAL * 3); // force from the neighbour rules, refreshed every second frame
  const panic = new Float32Array(TOTAL);      // 0 calm .. 1 fleeing

  // ------------------------------------------------------------------------------------------- schools
  let first = 0;
  const schools = SCHOOLS.map(({ kind, count }, index) => {
    const s = {
      kind, index, first, end: first + count,
      anchor: new THREE.Vector3(), // centre of the school, relative to the whale's start
      drift: new THREE.Vector3(),  // velocity of the anchor through the water
      spin: rand.sign(), breathe: rand.range(0, TAU), heading: 0, wanderPhase: rand.range(0, TAU),
    };
    if (kind === 'ball') { s.radius = 0.62 * Math.cbrt(count); s.cruise = 1.5; }
    if (kind === 'roam' || kind === 'split') {
      s.cruise = 2.5;
      s.points = kind === 'split' ? [new THREE.Vector3(), new THREE.Vector3()] : [new THREE.Vector3()];
      s.phase = [0, 1, 2, 3, 4, 5, 6].map(() => rand.range(0, TAU));
    }
    if (kind === 'stream') { s.radius = 2.8; s.half = 15; s.cruise = 4.4; }

    // Start each fish inside its pattern, already moving the right way.
    for (let i = first; i < s.end; i++) {
      let x, y, z, vx = 0, vz = 0;
      if (kind === 'stream') {
        const r = s.radius * Math.sqrt(rand()), b = rand() * TAU;
        x = r * Math.cos(b); y = r * Math.sin(b) * 0.7; z = rand.range(-s.half, s.half);
        vz = 1;
      } else {
        // A random point in a sphere, flattened a little for the roaming schools.
        const ball = kind === 'ball';
        const r = (ball ? s.radius : 5) * Math.cbrt(rand()), a = rand() * TAU, c = rand() * 2 - 1, sn = Math.sqrt(1 - c * c);
        x = r * sn * Math.cos(a); y = r * c * (ball ? 1 : 0.6); z = r * sn * Math.sin(a);
        if (ball) { vx = -Math.sin(a) * s.spin; vz = Math.cos(a) * s.spin; }
        else { vx = Math.cos(s.wanderPhase); vz = Math.sin(s.wanderPhase); }
      }
      pos.set([x, y, z], i * 3);
      vel.set([vx * s.cruise, 0, vz * s.cruise], i * 3);
      info.set([index, 0.27 + rand() * 0.15, rand() * TAU], i * 3);
    }
    first = s.end;
    return s;
  });

  // Puts a school in the water: spread around the whale at the start, later out of sight.
  const place = (s, atStart) => {
    const side = rand.sign();
    if (s.kind === 'stream') {
      // A stream travels faster than the whale. It starts behind and crosses the path at a shallow angle.
      s.anchor.set(side * rand.range(10, 40), -rand.range(9, 32), atStart ? rand.range(-60, 10) : rand.range(-150, -120));
      s.heading = -side * rand.range(0.02, 0.16);
    } else {
      s.anchor.set(side * rand.range(0, 42), -rand.range(9, 36), atStart ? rand.range(-30, 150) : rand.range(125, 200));
      s.drift.set(rand.range(-0.3, 0.3), 0, rand.range(-0.3, 0.4));
    }
  };
  for (const s of schools) place(s, true);

  // ------------------------------------------------------------------------------------------- mesh
  const geo = sardineGeometry();
  const attributes = { aPos: pos, aVel: vel, aInfo: info };
  for (const [name, values] of Object.entries(attributes)) {
    attributes[name] = new THREE.InstancedBufferAttribute(values, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attributes[name]);
  }
  geo.instanceCount = TOTAL;
  const fishMesh = mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uAnchor: { value: schools.map((s) => s.anchor) } },
    vertexShader,
    fragmentShader,
  }));

  // ------------------------------------------------------------------------------------------- neighbour rules
  // A hash grid finds the neighbours, so the cost grows with the fish count, not its square.
  const bucketOf = new Uint16Array(TOTAL);
  const bucketStart = new Uint32Array(BUCKETS + 1); // fish of bucket b are order[bucketStart[b] .. bucketStart[b + 1])
  const bucketFill = new Uint32Array(BUCKETS);
  const order = new Uint32Array(TOTAL);
  const scanned = new Int32Array(27);
  const bucket = (ix, iy, iz) => (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (BUCKETS - 1);
  const stats = { pairs: 0, repaired: 0 }; // counters for the performance test, which reads them through window.__scene
  let frame = 0;

  function socialForces(s) {
    // Sort the fish of this school by grid cell.
    bucketStart.fill(0);
    for (let i = s.first; i < s.end; i++) {
      const b = bucket(Math.floor(pos[i * 3] / SEE), Math.floor(pos[i * 3 + 1] / SEE), Math.floor(pos[i * 3 + 2] / SEE));
      bucketOf[i] = b;
      bucketStart[b + 1]++;
    }
    for (let b = 0; b < BUCKETS; b++) bucketStart[b + 1] += bucketStart[b];
    bucketFill.fill(0);
    for (let i = s.first; i < s.end; i++) order[bucketStart[bucketOf[i]] + bucketFill[bucketOf[i]]++] = i;

    for (let i = s.first; i < s.end; i++) {
      const k = i * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const cx = Math.floor(x / SEE), cy = Math.floor(y / SEE), cz = Math.floor(z / SEE);
      // n neighbours, the sums of their positions and velocities, and the push away from the close ones.
      let n = 0, sx = 0, sy = 0, sz = 0, mx = 0, my = 0, mz = 0, ax = 0, ay = 0, az = 0;
      // The other cells come in opposite pairs, and the start pair turns for each fish and frame.
      // A scan that stops early then stays balanced.
      const turn = 2 * ((i + frame) % 13);
      scan: for (let c = 0; c < 27; c++) {
        const o = c === 0 ? 0 : (1 + ((c - 1 + turn) % 26)) * 3;
        const b = bucket(cx + NEIGHBOUR_CELLS[o], cy + NEIGHBOUR_CELLS[o + 1], cz + NEIGHBOUR_CELLS[o + 2]);
        // Two cells can share a bucket. Scan each bucket once.
        let repeat = false;
        for (let q = 0; q < c; q++) if (scanned[q] === b) { repeat = true; break; }
        scanned[c] = b;
        if (repeat) continue;
        for (let at = bucketStart[b], end = bucketStart[b + 1]; at < end; at++) {
          const j = order[at] * 3;
          if (j === k) continue;
          const ox = x - pos[j], oy = y - pos[j + 1], oz = z - pos[j + 2];
          const d2 = ox * ox + oy * oy + oz * oz;
          // The negated test also rejects a NaN distance.
          if (!(d2 <= SEE * SEE && d2 > 1e-8)) continue;
          n++;
          sx += pos[j]; sy += pos[j + 1]; sz += pos[j + 2];
          mx += vel[j]; my += vel[j + 1]; mz += vel[j + 2];
          if (d2 < CLEAR * CLEAR) {
            const d = Math.sqrt(d2), w = (CLEAR - d) / (CLEAR * d);
            ax += ox * w; ay += oy * w; az += oz * w;
          }
          if (n >= ENOUGH) break scan;
        }
      }
      stats.pairs += n;
      let fx = ax * 9, fy = ay * 9, fz = az * 9;                          // keep clear
      if (n > 0) {
        fx += (mx / n - vel[k]) * 1.3 + (sx / n - x) * 0.7;               // match heading, stay together
        fy += (my / n - vel[k + 1]) * 1.3 + (sy / n - y) * 0.7;
        fz += (mz / n - vel[k + 2]) * 1.3 + (sz / n - z) * 0.7;
      }
      social[k] = fx; social[k + 1] = fy; social[k + 2] = fz;
    }
  }

  // ------------------------------------------------------------------------------------------- one step of one school
  const nearby = []; // threats close to the current school, in its frame: x, y, z, radius
  let jitterState = 12345;
  const jitter = () => { jitterState = (Math.imul(jitterState, 1664525) + 1013904223) | 0; return jitterState / 2147483648; };

  // Moves the wandering points of a roam or split school. Each path never repeats exactly, and its top speed
  // is close to the cruise speed, so the school can keep up.
  function wander(s, time) {
    const f = s.phase;
    const x = 11 * Math.sin(time * 0.097 + f[0]) + 5 * Math.sin(time * 0.213 + f[1]);
    const y = 4 * Math.sin(time * 0.071 + f[2]);
    const z = 11 * Math.sin(time * 0.083 + f[3]) + 5 * Math.sin(time * 0.187 + f[4]);
    if (s.points.length === 1) {
      s.points[0].set(x, y, z);
      return;
    }
    // The two points sit together for about half of each cycle, then swing apart.
    const apart = Math.max(0, Math.sin(time * 0.043 + f[5]));
    const gap = 10 * apart * apart * (3 - 2 * apart), turn = time * 0.05 + f[6];
    const ox = Math.cos(turn) * gap, oy = 0.3 * Math.sin(turn * 0.8) * gap, oz = Math.sin(turn) * gap;
    s.points[0].set(x + ox, y + oy, z + oz);
    s.points[1].set(x - ox, y - oy, z - oz);
  }

  // `dt` is the simulation step. `frameTime` is the real frame time, which moves the water past the whale.
  function step(s, dt, frameTime, time, threats, velocity) {
    if ((frame + s.index) % 2 === 0) socialForces(s);

    nearby.length = 0;
    for (const t of threats) {
      const x = t.x - s.anchor.x, y = t.y - s.anchor.y, z = t.z - s.anchor.z, reach = t.r + 40;
      if (x * x + y * y + z * z < reach * reach) nearby.push(x, y, z, t.r);
    }

    const { kind, cruise, spin, radius, half, drift, points } = s;
    const ball = kind === 'ball', stream = kind === 'stream';
    let dirX = 0, dirZ = 1, ballRadius = 0;
    if (ball) ballRadius = radius * (1 + 0.14 * Math.sin(time * 0.45 + s.breathe)); // the ball swells and shrinks
    if (points) wander(s, time);
    if (stream) {
      // The anchor of a stream travels with the fish, on a course that turns slowly.
      s.wanderPhase += dt * 0.11;
      const course = s.heading + 0.22 * Math.sin(s.wanderPhase);
      dirX = Math.sin(course); dirZ = Math.cos(course);
      drift.set(dirX * cruise, 0.25 * Math.sin(s.wanderPhase * 0.7), dirZ * cruise);
    }
    const calm = Math.exp(-dt * 1.1), settle = Math.min(dt * 2.5, 1);

    for (let i = s.first; i < s.end; i++) {
      const k = i * 3;
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      let vx = vel[k], vy = vel[k + 1], vz = vel[k + 2];
      let fx = social[k], fy = social[k + 1], fz = social[k + 2];

      if (ball) {
        // Bait ball: stay inside a sphere and circle slowly around its upright axis.
        const d = Math.sqrt(x * x + y * y + z * z) + 1e-5;
        const pull = d > ballRadius ? Math.min((d - ballRadius) * 1.8, 7) + 0.2 : 0.2 * (d / ballRadius);
        fx -= (x / d) * pull; fy -= (y / d) * pull * 1.3; fz -= (z / d) * pull;
        const rho = Math.sqrt(x * x + z * z) + 1e-5, turn = 0.6 * Math.min(rho / ballRadius, 1);
        fx += (-z / rho * spin * cruise - vx) * turn;
        fz += (x / rho * spin * cruise - vz) * turn;
      } else if (points) {
        // Roam: swim toward the nearest wandering point. Close to it only a weak pull is left, so the fish mill freely.
        let px = points[0].x - x, py = points[0].y - y, pz = points[0].z - z;
        let d = Math.sqrt(px * px + py * py + pz * pz);
        if (points.length > 1) {
          const qx = points[1].x - x, qy = points[1].y - y, qz = points[1].z - z, dq = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (dq < d) { px = qx; py = qy; pz = qz; d = dq; }
        }
        d += 1e-5;
        const pull = 0.15 + 2.4 * Math.min(Math.max((d - 2.5) / 7, 0), 1.5);
        fx += (px / d) * pull; fy += (py / d) * pull * 1.3; fz += (pz / d) * pull;
      } else {
        // Stream: match the course, and stay inside a long tube around it.
        fx += drift.x - vx; fy += drift.y - vy; fz += drift.z - vz;
        const along = x * dirX + z * dirZ;
        const sideX = x - along * dirX, sideY = y * 1.4, sideZ = z - along * dirZ;
        const side = Math.sqrt(sideX * sideX + sideY * sideY + sideZ * sideZ) + 1e-5;
        if (side > radius) {
          const back = (side - radius) * 1.6 / side;
          fx -= sideX * back; fy -= sideY * back; fz -= sideZ * back;
        }
        if (Math.abs(along) > half) {
          const back = (Math.abs(along) - half) * 0.9 * Math.sign(along);
          fx -= dirX * back; fz -= dirZ * back;
        }
      }

      // Flee from large animals. This is what tears a school open.
      for (let t = 0; t < nearby.length; t += 4) {
        const ox = x - nearby[t], oy = y - nearby[t + 1], oz = z - nearby[t + 2], r = nearby[t + 3];
        const d2 = ox * ox + oy * oy + oz * oz;
        if (d2 >= r * r) continue;
        // The small offset can lift d above r. Without the clamp, near goes negative and its square root is NaN.
        const d = Math.sqrt(d2) + 1e-5, near = Math.max(0, 1 - d / r);
        const force = 26 * near * Math.sqrt(near) / d;
        fx += ox * force; fy += oy * force; fz += oz * force;
        panic[i] = Math.max(panic[i], Math.min(1, near * 1.5));
      }

      // Stay between the surface and the sand.
      const worldY = s.anchor.y + y;
      if (worldY > -3.5) fy -= (worldY + 3.5) * 4;
      if (worldY < -62) fy += (-62 - worldY) * 4;

      // A little restlessness, then the limit on how hard a fish can turn.
      fx += jitter() * 0.7; fy += jitter() * 0.5; fz += jitter() * 0.7;
      const size = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (size > MAX_FORCE) { const c = MAX_FORCE / size; fx *= c; fy *= c; fz *= c; }
      vx += fx * dt; vy += fy * dt; vz += fz * dt;

      // A calm fish holds its cruise speed. A frightened fish sprints.
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-5;
      const want = cruise * (1 + 1.5 * panic[i]);
      const next = Math.min(Math.max(speed + (want - speed) * settle, cruise * 0.55), cruise * 2.8);
      vx *= next / speed; vy *= next / speed; vz *= next / speed;
      panic[i] *= calm;

      // A non-finite value would spread to the neighbours through the averages. Reset the fish to the school centre.
      if (!Number.isFinite(vx + vy + vz + x + y + z)) {
        pos.fill(0, k, k + 3); vel.set([0, 0, cruise], k); social.fill(0, k, k + 3);
        panic[i] = 0;
        stats.repaired++;
        continue;
      }
      vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      pos[k] = x + (vx - drift.x) * dt;
      pos[k + 1] = y + (vy - drift.y) * dt;
      pos[k + 2] = z + (vz - drift.z) * dt;
      info[k + 2] = (info[k + 2] + dt * (5 + 5.5 * next)) % TAU; // the tail beats faster when the fish swims faster
    }

    s.anchor.x += drift.x * dt - velocity.x * frameTime;
    s.anchor.y = clamp(s.anchor.y + drift.y * dt, -42, -8);
    s.anchor.z += drift.z * dt - velocity.z * frameTime;
    if (s.anchor.z < -140 || s.anchor.z > 230 || Math.abs(s.anchor.x) > 150) place(s, false);
  }

  // ------------------------------------------------------------------------------------------- public
  const whaleSpots = WHALE_SPOTS.map(() => ({ x: 0, y: 0, z: 0, r: 5.6 }));
  const firstOf = (kind) => schools.find((s) => s.kind === kind);
  const ballSchool = firstOf('ball'), roamSchool = firstOf('roam'), splitSchool = firstOf('split'), streamSchool = firstOf('stream');
  const focusPoint = new THREE.Vector3();
  let all = null; // the whale spots, then the other threats
  return {
    mesh: fishMesh,
    count: TOTAL,
    stats,
    schools,
    // Centres of the bait balls, for hunters to aim at.
    prey: schools.filter((s) => s.kind === 'ball').map((s) => s.anchor),
    // Points a test view can look at with ?focus=ball and so on: the first school of each pattern.
    targets: {
      ball: () => ballSchool.anchor,
      roam: () => focusPoint.copy(roamSchool.anchor).add(roamSchool.points[0]),
      split: () => focusPoint.copy(splitSchool.points[0]).add(splitSchool.points[1]).multiplyScalar(0.5).add(splitSchool.anchor),
      stream: () => streamSchool.anchor,
    },
    // `velocity` is the velocity of the whale. `threats` lists other animals to flee from, as { x, y, z, r }.
    update(time, frameTime, velocity, threats, whaleMesh) {
      frame++;
      const sin = Math.sin(whaleMesh.rotation.y), cos = Math.cos(whaleMesh.rotation.y);
      for (let i = 0; i < whaleSpots.length; i++) {
        whaleSpots[i].x = whaleMesh.position.x + sin * WHALE_SPOTS[i];
        whaleSpots[i].y = whaleMesh.position.y;
        whaleSpots[i].z = whaleMesh.position.z + cos * WHALE_SPOTS[i];
      }
      all ??= whaleSpots.concat(threats); // the threat objects are updated in place, so one list serves every frame
      const dt = Math.min(frameTime, MAX_STEP);
      if (dt > 0) for (const s of schools) step(s, dt, frameTime, time, all, velocity);
      for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
    },
  };
}
