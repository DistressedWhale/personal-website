import * as THREE from 'three';
import { rng, TAU } from './util.js';

// Gradient noise on a lattice that repeats every `period` cells, so the texture tiles.
function periodicNoise(period, rand) {
  const grad = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) {
    const a = rand() * TAU;
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

// Tileable fractal noise. Each of the four channels holds an independent pattern in the range 0..1.
export function makeNoiseTexture(size, seed) {
  const rand = rng(seed);
  const data = new Uint8Array(size * size * 4);
  for (let channel = 0; channel < 4; channel++) {
    const octaves = [4, 8, 16, 32, 64].map((period) => ({ period, noise: periodicNoise(period, rand) }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, amp = 0.5;
        for (const { period, noise } of octaves) {
          sum += amp * noise((x / size) * period, (y / size) * period);
          amp *= 0.55;
        }
        data[(y * size + x) * 4 + channel] = Math.max(0, Math.min(255, (sum * 0.9 + 0.5) * 255));
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
