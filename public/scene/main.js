import * as THREE from 'three';
import { common } from './glsl.js';
import { makeNoiseTexture } from './noise.js';
import { createOcean } from './ocean.js';
import { createWhale } from './whale.js';
import { createFish } from './fish.js';
import { createCreatures } from './creatures.js';

const TAU = Math.PI * 2;
const canvas = document.getElementById('scene');
const query = new URLSearchParams(location.search);
const num = (key) => (query.has(key) ? parseFloat(query.get(key)) : null);

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
  renderer.autoClear = false;

  // Sun above the water, a little ahead of the whale. Refraction makes the light steeper under water.
  const sunAir = new THREE.Vector3(0.28, 0.80, 0.53).normalize();
  const cosAir = sunAir.y;
  const sinWater = Math.sqrt(1 - cosAir * cosAir) / 1.333;
  const flat = new THREE.Vector2(sunAir.x, sunAir.z).normalize().multiplyScalar(sinWater);
  const sunWater = new THREE.Vector3(flat.x, Math.sqrt(1 - sinWater * sinWater), flat.y);

  const shared = {
    uWaveTex: { value: null },
    uSwellTex: { value: null },
    uSunDir: { value: sunWater },
    uSunAir: { value: sunAir },
    uTravel: { value: new THREE.Vector2() },
    uCamDepth: { value: 15 },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 1500);
  const noise = makeNoiseTexture(256, 7);

  const ocean = createOcean(shared);
  scene.add(ocean.group);

  const whale = createWhale(shared, noise);
  scene.add(whale.mesh);

  const fish = createFish(shared);
  scene.add(fish.mesh);

  const creatures = createCreatures(shared, noise, whale.mesh);
  scene.add(creatures.group);

  // The scene renders to a float target. A second pass adds the light shafts and maps the result to the screen.
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: new THREE.DepthTexture(4, 4),
  });
  target.depthTexture.type = THREE.UnsignedIntType;
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;

  const post = new THREE.ShaderMaterial({
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
      uRays: { value: num('rays') ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      uniform float uNear, uFar, uFrame, uRays;
      varying vec2 vUv;

      const int STEPS = 44;
      const float REACH = 220.0;

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

        vec4 far = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 viewDir = normalize(far.xyz / far.w);
        vec3 dir = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);

        float z = texture(tDepth, vUv).x;
        float viewZ = (uNear * uFar) / ((uFar - uNear) * z - uFar);
        float sceneDist = z >= 1.0 ? REACH : -viewZ / -viewDir.z;
        float reach = min(sceneDist, REACH);
        if (dir.y > 0.0) reach = min(reach, uCamDepth / dir.y);

        // March along the view ray and add the sunlight that the water scatters toward the eye.
        float jitter = hash(gl_FragCoord.xy + uFrame * 7.13);
        // Steps grow with distance. Near water gets fine steps, far water gets coarse ones.
        vec3 shafts = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          float f = (float(i) + jitter) / float(STEPS);
          float t = reach * f * f;
          float stepLen = reach * 2.0 * f / float(STEPS);
          vec3 p = cameraPosition + dir * t;
          float depth = max(-p.y, 0.0);
          vec2 sp = surfacePoint(p);
          float swell = textureLod(uSwellTex, sp / SWELL_TILE, 2.2).r;
          float fine = textureLod(uWaveTex, sp / FINE_TILE, 5.0).r;
          float beam = max(swell * mix(1.0, fine, 0.5) - 0.95, 0.0);
          beam *= sqrt(beam + 0.05);
          shafts += beam * sunAt(depth) * exp(-EXT * t) * stepLen;
        }
        float toSun = max(dot(dir, uSunDir), 0.0);
        float phase = 0.11 + 0.75 * pow(toSun, 3.0) + 0.9 * pow(toSun, 14.0);
        col += shafts * phase * uRays * vec3(0.0060, 0.0150, 0.0190);

        col = tonemap(col * 1.35);
        col = pow(col, vec3(1.0 / 2.2));

        vec2 c = vUv - 0.5;
        col *= 1.0 - 0.42 * smoothstep(0.25, 0.95, length(c) * 1.25);
        col += (hash(gl_FragCoord.xy * 1.7 + uFrame * 17.31) - 0.5) / 255.0 * 3.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const postScene = new THREE.Scene();
  const postMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  postMesh.frustumCulled = false;
  postScene.add(postMesh);
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // The render scale drops when frames are slow and rises again when there is headroom.
  let scale = 1;
  let targetHeight = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * scale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    const pw = Math.max(2, Math.floor(w * ratio)), ph = Math.max(2, Math.floor(h * ratio));
    target.setSize(pw, ph);
    targetHeight = ph;
    camera.aspect = w / h;
    // A tall screen needs a wider lens, or the whale does not fit.
    camera.fov = w / h < 1 ? 62 : 46;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Moving the mouse nudges the camera. Dragging turns it around the whale.
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  const drag = { active: false, id: -1, x: 0, y: 0, az: 0, el: 0, idle: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag.active = true;
    drag.id = e.pointerId;
    drag.x = e.clientX;
    drag.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (drag.active && e.pointerId === drag.id) {
      const span = Math.min(window.innerWidth, window.innerHeight);
      drag.az -= ((e.clientX - drag.x) / span) * 3.2;
      drag.el += ((e.clientY - drag.y) / span) * 2.4;
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else if (e.pointerType === 'mouse') {
      pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    }
  });
  const release = (e) => {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.active = false;
    drag.idle = 0;
    // Keep the angle within half a turn, so the camera goes home the short way.
    drag.az = ((((drag.az + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    canvas.classList.remove('dragging');
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Fixed values from the address bar, for checking one view: ?t=120&az=0.5&el=0.2&dist=40
  const fixed = { az: num('az'), el: num('el'), dist: num('dist') };
  const focus = query.get('focus');
  const still = query.has('still');

  let time = num('t') ?? 0;
  let swimPhase = 0;
  let flipPhase = 0;
  let frame = 0;
  const travel = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let last = performance.now();
  let slow = 0, fast = 0;

  function update(dt) {
    // Stroke and glide: the whale beats its tail hard for a while, then eases off.
    const effort = 0.62 + 0.38 * Math.sin(time * 0.083) * Math.sin(time * 0.031 + 1.0);
    const speed = 2.6 + 1.6 * effort;
    swimPhase = (swimPhase + dt * TAU * (0.13 + 0.10 * effort)) % TAU;
    flipPhase = (flipPhase + dt * 0.45) % TAU;

    const depth = -17 + 6.5 * Math.sin(time * 0.027) + 3.0 * Math.sin(time * 0.0113 + 2.0);
    const climb = 6.5 * 0.027 * Math.cos(time * 0.027) + 3.0 * 0.0113 * Math.cos(time * 0.0113 + 2.0);
    const yaw = 0.16 * Math.sin(time * 0.019) + 0.08 * Math.sin(time * 0.043 + 0.7);
    const yawRate = 0.16 * 0.019 * Math.cos(time * 0.019) + 0.08 * 0.043 * Math.cos(time * 0.043 + 0.7);

    // The body rocks against the tail stroke.
    const recoil = Math.sin(swimPhase - 0.9) * effort;
    whale.mesh.position.set(0, depth + 0.10 * recoil, 0);
    whale.mesh.rotation.set(-(Math.atan2(climb, speed) * 1.6 + 0.018 * recoil), yaw, -yawRate * 22 + 0.03 * Math.sin(time * 0.07));
    whale.uniforms.uPhase.value = swimPhase;
    whale.uniforms.uAmp.value = 0.75 + 0.95 * effort;
    whale.uniforms.uFlip.value = flipPhase;

    velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    travel.addScaledVector(velocity, dt);
    // Each wrap length is a whole number of pattern repeats, so the wrap is invisible.
    travel.x %= 23040;
    travel.z %= 23040;
    shared.uTravel.value.set(travel.x % 512, travel.z % 512);

    // Chase camera. It drifts around the rear of the whale and never settles.
    fish.update(time, dt, velocity);
    creatures.update(time, dt, velocity);

    // After a drag the camera holds the chosen view for a few seconds, then eases back to its own path.
    if (drag.active) {
      pointerSmooth.multiplyScalar(Math.exp(-dt * 4));
    } else {
      pointerSmooth.lerp(pointer, 1 - Math.exp(-dt * 2.5));
      drag.idle += dt;
      if (drag.idle > 6) {
        const ease = Math.exp(-dt * 0.35);
        drag.az *= ease;
        drag.el *= ease;
      }
    }
    // On a tall screen a side view cuts the whale off, so the camera stays closer to the rear.
    const tall = camera.aspect < 1;
    const pathAz = fixed.az ?? (1.05 * Math.sin(time * 0.0310 + 0.9) + 0.70 * Math.sin(time * 0.0173 + 1.3)) * (tall ? 0.28 : 1);
    const az = pathAz + pointerSmooth.x * 0.25 + drag.az;
    // Straight behind, a level view hides the body. The camera rises there to show the back.
    const pathEl = fixed.el ?? 0.02 + 0.30 * Math.sin(time * 0.0230 + 2.1) + 0.14 * Math.sin(time * 0.0097) + 0.34 * Math.cos(pathAz) ** 2;
    const el = THREE.MathUtils.clamp(pathEl - pointerSmooth.y * 0.15 + drag.el, -1.35, 1.35);
    drag.el = THREE.MathUtils.clamp(drag.el, -1.35 - pathEl, 1.35 - pathEl);
    const dist = (fixed.dist ?? 35 + 7 * Math.sin(time * 0.0170 + 2.0) + 4 * Math.sin(time * 0.0071)) * (tall ? 1.45 : 1);
    lookAt.set(Math.sin(yaw) * 3, depth + 0.5, Math.cos(yaw) * 3);
    if (focus && creatures.targets[focus]) lookAt.copy(creatures.targets[focus]());
    camera.position.set(
      lookAt.x + Math.sin(az + yaw) * Math.cos(el) * dist,
      Math.min(lookAt.y + Math.sin(el) * dist, -4.5),
      lookAt.z - Math.cos(az + yaw) * Math.cos(el) * dist,
    );
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    shared.uCamDepth.value = -camera.position.y;
  }

  function render() {
    const pixels = targetHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    ocean.update(renderer, time, camera, travel, pixels);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    post.uniforms.uFrame.value = frame % 64;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
  }

  function tick(now) {
    const raw = (now - last) / 1000;
    last = now;
    const dt = still ? 0 : Math.min(raw, 0.1);
    time += dt;
    frame++;
    update(dt);
    render();

    if (raw > 1 / 40) { slow++; fast = 0; } else if (raw < 1 / 57) { fast++; slow = 0; }
    if (slow > 40 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slow = 0; resize(); }
    if (fast > 600 && scale < 1) { scale = Math.min(1, scale / 0.9); fast = 0; resize(); }
    requestAnimationFrame(tick);
  }

  window.__scene = { renderer, camera, whale, get time() { return time; } };
  requestAnimationFrame((now) => { last = now; tick(now); });
}

try {
  start();
  document.documentElement.classList.add('live');
} catch (err) {
  console.error(err);
  document.documentElement.classList.add('no-webgl');
}
