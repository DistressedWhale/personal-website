import * as THREE from 'three';
import { common, FINE_TILE, SWELL_TILE } from './glsl.js';
import { TAU, rng, geometry, mesh, drawQuad, QUAD_VERTEX } from './util.js';

const WAVES = 14;
const SPECK_BOX = 90; // metres. The specks wrap inside a box of this size around the camera.

// One wave field: a sum of sine waves that repeats exactly over `tile` metres.
// The shader writes the caustic brightness, the height gradient and the height to a texture each frame.
function createWaveField({ tile, size, minCycles, maxCycles, steepness, focalDepth, speed, wind, seed }) {
  const rand = rng(seed);
  const waves = [], rates = [], starts = [];
  for (let i = 0; i < WAVES; i++) {
    // Whole cycles per tile on each axis keep the pattern tileable.
    const cycles = minCycles + (maxCycles - minCycles) * Math.pow((i + rand()) / WAVES, 1.4);
    const dir = wind + (rand() - 0.5) * 2.6;
    const kx = (TAU * Math.round(cycles * Math.cos(dir))) / tile;
    const kz = (TAU * (Math.round(cycles * Math.sin(dir)) || 1)) / tile;
    const k = Math.hypot(kx, kz);
    waves.push(new THREE.Vector3(kx, kz, steepness / k)); // wave vector, then amplitude
    rates.push(Math.sqrt(9.81 * k) * speed);              // deep-water waves: longer waves travel faster
    starts.push(rand() * TAU);
  }
  const target = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  const phases = new Float32Array(WAVES);
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uWaves: { value: waves }, uPhase: { value: phases }, uTile: { value: tile }, uFocalDepth: { value: focalDepth } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      #define WAVES ${WAVES}
      uniform vec3 uWaves[WAVES];
      uniform float uPhase[WAVES];
      uniform float uTile;
      uniform float uFocalDepth;
      varying vec2 vUv;
      void main() {
        vec2 x = vUv * uTile;
        float h = 0.0, hxx = 0.0, hxz = 0.0, hzz = 0.0;
        vec2 g = vec2(0.0);
        for (int i = 0; i < WAVES; i++) {
          vec2 k = uWaves[i].xy;
          float a = uWaves[i].z;
          float th = dot(k, x) + uPhase[i];
          float s = sin(th), c = cos(th);
          h += a * s;
          g += a * k * c;
          hxx -= a * k.x * k.x * s;
          hxz -= a * k.x * k.y * s;
          hzz -= a * k.y * k.y * s;
        }
        // Refraction moves each ray sideways by focalDepth * gradient. Light piles up where that map folds.
        float det = (1.0 - uFocalDepth * hxx) * (1.0 - uFocalDepth * hzz) - uFocalDepth * uFocalDepth * hxz * hxz;
        float caustic = 1.0 / max(abs(det), 0.16);
        gl_FragColor = vec4(caustic, g, h);
      }
    `,
  });
  return {
    texture: target.texture,
    update(renderer, time) {
      // JavaScript wraps the phases in double precision, so the float uniforms stay small after any run time.
      for (let i = 0; i < WAVES; i++) phases[i] = (starts[i] + rates[i] * time) % TAU;
      drawQuad(renderer, material, target);
    },
  };
}

// Open water in every direction, drawn behind everything.
function createBackdrop(shared) {
  return mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vDir;
      void main() { gl_FragColor = vec4(waterBg(normalize(vDir)), 1.0); }
    `,
  }), -10);
}

// The sea surface seen from below. The sky shows through a bright circle, the rest reflects the deep.
function createSurface(shared) {
  return mesh(new THREE.PlaneGeometry(1800, 1800).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform vec3 uSunAir;
      varying vec3 vWorld;

      vec3 sky(vec3 d) {
        vec3 c = mix(vec3(0.62, 0.80, 0.95), vec3(0.16, 0.42, 0.86), clamp(d.y, 0.0, 1.0));
        float s = max(dot(d, uSunAir), 0.0);
        c += vec3(1.0, 0.93, 0.78) * (pow(s, 900.0) * 55.0 + pow(s, 60.0) * 2.2 + pow(s, 8.0) * 0.35);
        return c;
      }

      void main() {
        vec2 p = vWorld.xz + uTravel;
        vec3 toEye = cameraPosition - vWorld;
        float dist = length(toEye);
        vec3 inc = -toEye / dist;

        vec2 g = texture(uWaveTex, p / FINE_TILE).gb * 1.5
               + texture(uWaveTex, p / (FINE_TILE * 4.0) + 0.21).gb * 0.8
               + texture(uSwellTex, p / SWELL_TILE).gb * 0.9
               + texture(uSwellTex, p / (SWELL_TILE * 4.0) + 0.37).gb * 1.0;
        vec3 n = normalize(vec3(g.x, -1.0, g.y));

        vec3 refr = refract(inc, n, 1.333);
        vec3 mirror = waterBg(reflect(inc, n)) * 0.9;
        vec3 col = mirror;
        if (dot(refr, refr) > 0.0) {
          float fres = 0.02 + 0.98 * pow(1.0 - clamp(refr.y, 0.0, 1.0), 5.0);
          col = mix(sky(refr) * vec3(0.72, 0.93, 1.0), mirror, fres);
        }
        gl_FragColor = vec4(fogged(col, vWorld), 1.0);
      }
    `,
  }));
}

// Drifting specks. They wrap inside a box around the camera, so there is always the same number in view.
function createSpecks(shared) {
  const COUNT = 9000;
  const rand = rng(3);
  const base = [], seed = [];
  for (let i = 0; i < COUNT; i++) {
    base.push(rand() * SPECK_BOX, rand() * SPECK_BOX, rand() * SPECK_BOX);
    seed.push(rand(), rand());
  }
  return new THREE.Points(geometry({ position: [base, 3], aSeed: [seed, 2] }), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uShift: { value: new THREE.Vector3() }, uFocalPx: { value: 1000 }, uSway: { value: 0 } },
    vertexShader: /* glsl */ `
      ${common}
      attribute vec2 aSeed;
      uniform vec3 uShift;
      uniform float uFocalPx;
      uniform float uSway;
      varying float vAlpha;
      varying vec3 vTint;
      const float BOX = ${SPECK_BOX.toFixed(1)};
      void main() {
        vec3 rel = mod(position - uShift - cameraPosition, BOX) - 0.5 * BOX;
        rel.y += 0.25 * sin(uSway + aSeed.x * TAU);
        rel.x += 0.20 * sin(uSway * 2.0 + aSeed.y * TAU);
        vec3 world = cameraPosition + rel;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        float d = length(rel);
        float size = mix(0.018, 0.075, aSeed.x * aSeed.x);
        gl_PointSize = clamp(size * uFocalPx / max(-mv.z, 0.1), 1.0, 26.0);
        gl_Position = projectionMatrix * mv;
        float edge = 1.0 - smoothstep(0.34 * BOX, 0.5 * BOX, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));
        float near = smoothstep(0.6, 3.5, d);
        float lit = 0.35 + 0.65 * causticAt(world);
        vec3 light = sunAt(-world.y) * lit + vec3(0.02, 0.10, 0.14);
        vTint = vec3(0.70, 0.86, 0.90) * light * exp(-EXT * d);
        vAlpha = edge * near * step(world.y, -0.3) * mix(0.25, 0.9, aSeed.y);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        float a = 1.0 - smoothstep(0.05, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vTint * a * a * vAlpha * 0.55, 1.0);
      }
    `,
  }));
}

export function createOcean(shared) {
  const fine = createWaveField({
    tile: FINE_TILE, size: 512, minCycles: 5, maxCycles: 22,
    steepness: 0.034, focalDepth: 5.0, speed: 0.55, wind: 0.9, seed: 11,
  });
  const swell = createWaveField({
    tile: SWELL_TILE, size: 256, minCycles: 4, maxCycles: 15,
    steepness: 0.040, focalDepth: 9.0, speed: 0.6, wind: 0.5, seed: 29,
  });
  shared.uWaveTex.value = fine.texture;
  shared.uSwellTex.value = swell.texture;

  const surface = createSurface(shared);
  const specks = createSpecks(shared);
  specks.frustumCulled = false;
  specks.renderOrder = 5;
  const group = new THREE.Group().add(createBackdrop(shared), surface, specks);

  return {
    group,
    // `travel` is the distance the whale has swum. `focalPx` is the focal length of the camera in pixels.
    update(renderer, time, camera, travel, focalPx) {
      fine.update(renderer, time);
      swell.update(renderer, time);
      surface.position.set(camera.position.x, 0, camera.position.z);
      const u = specks.material.uniforms;
      u.uShift.value.set(travel.x % SPECK_BOX, 0, travel.z % SPECK_BOX);
      u.uFocalPx.value = focalPx;
      u.uSway.value = (time * 0.35) % TAU;
    },
  };
}
