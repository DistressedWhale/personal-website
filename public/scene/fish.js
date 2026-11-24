import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';

// Sardine schools, simulated as boids. Each fish steers by three local rules: keep clear of close
// neighbours, match their heading, and stay with them. Each school adds one rule for its pattern,
// and every fish flees from large animals. No fish follows a scripted path.

const TAU = Math.PI * 2;
const SCHOOLS = [
  { kind: 'ball', count: 640 },
  { kind: 'ball', count: 560 },
  { kind: 'ring', count: 620 },
  { kind: 'ring', count: 520 },
  { kind: 'stream', count: 640 },
];
const TOTAL = SCHOOLS.reduce((n, s) => n + s.count, 0);

const SEE = 1.35;       // metres. A fish reacts to neighbours inside this distance.
const CLEAR = 0.62;     // metres. Closer than this, neighbours push apart.
const MAX_PUSH = 18;    // metres per second squared
const BUCKETS = 4096;

function fishGeometry() {
  // A flat diamond body with a tail fin. The fish faces +Z.
  const nose = [0, 0, 0.5], top = [0, 0.15, 0.08], bot = [0, -0.13, 0.08];
  const left = [0.055, 0, 0.1], right = [-0.055, 0, 0.1], stock = [0, 0, -0.32];
  const tailTop = [0, 0.16, -0.56], tailBot = [0, -0.16, -0.56];
  const tris = [
    [nose, left, top], [nose, top, right], [nose, bot, left], [nose, right, bot],
    [stock, top, left], [stock, right, top], [stock, left, bot], [stock, bot, right],
    [stock, tailBot, tailTop],
  ];
  const pos = [], nor = [];
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    pos.push(...a, ...b, ...c);
    nor.push(...n, ...n, ...n);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

export function createFish(shared) {
  const rand = rng(41);
  const range = (a, b) => a + rand() * (b - a);

  // Positions are relative to the anchor of the school. Velocities are relative to the water.
  const pos = new Float32Array(TOTAL * 3);
  const vel = new Float32Array(TOTAL * 3);
  const info = new Float32Array(TOTAL * 3);   // school index, length in metres, tail phase
  const social = new Float32Array(TOTAL * 3); // push from the neighbour rules, refreshed every second frame
  const panic = new Float32Array(TOTAL);
  const bucketOf = new Uint16Array(TOTAL);
  const bucketStart = new Uint32Array(BUCKETS + 1);
  const bucketFill = new Uint32Array(BUCKETS);
  const order = new Uint32Array(TOTAL);

  const anchors = [];
  const schools = [];
  let first = 0;
  SCHOOLS.forEach((def, index) => {
    const school = {
      ...def, index, first, end: first + def.count,
      anchor: new THREE.Vector3(), drift: new THREE.Vector3(),
      spin: rand() < 0.5 ? -1 : 1, breathe: range(0, TAU), heading: 0, wander: range(0, TAU),
    };
    if (def.kind === 'ball') { school.radius = 0.62 * Math.cbrt(def.count); school.cruise = 1.5; }
    if (def.kind === 'ring') { school.radius = range(7.5, 10); school.cruise = 2.1; }
    if (def.kind === 'stream') { school.radius = 2.8; school.half = 15; school.cruise = 4.4; }
    for (let i = first; i < school.end; i++) {
      // Start each fish inside its pattern, already moving the right way.
      let x, y, z, vx = 0, vz = 0;
      if (def.kind === 'ball') {
        const r = school.radius * Math.cbrt(rand()), a = rand() * TAU, c = rand() * 2 - 1, s = Math.sqrt(1 - c * c);
        x = r * s * Math.cos(a); y = r * c; z = r * s * Math.sin(a);
        vx = -Math.sin(a) * school.spin; vz = Math.cos(a) * school.spin;
      } else if (def.kind === 'ring') {
        const a = rand() * TAU, tube = 1.5 * Math.sqrt(rand()), b = rand() * TAU;
        const rho = school.radius + tube * Math.cos(b);
        x = rho * Math.cos(a); y = tube * Math.sin(b); z = rho * Math.sin(a);
        vx = -Math.sin(a) * school.spin; vz = Math.cos(a) * school.spin;
      } else {
        const r = school.radius * Math.sqrt(rand()), b = rand() * TAU;
        x = r * Math.cos(b); y = r * Math.sin(b) * 0.7; z = range(-school.half, school.half);
        vz = 1;
      }
      pos.set([x, y, z], i * 3);
      vel.set([vx * school.cruise, 0, vz * school.cruise], i * 3);
      info.set([index, 0.27 + rand() * 0.15, rand() * TAU], i * 3);
    }
    anchors.push(school.anchor);
    schools.push(school);
    first = school.end;
  });

  const place = (s, startUp) => {
    const side = rand() < 0.5 ? -1 : 1;
    if (s.kind === 'stream') {
      // A stream travels faster than the whale. It starts behind and crosses the path at a shallow angle.
      s.anchor.set(side * range(10, 40), -range(9, 32), startUp ? range(-60, 10) : range(-150, -120));
      s.heading = -side * range(0.02, 0.16);
    } else {
      s.anchor.set(side * range(0, 42), -range(9, 36), startUp ? range(-30, 150) : range(125, 200));
      s.drift.set(range(-0.3, 0.3), 0, range(-0.3, 0.4));
      if (s.kind === 'ring') s.radius = range(7.5, 10);
    }
  };
  schools.forEach((s) => place(s, true));

  const geo = fishGeometry();
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const velAttr = new THREE.InstancedBufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage);
  const infoAttr = new THREE.InstancedBufferAttribute(info, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', posAttr);
  geo.setAttribute('aVel', velAttr);
  geo.setAttribute('aInfo', infoAttr);
  geo.instanceCount = TOTAL;

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uAnchor: { value: anchors } },
    vertexShader: /* glsl */ `
      #define SCHOOLS ${SCHOOLS.length}
      attribute vec3 aPos;
      attribute vec3 aVel;
      attribute vec3 aInfo;
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
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float depth = -vWorld.y;
        // Silver sides with a dark back, like sardines.
        vec3 albedo = mix(vec3(0.50, 0.62, 0.68), vec3(0.05, 0.10, 0.16), smoothstep(0.2, 0.9, N.y));
        float ndl = dot(N, uSunDir);
        float caustic = causticAt(vWorld);
        vec3 sun = sunAt(depth) * clamp((ndl + 0.4) / 1.4, 0.0, 1.0) * mix(1.0, caustic, 0.7);
        vec3 ambient = mix(vec3(0.012, 0.07, 0.12), vec3(0.06, 0.33, 0.47), N.y * 0.5 + 0.5)
                     * exp(-vec3(0.06, 0.02, 0.014) * depth);
        vec3 col = albedo * (sun * 1.4 + ambient * 1.6);
        // Scales flash when a side catches the sun.
        vec3 H = normalize(uSunDir + V);
        col += sunAt(depth) * pow(max(dot(N, H), 0.0), 24.0) * 1.6 * (0.4 + caustic);
        gl_FragColor = vec4(fogged(col, vWorld), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  const bucket = (ix, iy, iz) => (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (BUCKETS - 1);

  // Neighbour rules for one school. A hash grid finds the neighbours, so the cost grows with the fish count, not its square.
  function socialForces(s) {
    bucketStart.fill(0);
    for (let i = s.first; i < s.end; i++) {
      const b = bucket(Math.floor(pos[i * 3] / SEE), Math.floor(pos[i * 3 + 1] / SEE), Math.floor(pos[i * 3 + 2] / SEE));
      bucketOf[i] = b;
      bucketStart[b + 1]++;
    }
    for (let b = 0; b < BUCKETS; b++) bucketStart[b + 1] += bucketStart[b];
    bucketFill.fill(0);
    for (let i = s.first; i < s.end; i++) {
      const b = bucketOf[i];
      order[bucketStart[b] + bucketFill[b]++] = i;
    }

    const see2 = SEE * SEE;
    for (let i = s.first; i < s.end; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const cx = Math.floor(x / SEE), cy = Math.floor(y / SEE), cz = Math.floor(z / SEE);
      let n = 0, sx = 0, sy = 0, sz = 0, mx = 0, my = 0, mz = 0, ax = 0, ay = 0, az = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const b = bucket(cx + dx, cy + dy, cz + dz);
        for (let k = bucketStart[b], e = bucketStart[b + 1]; k < e; k++) {
          const j = order[k];
          if (j === i) continue;
          const ox = x - pos[j * 3], oy = y - pos[j * 3 + 1], oz = z - pos[j * 3 + 2];
          const d2 = ox * ox + oy * oy + oz * oz;
          if (d2 > see2 || d2 < 1e-8) continue;
          n++;
          sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2];
          mx += vel[j * 3]; my += vel[j * 3 + 1]; mz += vel[j * 3 + 2];
          if (d2 < CLEAR * CLEAR) {
            const d = Math.sqrt(d2), w = (CLEAR - d) / (CLEAR * d);
            ax += ox * w; ay += oy * w; az += oz * w;
          }
        }
      }
      let fx = ax * 9, fy = ay * 9, fz = az * 9;                            // keep clear
      if (n > 0) {
        const inv = 1 / n;
        fx += (mx * inv - vel[i * 3]) * 1.3 + (sx * inv - x) * 0.7;         // match heading, stay together
        fy += (my * inv - vel[i * 3 + 1]) * 1.3 + (sy * inv - y) * 0.7;
        fz += (mz * inv - vel[i * 3 + 2]) * 1.3 + (sz * inv - z) * 0.7;
      }
      social[i * 3] = fx; social[i * 3 + 1] = fy; social[i * 3 + 2] = fz;
    }
  }

  const local = []; // threats in the frame of the current school: x, y, z, radius
  let frame = 0;
  let seed = 12345;
  const jitter = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648; };

  function step(s, dt, time, threats, flow) {
    if ((frame + s.index) % 2 === 0) socialForces(s);

    local.length = 0;
    for (const t of threats) {
      const x = t.x - s.anchor.x, y = t.y - s.anchor.y, z = t.z - s.anchor.z;
      const reach = t.r + 40;
      if (x * x + y * y + z * z < reach * reach) local.push(x, y, z, t.r);
    }

    // The frame of the school moves with its anchor. A stream anchor travels with the fish.
    let dirX = 0, dirZ = 1;
    if (s.kind === 'stream') {
      s.wander += dt * 0.11;
      const a = s.heading + 0.22 * Math.sin(s.wander);
      dirX = Math.sin(a); dirZ = Math.cos(a);
      s.drift.set(dirX * s.cruise, 0.25 * Math.sin(s.wander * 0.7), dirZ * s.cruise);
    }
    const ball = s.kind === 'ball' ? s.radius * (1 + 0.14 * Math.sin(time * 0.45 + s.breathe)) : 0;

    for (let i = s.first; i < s.end; i++) {
      const k = i * 3;
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      let vx = vel[k], vy = vel[k + 1], vz = vel[k + 2];
      let fx = social[k], fy = social[k + 1], fz = social[k + 2];

      if (s.kind === 'ball') {
        // Bait ball: stay inside a sphere and circle slowly around its upright axis.
        const d = Math.hypot(x, y, z) + 1e-5;
        const pull = d > ball ? Math.min((d - ball) * 1.8, 7) + 0.2 : 0.2 * (d / ball);
        fx -= (x / d) * pull; fy -= (y / d) * pull * 1.3; fz -= (z / d) * pull;
        const rho = Math.hypot(x, z) + 1e-5;
        const turn = 0.6 * Math.min(rho / ball, 1);
        fx += (-z / rho * s.spin * s.cruise - vx) * turn;
        fz += (x / rho * s.spin * s.cruise - vz) * turn;
      } else if (s.kind === 'ring') {
        // Mill: hold a circle of fixed radius and swim around it.
        const rho = Math.hypot(x, z) + 1e-5;
        const off = rho - s.radius;
        fx -= (x / rho) * off * 2.2; fz -= (z / rho) * off * 2.2;
        fy -= y * 1.4;
        fx += (-z / rho * s.spin * s.cruise - vx) * 1.1;
        fz += (x / rho * s.spin * s.cruise - vz) * 1.1;
      } else {
        // Stream: travel as one long ribbon along a slowly turning course.
        fx += (s.drift.x - vx) * 1.0; fy += (s.drift.y - vy) * 1.0; fz += (s.drift.z - vz) * 1.0;
        const along = x * dirX + z * dirZ;
        const sideX = x - along * dirX, sideZ = z - along * dirZ;
        const side = Math.hypot(sideX, y * 1.4, sideZ) + 1e-5;
        if (side > s.radius) {
          const back = (side - s.radius) * 1.6 / side;
          fx -= sideX * back; fy -= y * 1.4 * back; fz -= sideZ * back;
        }
        if (Math.abs(along) > s.half) {
          const back = (Math.abs(along) - s.half) * 0.9 * Math.sign(along);
          fx -= dirX * back; fz -= dirZ * back;
        }
      }

      // Flee from large animals. This is what tears a school open.
      for (let t = 0; t < local.length; t += 4) {
        const ox = x - local[t], oy = y - local[t + 1], oz = z - local[t + 2];
        const d2 = ox * ox + oy * oy + oz * oz, r = local[t + 3];
        if (d2 < r * r) {
          const d = Math.sqrt(d2) + 1e-5, near = 1 - d / r;
          const push = 26 * near * Math.sqrt(near) / d;
          fx += ox * push; fy += oy * push; fz += oz * push;
          if (near > panic[i]) panic[i] = Math.min(1, near * 1.5);
        }
      }

      // Stay between the surface and the sand.
      const worldY = s.anchor.y + y;
      if (worldY > -3.5) fy -= (worldY + 3.5) * 4;
      if (worldY < -62) fy += (-62 - worldY) * 4;

      fx += jitter() * 0.7; fy += jitter() * 0.5; fz += jitter() * 0.7;
      const push = Math.hypot(fx, fy, fz);
      if (push > MAX_PUSH) { const c = MAX_PUSH / push; fx *= c; fy *= c; fz *= c; }

      vx += fx * dt; vy += fy * dt; vz += fz * dt;
      // A calm fish holds its cruise speed. A frightened fish sprints.
      const speed = Math.hypot(vx, vy, vz) + 1e-5;
      const want = s.cruise * (1 + 1.5 * panic[i]);
      const next = Math.min(Math.max(speed + (want - speed) * Math.min(dt * 2.5, 1), s.cruise * 0.55), s.cruise * 2.8);
      const scale = next / speed;
      vx *= scale; vy *= scale; vz *= scale;
      panic[i] *= Math.exp(-dt * 1.1);

      vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      pos[k] = x + (vx - s.drift.x) * dt;
      pos[k + 1] = y + (vy - s.drift.y) * dt;
      pos[k + 2] = z + (vz - s.drift.z) * dt;
      // The tail beats faster when the fish swims faster.
      info[k + 2] = (info[k + 2] + dt * (5 + 5.5 * next)) % TAU;
    }

    s.anchor.x += (s.drift.x - flow.x) * dt;
    s.anchor.y = THREE.MathUtils.clamp(s.anchor.y + s.drift.y * dt, -42, -8);
    s.anchor.z += (s.drift.z - flow.z) * dt;
    if (s.anchor.z < -140 || s.anchor.z > 230 || Math.abs(s.anchor.x) > 150) place(s, false);
  }

  const all = [];
  const BODY = [8, 0.5, -8];
  const whaleSpots = BODY.map(() => ({ x: 0, y: 0, z: 0, r: 5.6 }));
  return {
    mesh,
    count: TOTAL,
    // Bait balls, for hunters to aim at.
    prey: schools.filter((s) => s.kind === 'ball').map((s) => s.anchor),
    targets: {
      ball: () => schools[0].anchor,
      ring: () => schools[2].anchor,
      stream: () => schools[4].anchor,
    },
    // `flow` is the velocity of the whale. `threats` lists animals to flee from as { x, y, z, r }.
    update(time, dt, flow, threats, whaleMesh) {
      frame++;
      // The whale counts as three spheres along its body.
      const sy = Math.sin(whaleMesh.rotation.y), cy = Math.cos(whaleMesh.rotation.y);
      BODY.forEach((along, i) => {
        whaleSpots[i].x = whaleMesh.position.x + sy * along;
        whaleSpots[i].y = whaleMesh.position.y;
        whaleSpots[i].z = whaleMesh.position.z + cy * along;
      });
      all.length = 0;
      all.push(...whaleSpots, ...threats);
      const h = Math.min(dt, 1 / 30);
      if (h > 0) for (const s of schools) step(s, h, time, all, flow);
      posAttr.needsUpdate = true;
      velAttr.needsUpdate = true;
      infoAttr.needsUpdate = true;
    },
  };
}
