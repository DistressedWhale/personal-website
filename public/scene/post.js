import * as THREE from 'three';
import { common } from './glsl.js';
import { drawQuad, QUAD_VERTEX } from './util.js';

// The scene renders to a float target. A second pass adds the light shafts and maps the result to the screen.
// `rays` scales the strength of the light shafts.
export function createPost(renderer, shared, camera, rays) {
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: new THREE.DepthTexture(4, 4),
  });
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      ...shared,
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uInvProj: { value: camera.projectionMatrixInverse },
      uCamWorld: { value: camera.matrixWorld },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFrame: { value: 0 },
      uRays: { value: rays },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      ${common}
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      uniform float uNear, uFar, uFrame, uRays;
      varying vec2 vUv;

      const int STEPS = 44;
      const float REACH = 220.0; // metres. Shafts further away than this add nothing visible.

      float hash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }

      vec3 tonemap(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        vec3 col = texture(tColor, vUv).rgb;

        // View ray of this pixel, and how far it runs before it meets the scene or the surface.
        vec4 far = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 viewDir = normalize(far.xyz / far.w);
        vec3 dir = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
        float z = texture(tDepth, vUv).x;
        float viewZ = (uNear * uFar) / ((uFar - uNear) * z - uFar);
        float sceneDist = z >= 1.0 ? REACH : -viewZ / -viewDir.z;
        float reach = min(sceneDist, REACH);
        if (dir.y > 0.0) reach = min(reach, uCamDepth / dir.y);

        // March along the view ray and add the sunlight that the water scatters toward the eye.
        // The post pass has its own camera, so cameraPosition is not the eye here.
        vec3 eye = uCamWorld[3].xyz;
        float jitter = hash(gl_FragCoord.xy + uFrame * 7.13);
        vec3 shafts = vec3(0.0);
        // Samples sit at reach * f * f, so near water gets fine steps and far water gets coarse ones.
        for (int i = 0; i < STEPS; i++) {
          float f = (float(i) + jitter) / float(STEPS);
          float t = reach * f * f;
          float stepLen = reach * 2.0 * f / float(STEPS);
          vec3 p = eye + dir * t;
          float depth = max(-p.y, 0.0);
          vec2 sp = surfacePoint(p);
          float swell = textureLod(uSwellTex, sp / SWELL_TILE, 2.2).r;
          float fine = textureLod(uWaveTex, sp / FINE_TILE, 5.0).r;
          float beam = max(swell * mix(1.0, fine, 0.5) - 0.95, 0.0);
          beam *= sqrt(beam + 0.05);
          shafts += beam * sunAt(depth) * exp(-EXT * t) * stepLen;
        }
        // Water scatters most light forward, so the shafts are brightest toward the sun.
        float toSun = max(dot(dir, uSunWater), 0.0);
        float phase = 0.11 + 0.75 * pow(toSun, 3.0) + 0.9 * pow(toSun, 14.0);
        col += shafts * phase * uRays * vec3(0.0072, 0.0180, 0.0228);

        // Tone map, gamma, vignette, and a little grain against banding.
        col = tonemap(col * 1.35);
        col = pow(col, vec3(1.0 / 2.2));
        vec2 c = vUv - 0.5;
        col *= 1.0 - 0.42 * smoothstep(0.25, 0.95, length(c) * 1.25);
        col += (hash(gl_FragCoord.xy * 1.7 + uFrame * 17.31) - 0.5) / 255.0 * 3.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  return {
    get height() { return target.height; },
    setSize(width, height) { target.setSize(width, height); },
    // `frame` counts frames. It moves the sample jitter and the grain.
    render(scene, frame) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      material.uniforms.uFrame.value = frame % 64;
      drawQuad(renderer, material, null);
    },
  };
}

// Render scale between 0.5 and 1. It drops when frames are slow and rises again when there is headroom.
// `onChange` runs after each change.
export function createRenderScale(onChange) {
  let scale = 1;
  let slow = 0, slowTime = 0, fast = 0;
  let trial = null;     // a drop under test: the scale before it, the frame time before it, and the frames since
  let pausedUntil = 0;  // seconds
  const set = (value) => { scale = value; onChange(); };
  return {
    get value() { return scale; },
    // Call once per frame, with the clock and the time since the last frame, both in seconds.
    frame(now, frameTime) {
      // A tab that was hidden returns one very long frame. It says nothing about speed.
      if (frameTime >= 0.25 || now < pausedUntil) return;
      if (trial) {
        trial.time += frameTime;
        if (++trial.frames < 60) return;
        // If a lower scale does not shorten the frames, the GPU is not the limit. Undo the drop and try again in five minutes.
        if (trial.time / 60 > trial.before * 0.93) { pausedUntil = now + 300; set(trial.scale); }
        trial = null;
        return;
      }
      if (frameTime > 1 / 40) { slow++; slowTime += frameTime; fast = 0; }
      else if (frameTime < 1 / 57) { fast++; slow = 0; slowTime = 0; }
      if (slow > 40 && scale > 0.5) {
        trial = { scale, before: slowTime / slow, time: 0, frames: 0 };
        slow = 0; slowTime = 0;
        set(Math.max(0.5, scale * 0.85));
      }
      if (fast > 600 && scale < 1) { fast = 0; set(Math.min(1, scale / 0.9)); }
    },
  };
}
