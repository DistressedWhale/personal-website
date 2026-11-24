import * as THREE from 'three';
import { common } from './glsl.js';
import { rng } from './noise.js';
import { sailingShip, steamer } from './wrecks.js';

const CELL = 3;   // metres between floor vertices
const CELLS = 170;

export function createSeafloor(shared) {
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
      uWreck: { value: [new THREE.Vector4(), new THREE.Vector4()] },                 // x, z, then the unit bow direction
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
      #define WRECKS 2
      uniform vec4 uWreck[WRECKS];
      uniform vec2 uWreckSize[WRECKS];
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
        float warp = texture(uNoise, tp / 64.0).b;
        float phase = dot(tp, K) + warp * 9.0;
        float detail = 1.0 - smoothstep(35.0, 100.0, dist);
        vec3 N = normalize(vec3(-hx / (2.0 * E) - cos(phase) * K.x * 0.10 * detail, 1.0,
                                -hz / (2.0 * E) - cos(phase) * K.y * 0.10 * detail));

        float tone = texture(uNoise, tp / 128.0).g;
        vec3 albedo = SAND * (0.82 + 0.36 * tone) * (1.0 + 0.07 * sin(phase) * detail);
        albedo *= 0.80 + 0.20 * smoothstep(-7.0, 7.0, vWorld.y - FLOOR_Y);

        // Shadow of the whale. Trace the sun ray from the sand up to the depth of the whale.
        vec3 q = vWorld + uSunWater * ((uWhale.y - vWorld.y) / uSunWater.y);
        vec2 d = q.xz - uWhale.xz;
        float along = dot(d, uWhaleDir) + 1.5;
        float across = dot(d, vec2(uWhaleDir.y, -uWhaleDir.x));
        float shade = 1.0 - smoothstep(0.35, 1.35, length(vec2(along / 13.5, across / 4.2)));
        albedo *= 1.0 - 0.5 * shade;

        // The sand is darker under and beside a wreck, so the hull does not look pasted onto the floor.
        for (int i = 0; i < WRECKS; i++) {
          vec2 w = p - uWreck[i].xy;
          vec2 bow = uWreck[i].zw;
          vec2 reach = vec2(dot(w, bow), dot(w, vec2(bow.y, -bow.x))) / uWreckSize[i];
          albedo *= 1.0 - 0.5 * (1.0 - smoothstep(0.5, 1.2, length(reach)));
        }

        gl_FragColor = vec4(shadeSurface(albedo, N, V, vWorld, 6.0, 0.0), 1.0);
      }
    `,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  group.add(floor);

  const wreckMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      ${common}
      attribute vec4 aColor;
      attribute vec3 aUV; // texture coordinate in metres, then the rigid flag
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec4 vColor;
      varying vec2 vUV;
      varying float vHeight;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // Model height 0 is the sand. Debris takes the dune height at its own place. A hull takes it at the wreck origin, so it does not bend.
        w.y += floorHeight(mix(w.xz, modelMatrix[3].xz, aUV.z));
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = aColor;
        vUV = aUV.xy;
        vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec4 vColor;
      varying vec2 vUV;
      varying float vHeight;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float seams = vColor.a;
        float wood = step(1.5, seams);
        float plate = step(0.1, seams) * (1.0 - wood);
        // Openings stay dark. Texture, growth and silt only cover solid surfaces.
        float solid = step(0.0, seams);

        // Streaks along every part, and rust that ran down each steel plate.
        float grain = texture(uNoise, vec2(vUV.x * 0.06, vUV.y * 0.9)).b;
        float runs = texture(uNoise, vec2(vUV.x * 0.8, vUV.y * 0.05) + 0.5).g;
        vec3 albedo = vColor.rgb * mix(1.0, 0.40 + 1.2 * grain, solid) * mix(1.0, 0.55 + 0.9 * runs, plate);

        // Dark lines between planks, and around steel plates. They fade out where they would be thinner than a pixel.
        float lines = seams * vUV.y;
        float sharp = 1.0 - smoothstep(0.12, 0.45, fwidth(lines));
        float gap = smoothstep(0.43, 0.49, abs(fract(lines) - 0.5)) * wood;
        vec2 cell = abs(fract(vec2(vUV.x * 0.28, lines)) - 0.5);
        gap += smoothstep(0.465, 0.495, max(cell.x, cell.y)) * plate;
        albedo *= 1.0 - 0.6 * gap * sharp;

        // Growth: pale crusts in some places, dark weed in others, and bright specks of shell.
        float patches = texture(uNoise, vUV * 0.085 + 0.37).r;
        float shells = texture(uNoise, vUV * 0.7 + 0.11).g;
        albedo = mix(albedo, vec3(0.30, 0.42, 0.31), smoothstep(0.53, 0.70, patches) * 0.6 * solid);
        albedo = mix(albedo, vec3(0.025, 0.080, 0.065), (1.0 - smoothstep(0.30, 0.47, patches)) * 0.55 * solid);
        albedo += vec3(0.30, 0.33, 0.27) * smoothstep(0.70, 0.82, shells) * 0.55 * solid;
        // Silt settles on every face that points up.
        albedo = mix(albedo, SAND * 0.9, smoothstep(0.5, 0.95, N.y) * 0.45 * solid);
        // Parts close to the sand get less scattered light, because the hull and the sand block it.
        albedo *= 0.55 + 0.45 * smoothstep(-0.5, 5.0, vHeight);

        gl_FragColor = vec4(shadeSurface(albedo, N, V, vWorld, 8.0, 0.0), 1.0);
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
  // The grid follows the camera in whole cells. Each vertex then stays on the same spot of sand.
  const snap = (c, t) => c - ((((c + t) % CELL) + CELL) % CELL);
  return {
    group,
    // Test views: ?focus=wreck looks at the sailing ship, ?focus=wreck2 at the steamer.
    target: (index) => where.set(wrecks[index].position.x, -70, wrecks[index].position.z),
    // `travel` is the distance swum so far, `velocity` the velocity of the whale.
    update(dt, camera, travel, velocity, whaleMesh) {
      floor.position.set(snap(camera.position.x, travel.x), 0, snap(camera.position.z, travel.z));
      floorMat.uniforms.uWhale.value.copy(whaleMesh.position);
      floorMat.uniforms.uWhaleDir.value.set(Math.sin(whaleMesh.rotation.y), Math.cos(whaleMesh.rotation.y));

      for (let i = 0; i < wrecks.length; i++) {
        const wreck = wrecks[i];
        wreck.position.x -= velocity.x * dt;
        wreck.position.z -= velocity.z * dt;
        if (wreck.position.z < -300 || Math.abs(wreck.position.x) > 300) place(wreck, range(330, 560));
        floorMat.uniforms.uWreck.value[i].set(wreck.position.x, wreck.position.z, Math.sin(wreck.rotation.y), Math.cos(wreck.rotation.y));
      }
    },
  };
}
