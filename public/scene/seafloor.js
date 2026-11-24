import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';

const CELL = 3;   // metres between floor vertices
const CELLS = 170;

// ---------------------------------------------------------------------------------------------
// Wreck parts. Every part becomes loose triangles, so the finished wreck has flat, hard faces.

function hullPoint(spec, u, v) {
  // u runs from stern to bow. v runs from the port rail, under the keel, to the starboard rail.
  const th = (v - 0.5) * Math.PI;
  const full = Math.pow(Math.max(4 * u * (1 - u), 1e-4), 0.45);
  const x = (spec.beam / 2) * full * Math.sign(Math.sin(th)) * Math.pow(Math.abs(Math.sin(th)), 0.8);
  const y = spec.sheer(u) - spec.depth * (0.55 + 0.45 * Math.pow(full, 0.7)) * Math.pow(Math.max(Math.cos(th), 0), 0.75);
  return [x, y, (u - 0.5) * spec.length];
}

function grid(fn, nu, nv) {
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...fn(i / nu, j / nv));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

const hullSkin = (spec, u0, u1, nu) => grid((u, v) => hullPoint(spec, u0 + (u1 - u0) * u, v), nu, 12);

function deck(spec, u0, u1, drop) {
  return grid((u, v) => {
    const uu = u0 + (u1 - u0) * u;
    const edge = hullPoint(spec, uu, 1);
    return [edge[0] * 0.96 * (v * 2 - 1), spec.sheer(uu) - drop, edge[2]];
  }, 14, 2);
}

// Bare frames, for the part of a wooden hull that has lost its planks.
function ribs(spec, u0, u1, spacing) {
  const parts = [];
  const width = 0.4 / spec.length;
  for (let u = u0; u < u1; u += spacing / spec.length) parts.push(hullSkin(spec, u, u + width, 1));
  return parts;
}

function placed(geometry, { at = [0, 0, 0], rot = [0, 0, 0] }) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
  return geometry.applyMatrix4(m);
}

// A pole between two points.
function spar(from, to, radius) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const geo = new THREE.CylinderGeometry(radius * 0.7, radius, a.distanceTo(b), 7, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

function merge(parts) {
  const pos = [];
  for (const part of parts) {
    const loose = part.index ? part.toNonIndexed() : part;
    pos.push(...loose.getAttribute('position').array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function sailingShip() {
  const spec = { length: 34, beam: 8.5, depth: 5.5, sheer: (u) => 1.3 * Math.pow(2 * u - 1, 2) };
  const z = (u) => (u - 0.5) * spec.length;
  return merge([
    hullSkin(spec, 0.42, 0.995, 20),
    ...ribs(spec, 0.04, 0.42, 1.5),
    deck(spec, 0.52, 0.96, 0.6),
    placed(new THREE.BoxGeometry(0.6, 0.7, spec.length * 0.96), { at: [0, -spec.depth + 0.2, 0] }),
    spar([0, -4.5, z(0.66)], [1.9, 10.5, z(0.63)], 0.40),      // main mast, still standing, broken at the top
    spar([-3.6, 7.4, z(0.645)], [5.4, 7.9, z(0.64)], 0.20),    // its yard
    spar([0.5, -1.0, z(0.40)], [-15.5, -4.4, z(0.20)], 0.36),  // fallen mast, resting on the sand
    spar([0, 0.6, z(0.965)], [0.4, 3.6, z(0.965) + 6.5], 0.24), // bowsprit
    spar([0, -4.5, z(0.86)], [-0.4, 3.2, z(0.855)], 0.30),     // stump of the fore mast
  ]);
}

function steamer() {
  const spec = { length: 58, beam: 10.5, depth: 7, sheer: (u) => 0.9 * Math.pow(2 * u - 1, 2) };
  const z = (u) => (u - 0.5) * spec.length;
  return merge([
    hullSkin(spec, 0.005, 0.995, 30),
    deck(spec, 0.03, 0.97, 0.35),
    placed(new THREE.BoxGeometry(9.2, 2.8, 17), { at: [0, 1.3, z(0.50)] }),          // deckhouse
    placed(new THREE.BoxGeometry(7.4, 2.6, 5.5), { at: [0, 4.0, z(0.57)] }),         // bridge
    placed(new THREE.CylinderGeometry(1.35, 1.5, 6.5, 12, 1), { at: [0, 5.6, z(0.46)], rot: [-0.14, 0, 0.05] }), // funnel
    placed(new THREE.BoxGeometry(5.5, 0.9, 6), { at: [0, 0.4, z(0.24)] }),           // hatch covers
    placed(new THREE.BoxGeometry(5.5, 0.9, 6), { at: [0, 0.4, z(0.78)] }),
    spar([0, 0, z(0.33)], [0.6, 12.5, z(0.325)], 0.26),                              // cargo masts
    spar([0, 0, z(0.70)], [-0.5, 6.0, z(0.71)], 0.26),
    spar([0.2, 6.5, z(0.33)], [3.6, 1.2, z(0.20)], 0.14),                            // a derrick, dropped on the deck
  ]);
}

// ---------------------------------------------------------------------------------------------

export function createSeafloor(shared, noiseTexture) {
  const rand = rng(606);
  const range = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();

  // The vertex grid is flat. The shader lifts each vertex to the dune height at its place.
  const floorGeo = new THREE.PlaneGeometry(CELL * CELLS, CELL * CELLS, CELLS, CELLS);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uWhale: { value: new THREE.Vector3() }, uWhaleDir: { value: new THREE.Vector2(0, 1) } },
    vertexShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y = floorHeight(w.xz);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform vec3 uWhale;
      uniform vec2 uWhaleDir;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        vec2 tp = p + uTravel;
        float dist = distance(vWorld, cameraPosition);
        vec3 V = normalize(cameraPosition - vWorld);

        const float E = 1.5;
        float hx = floorHeight(p + vec2(E, 0.0)) - floorHeight(p - vec2(E, 0.0));
        float hz = floorHeight(p + vec2(0.0, E)) - floorHeight(p - vec2(0.0, E));

        // Long sand ripples. The wave numbers fit the 512 m terrain tile, so the wrap shows no seam.
        const vec2 K = vec2(1.47262, 0.55223);
        float warp = texture(uTerrain, tp / 64.0).b;
        float phase = dot(tp, K) + warp * 9.0;
        float fine = 1.0 - smoothstep(35.0, 100.0, dist);
        vec3 N = normalize(vec3(-hx / (2.0 * E) - cos(phase) * K.x * 0.10 * fine, 1.0,
                                -hz / (2.0 * E) - cos(phase) * K.y * 0.10 * fine));

        float tone = texture(uTerrain, tp / 128.0).g;
        vec3 albedo = SAND * (0.82 + 0.36 * tone) * (1.0 + 0.07 * sin(phase) * fine);
        albedo *= 0.80 + 0.20 * smoothstep(-7.0, 7.0, vWorld.y - FLOOR_Y);

        // Shadow of the whale. Trace the sun ray from the sand up to the depth of the whale.
        vec3 q = vWorld + uSunDir * ((uWhale.y - vWorld.y) / uSunDir.y);
        vec2 d = q.xz - uWhale.xz;
        float along = dot(d, uWhaleDir) + 1.5;
        float across = dot(d, vec2(uWhaleDir.y, -uWhaleDir.x));
        float shade = 1.0 - smoothstep(0.35, 1.35, length(vec2(along / 13.5, across / 4.2)));
        albedo *= 1.0 - 0.5 * shade;

        gl_FragColor = vec4(shadeSkin(albedo, N, V, vWorld, 6.0, 0.0), 1.0);
      }
    `,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  group.add(floor);

  const wreckMaterial = (tint) => new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uNoise: { value: noiseTexture }, uTint: { value: new THREE.Color(...tint) } },
    vertexShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // The wreck rests on the sand at its own position, whatever dune that is.
        w.y += floorHeight(modelMatrix[3].xz);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLocal = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform sampler2D uNoise;
      uniform vec3 uTint;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float growth = texture(uNoise, vLocal.xz * 0.055 + vLocal.y * 0.05).r;
        float stain = texture(uNoise, vLocal.zy * 0.19 + vLocal.x * 0.07).g;
        vec3 albedo = mix(uTint, uTint * 0.4, stain);
        albedo = mix(albedo, vec3(0.045, 0.125, 0.100), smoothstep(0.45, 0.68, growth) * 0.65);
        // Silt settles on every face that points up.
        albedo = mix(albedo, SAND * 0.75, smoothstep(0.5, 0.95, N.y) * 0.6);
        gl_FragColor = vec4(shadeSkin(albedo, N, V, vWorld, 8.0, 0.0), 1.0);
      }
    `,
  });

  const wrecks = [
    { mesh: new THREE.Mesh(sailingShip(), wreckMaterial([0.150, 0.115, 0.085])), sink: 3.4 },
    { mesh: new THREE.Mesh(steamer(), wreckMaterial([0.185, 0.105, 0.070])), sink: 4.6 },
  ];
  const place = (w, z) => {
    w.mesh.position.set(range(-38, 38), w.sink, z);
    // Each wreck lies on its side by a different amount.
    w.mesh.rotation.set(range(-0.06, 0.06), range(0, Math.PI * 2), range(0.16, 0.42) * (rand() < 0.5 ? -1 : 1), 'YXZ');
  };
  for (const w of wrecks) {
    w.mesh.frustumCulled = false;
    group.add(w.mesh);
  }
  place(wrecks[0], 75);
  place(wrecks[1], 420);

  const where = new THREE.Vector3();
  return {
    group,
    // A test view can look at the first wreck with ?focus=wreck.
    target: () => where.set(wrecks[0].mesh.position.x, -70, wrecks[0].mesh.position.z),
    // `travel` is the distance swum so far, `velocity` the velocity of the whale.
    update(dt, camera, travel, velocity, whaleMesh) {
      // The grid follows the camera in whole cells. Each vertex then stays on the same spot of sand.
      const snap = (c, t) => c - ((((c + t) % CELL) + CELL) % CELL);
      floor.position.set(snap(camera.position.x, travel.x), 0, snap(camera.position.z, travel.z));
      floorMat.uniforms.uWhale.value.copy(whaleMesh.position);
      floorMat.uniforms.uWhaleDir.value.set(Math.sin(whaleMesh.rotation.y), Math.cos(whaleMesh.rotation.y));

      for (const w of wrecks) {
        w.mesh.position.x -= velocity.x * dt;
        w.mesh.position.z -= velocity.z * dt;
        if (w.mesh.position.z < -300 || Math.abs(w.mesh.position.x) > 300) place(w, range(330, 560));
      }
    },
  };
}
