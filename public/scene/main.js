import * as THREE from 'three';
import { NOISE_SIZE, TERRAIN_TILE, LOOP } from './glsl.js';
import { rng } from './util.js';
import { makeNoiseTexture } from './noise.js';
import { createOcean } from './ocean.js';
import { createWhale } from './whale.js';
import { createFish } from './fish.js';
import { createTuna, createPilotFish } from './packs.js';
import { createMantas } from './manta.js';
import { createJellies } from './jelly.js';
import { createSeafloor } from './seafloor.js';
import { createChaseCamera } from './camera.js';
import { createPost, createRenderScale } from './post.js';

// 23040 m is the least common multiple of the 512 m terrain tile and the 90 m speck box, so the wrap is invisible.
const TRAVEL_WRAP = 23040;
const canvas = document.getElementById('scene');

// Test views from the address bar: ?t=120&az=0.5&el=0.2&dist=40&rays=0&focus=wreck&still
const query = new URLSearchParams(location.search);
const num = (key) => { const v = parseFloat(query.get(key)); return Number.isFinite(v) ? v : null; };
const still = query.has('still'); // freezes time, so two captures of one view match

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;

  // Sun above the water, a little ahead of the whale. Refraction makes the light steeper under water.
  const sunAir = new THREE.Vector3(0.28, 0.80, 0.53).normalize();
  const cosAir = sunAir.y;
  const sinWater = Math.sqrt(1 - cosAir * cosAir) / 1.333;
  const flat = new THREE.Vector2(sunAir.x, sunAir.z).normalize().multiplyScalar(sinWater);
  const sunWater = new THREE.Vector3(flat.x, Math.sqrt(1 - sinWater * sinWater), flat.y);

  // Uniforms that every material shares. glsl.js describes them.
  const shared = {
    uWaveTex: { value: null },
    uSwellTex: { value: null },
    uNoise: { value: makeNoiseTexture(NOISE_SIZE, 7) },
    uSunWater: { value: sunWater },
    uSunAir: { value: sunAir },
    uTravel: { value: new THREE.Vector2() },
    uCamDepth: { value: 15 },
    uLoop: { value: 0 },
  };

  const ocean = createOcean(shared);
  const whale = createWhale(shared);
  const fish = createFish(shared);
  const rand = rng(1234); // one stream of random numbers places the animals below
  const tuna = createTuna(shared, rand, fish.prey);
  const pilotFish = createPilotFish(shared, rand, whale.mesh);
  const mantas = createMantas(shared, rand);
  const jellies = createJellies(shared, rand);
  const seafloor = createSeafloor(shared);
  const scene = new THREE.Scene().add(
    ocean.group, whale.mesh, fish.mesh, tuna.group, pilotFish.group, mantas.group, jellies.group, seafloor.group);
  const threats = [...tuna.threats, ...mantas.threats]; // animals that the sardines flee from

  const rig = createChaseCamera(canvas, { az: num('az'), el: num('el'), dist: num('dist') });
  const { camera } = rig;
  const post = createPost(renderer, shared, camera, num('rays') ?? 1);

  // ?focus=<name> points the camera at something other than the whale.
  const targets = { tuna: tuna.target, manta: mantas.target, jelly: jellies.target, ...fish.targets, ...seafloor.targets };
  const focus = Object.hasOwn(targets, query.get('focus')) ? targets[query.get('focus')] : null;

  const renderScale = createRenderScale(resize);
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * renderScale.value;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    post.setSize(Math.max(2, Math.floor(w * ratio)), Math.max(2, Math.floor(h * ratio)));
    rig.resize(w / h);
  }
  window.addEventListener('resize', resize);
  resize();

  let time = num('t') ?? 0;         // seconds of scene time
  let frame = 0;
  let last = 0;                     // clock at the previous frame, in milliseconds
  const travel = new THREE.Vector3(); // distance the whale has swum

  function tick(now) {
    const frameTime = (now - last) / 1000;
    last = now;
    const dt = still ? 0 : Math.min(frameTime, 0.1);
    time += dt;
    if (!still) frame++;

    // The whale stays near the origin. The water, and everything in it, moves the other way.
    whale.update(time, dt);
    const { velocity } = whale;
    travel.addScaledVector(velocity, dt);
    travel.x %= TRAVEL_WRAP;
    travel.z %= TRAVEL_WRAP;
    shared.uTravel.value.set(travel.x % TERRAIN_TILE, travel.z % TERRAIN_TILE);
    shared.uLoop.value = time % LOOP;

    tuna.update(dt, velocity, whale.mesh.position.y);
    pilotFish.update(dt);
    mantas.update(dt, velocity);
    jellies.update(dt, velocity);
    fish.update(time, dt, velocity, threats, whale.mesh);

    rig.update(time, dt, focus ? focus() : whale.focus, whale.mesh.rotation.y, !!focus);
    shared.uCamDepth.value = -camera.position.y;
    seafloor.update(dt, camera, travel, velocity, whale.mesh);
    const focalPx = post.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    ocean.update(renderer, time, camera, travel, focalPx);
    post.render(scene, frame);

    renderScale.frame(now / 1000, frameTime);
    requestAnimationFrame(tick);
  }

  window.__scene = { renderer, camera, whale, fish, get time() { return time; } }; // for the test scripts
  requestAnimationFrame((now) => { last = now; tick(now); });
}

try {
  start();
  document.documentElement.classList.add('live');
} catch (err) {
  console.error(err);
  document.documentElement.classList.add('no-webgl');
}
