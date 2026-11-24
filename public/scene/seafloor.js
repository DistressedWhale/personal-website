import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';
import { sailingShip, steamer } from './wrecks.js';

const CELL = 3;   // metres between floor vertices
const CELLS = 170;

export function createSeafloor(shared, noiseTexture) {
  const rand = rng(606);
  const range = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();

  // The vertex grid is flat. The shader lifts each vertex to the dune height at its place.
  const floorGeo = new THREE.PlaneGeometry(CELL * CELLS, CELL * CELLS, CELLS, CELLS);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uWhale: { value: new THREE.Vector3() },
      uWhaleDir: { value: new THREE.Vector2(0, 1) },
      uWreck: { value: [new THREE.Vector4(), new THREE.Vector4()] },                 // x, z, then the bow direction
      uWreckSize: { value: [new THREE.Vector2(20, 7.5), new THREE.Vector2(33, 9.5)] }, // half length, half width
    },
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
      uniform vec4 uWreck[2];
      uniform vec2 uWreckSize[2];
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

        // The sand is darker under and beside a wreck. This ties the wreck to the floor.
        for (int i = 0; i < 2; i++) {
          vec2 w = p - uWreck[i].xy;
          vec2 bow = uWreck[i].zw;
          vec2 reach = vec2(dot(w, bow), dot(w, vec2(bow.y, -bow.x))) / uWreckSize[i];
          albedo *= 1.0 - 0.5 * (1.0 - smoothstep(0.5, 1.2, length(reach)));
        }

        gl_FragColor = vec4(shadeSkin(albedo, N, V, vWorld, 6.0, 0.0), 1.0);
      }
    `,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  group.add(floor);

  const wreckMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared, uNoise: { value: noiseTexture } },
    vertexShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vColor;
      attribute vec3 aColor;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // Model height 0 is the sand. Each vertex takes the dune height at its own place, so debris lies on the slope.
        w.y += floorHeight(w.xz);
        vColor = aColor;
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLocal = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform sampler2D uNoise;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float growth = texture(uNoise, vLocal.xz * 0.055 + vLocal.y * 0.05).r;
        float stain = texture(uNoise, vLocal.zy * 0.19 + vLocal.x * 0.07).g;
        // Openings stay dark. Growth and silt only cover solid surfaces.
        float solid = smoothstep(0.015, 0.05, max(vColor.r, max(vColor.g, vColor.b)));
        vec3 albedo = mix(vColor, vColor * 0.45, stain);
        albedo = mix(albedo, vec3(0.045, 0.125, 0.100), smoothstep(0.45, 0.68, growth) * 0.6 * solid);
        // Silt settles on every face that points up.
        albedo = mix(albedo, SAND * 0.75, smoothstep(0.5, 0.95, N.y) * 0.5 * solid);
        gl_FragColor = vec4(shadeSkin(albedo, N, V, vWorld, 8.0, 0.0), 1.0);
      }
    `,
  });

  const wrecks = [sailingShip(), steamer()].map((geometry) => new THREE.Mesh(geometry, wreckMaterial));
  const place = (wreck, z) => {
    wreck.position.set(range(-38, 38), 0, z);
    wreck.rotation.y = range(0, Math.PI * 2);
  };
  for (const wreck of wrecks) {
    wreck.frustumCulled = false;
    group.add(wreck);
  }
  place(wrecks[0], 75);
  place(wrecks[1], 420);

  const where = new THREE.Vector3();
  return {
    group,
    // Test views: ?focus=wreck looks at the sailing ship, ?focus=wreck2 at the steamer.
    target: (index) => where.set(wrecks[index].position.x, -70, wrecks[index].position.z),
    // `travel` is the distance swum so far, `velocity` the velocity of the whale.
    update(dt, camera, travel, velocity, whaleMesh) {
      // The grid follows the camera in whole cells. Each vertex then stays on the same spot of sand.
      const snap = (c, t) => c - ((((c + t) % CELL) + CELL) % CELL);
      floor.position.set(snap(camera.position.x, travel.x), 0, snap(camera.position.z, travel.z));
      floorMat.uniforms.uWhale.value.copy(whaleMesh.position);
      floorMat.uniforms.uWhaleDir.value.set(Math.sin(whaleMesh.rotation.y), Math.cos(whaleMesh.rotation.y));

      wrecks.forEach((wreck, i) => {
        floorMat.uniforms.uWreck.value[i].set(wreck.position.x, wreck.position.z, Math.sin(wreck.rotation.y), Math.cos(wreck.rotation.y));
      });
      for (const wreck of wrecks) {
        wreck.position.x -= velocity.x * dt;
        wreck.position.z -= velocity.z * dt;
        if (wreck.position.z < -300 || Math.abs(wreck.position.x) > 300) place(wreck, range(330, 560));
      }
    },
  };
}
