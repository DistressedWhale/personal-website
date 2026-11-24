import * as THREE from 'three';

// Small seeded generator, so the scene looks the same on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gradient noise on a lattice that repeats every `period` cells, so the texture tiles.
function periodicNoise(period, rand) {
  const grad = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) {
    const a = rand() * Math.PI * 2;
    grad[i * 2] = Math.cos(a);
    grad[i * 2 + 1] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, dx, dy) => {
    const i = ((iy % period) * period + (ix % period)) * 2;
    return grad[i] * dx + grad[i + 1] * dy;
  };
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const u = fade(fx), v = fade(fy);
    const a = dot(x0, y0, fx, fy), b = dot(x0 + 1, y0, fx - 1, fy);
    const c = dot(x0, y0 + 1, fx, fy - 1), d = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Tileable fractal noise. Each channel holds an independent pattern in the range 0..1.
export function makeNoiseTexture(size = 256, seed = 7) {
  const rand = rng(seed);
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const octaves = [4, 8, 16, 32, 64].map((p) => periodicNoise(p, rand));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, amp = 0.5, period = 4;
        for (const n of octaves) {
          sum += amp * n((x / size) * period, (y / size) * period);
          amp *= 0.55;
          period *= 2;
        }
        data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, (sum * 0.9 + 0.5) * 255));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
