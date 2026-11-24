import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';

const SCHOOLS = 6;
const PER_SCHOOL = 520;
const LOOP = 600; // seconds. Every fish motion repeats exactly over this time.

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
  const count = SCHOOLS * PER_SCHOOL;
  const orbit = new Float32Array(count * 4);
  const kind = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 0.35 + 0.65 * Math.sqrt(rand());
    orbit[i * 4] = r;                                     // orbit radius, 0..1
    orbit[i * 4 + 1] = rand() * Math.PI * 2;              // start angle
    orbit[i * 4 + 2] = (rand() * 2 - 1) * Math.sqrt(1 - r * r * 0.6); // height, -1..1
    orbit[i * 4 + 3] = Math.round((26 + rand() * 16) / r); // whole turns per loop
    kind[i * 3] = Math.floor(i / PER_SCHOOL);
    kind[i * 3 + 1] = 0.26 + rand() * 0.16;               // length in metres
    kind[i * 3 + 2] = rand() * Math.PI * 2;
  }
  const geo = fishGeometry();
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 3));
  geo.instanceCount = count;

  const centers = [], shapes = [], schools = [];
  for (let i = 0; i < SCHOOLS; i++) {
    centers.push(new THREE.Vector3());
    shapes.push(new THREE.Vector4());
    schools.push({ drift: new THREE.Vector3() });
  }
  const place = (i, z) => {
    const side = rand() < 0.5 ? -1 : 1;
    centers[i].set(side * (14 + rand() * 46), -(7 + rand() * 30), z);
    const radius = 4 + rand() * 6;
    shapes[i].set(radius * (0.8 + rand() * 0.5), radius * (0.3 + rand() * 0.25), radius, rand() < 0.5 ? -1 : 1);
    schools[i].drift.set((rand() - 0.5) * 0.6, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.8);
  };
  for (let i = 0; i < SCHOOLS; i++) place(i, -50 + (i / SCHOOLS) * 190 + rand() * 20);

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      ...shared,
      uCenter: { value: centers },
      uShape: { value: shapes },
      uLoop: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #define SCHOOLS ${SCHOOLS}
      attribute vec4 aOrbit;
      attribute vec3 aKind;
      uniform vec3 uCenter[SCHOOLS];
      uniform vec4 uShape[SCHOOLS];
      uniform float uLoop;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vAlong;
      void main() {
        int si = int(aKind.x + 0.5);
        vec4 shape = uShape[si];
        float turn = 6.2831853 * aOrbit.w / ${LOOP.toFixed(1)};
        float ang = aOrbit.y + shape.w * turn * uLoop;
        float cs = cos(ang), sn = sin(ang);
        vec3 centre = uCenter[si] + vec3(cs * aOrbit.x * shape.x,
                                         aOrbit.z * shape.y + 0.35 * sin(ang * 3.0 + aKind.z),
                                         sn * aOrbit.x * shape.z);
        vec3 fwd = normalize(vec3(-sn * shape.x, 0.25 * cos(ang * 3.0 + aKind.z), cs * shape.z)) * shape.w;
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
        vec3 up = cross(fwd, right);

        vec3 p = position;
        // The tail beats twice a second. The beat count per loop is whole, so the loop has no jump.
        float beat = sin(6.2831853 * 2.0 * uLoop + aKind.z - p.z * 5.0);
        p.x += beat * 0.10 * (0.55 - p.z);
        // A fish that comes close to the camera shrinks away, so it never fills the screen.
        p *= aKind.y * smoothstep(5.0, 11.0, distance(centre, cameraPosition));
        vec3 n = normal;
        n.z += beat * 0.25 * n.x;

        vWorld = centre + right * p.x + up * p.y + fwd * p.z;
        vNormal = normalize(right * n.x + up * n.y + fwd * n.z);
        vAlong = position.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vAlong;
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

  return {
    mesh,
    // `flow` is the velocity of the whale. The schools move the other way.
    update(time, dt, flow) {
      material.uniforms.uLoop.value = time % LOOP;
      for (let i = 0; i < SCHOOLS; i++) {
        const c = centers[i];
        c.x += (schools[i].drift.x - flow.x) * dt;
        c.y += schools[i].drift.y * dt;
        c.z += (schools[i].drift.z - flow.z) * dt;
        c.y = Math.min(c.y, -shapes[i].y - 3);
        if (c.z < -110 || Math.abs(c.x) > 130) place(i, 120 + rand() * 50);
      }
    },
  };
}
