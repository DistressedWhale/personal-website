import * as THREE from 'three';
import { common } from './glsl.js';
import { TAU, rng, geometry, mesh, gridIndices } from './util.js';

// Jellyfish: a bell that pulses, with thin tentacles and four frilled arms. Drawn as soft glowing glass.
// They hang in loose blooms while the whale swims past.

const BLOOMS = 2, PER_BLOOM = 42;

// The shader shapes each vertex from three numbers: aBell (0 at the top of the bell .. 1 at its rim),
// aHang (0 on the bell, else 0..1 down a ribbon) and aAround (the angle around the upright axis).
function jellyGeometry() {
  const pos = [], bell = [], hang = [], around = [];
  const RINGS = 9, SIDES = 16;
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j <= SIDES; j++) {
      pos.push(0, 0, 0);
      bell.push(i / RINGS); hang.push(0); around.push((j / SIDES) * TAU);
    }
  }
  const idx = gridIndices(RINGS, SIDES);
  // A ribbon stores its half width in position.x, its radius from the centre in position.y, and its length in position.z.
  const ribbon = (angle, radius, length, width, segments) => {
    idx.push(...gridIndices(segments, 1, pos.length / 3));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      for (const sign of [-1, 1]) {
        pos.push(sign * width * (1 - 0.7 * t), radius, length);
        bell.push(1); hang.push(Math.max(t, 0.001)); around.push(angle);
      }
    }
  };
  for (let k = 0; k < 10; k++) ribbon((k / 10) * TAU + 0.2, 0.96, 3.2 + (k % 3) * 0.6, 0.022, 10); // tentacles
  for (let k = 0; k < 4; k++) ribbon((k / 4) * TAU + 0.7, 0.22, 1.7, 0.16, 8);                     // arms
  return geometry({ position: [pos, 3], aBell: [bell, 1], aHang: [hang, 1], aAround: [around, 1] }, idx, THREE.InstancedBufferGeometry);
}

// `rand` places the blooms. The jellies inside a bloom have their own fixed layout.
export function createJellies(shared, rand) {
  const layout = rng(77);
  const place = [], vary = [];
  for (let i = 0; i < BLOOMS * PER_BLOOM; i++) {
    // Offset inside the bloom, then the bloom index.
    place.push((layout() - 0.5) * 50, (layout() - 0.5) * 16, (layout() - 0.5) * 50, Math.floor(i / PER_BLOOM));
    // phase, bell radius in metres, pulses per loop, tint. The pulse count is even, because the tentacle radius wobbles at half the pulse rate.
    vary.push(layout() * TAU, 0.30 + layout() * layout() * 0.6, 2 * Math.round(75 + layout() * 55), layout());
  }
  const geo = jellyGeometry();
  geo.setAttribute('aPlace', new THREE.InstancedBufferAttribute(new Float32Array(place), 4));
  geo.setAttribute('aVary', new THREE.InstancedBufferAttribute(new Float32Array(vary), 4));
  geo.instanceCount = BLOOMS * PER_BLOOM;

  const centres = Array.from({ length: BLOOMS }, () => new THREE.Vector3());
  const move = (centre, z) => centre.set(rand.range(16, 42) * rand.sign(), rand.range(-30, -13), z);
  move(centres[0], 95);
  move(centres[1], 230);

  const jellies = mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uBloom: { value: centres } },
    vertexShader: /* glsl */ `
      ${common}
      attribute float aBell, aHang, aAround;
      attribute vec4 aPlace, aVary;
      uniform vec3 uBloom[${BLOOMS}];
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vRibbon;
      void main() {
        float w = TAU / LOOP * uLoop;
        float pulse = w * aVary.z + aVary.x;
        // The bell snaps shut and opens slowly.
        float squeeze = pow(0.5 + 0.5 * sin(pulse), 2.5);
        float cs = cos(aAround), sn = sin(aAround);
        vec3 p, n;
        if (aHang > 0.0) {
          // A ribbon hangs from the bell and trails each pulse.
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
        // A jelly fades out close to the camera, so it never fills the screen.
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
  }), 4);

  return {
    group: jellies,
    target: () => centres[0],
    // `velocity` is the velocity of the whale. The blooms stay in place in the water.
    update(dt, velocity) {
      for (const centre of centres) {
        centre.x -= velocity.x * dt;
        centre.z -= velocity.z * dt;
        if (centre.z < -150 || Math.abs(centre.x) > 150) move(centre, rand.range(170, 300));
      }
    },
  };
}
