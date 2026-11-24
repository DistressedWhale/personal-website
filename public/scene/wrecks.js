import * as THREE from 'three';
import { rng } from './noise.js';

// Shipwreck models. Each function returns one geometry with position, normal, colour and a texture coordinate in metres.
// Local axes: +Z is the bow, +Y is up, and y = 0 is the sand.

// Surface colours. The fourth number is the seam count per metre: planks for wood, plates for steel, 0 for none.
const WOOD = [0.200, 0.150, 0.105, 2.5];
const WOOD_PALE = [0.420, 0.360, 0.270, 2.5];
const WOOD_DARK = [0.070, 0.055, 0.042, 2.5];
const IRON = [0.040, 0.042, 0.048, 0];
const RUST = [0.260, 0.130, 0.080, 0.6];
const RUST_DARK = [0.100, 0.055, 0.040, 0.6];
const RUST_PALE = [0.400, 0.250, 0.150, 0.6];
const PAINT = [0.550, 0.550, 0.500, 0.6];
const ROPE = [0.300, 0.270, 0.190, 0];
const VOID = [0.008, 0.010, 0.013, 0]; // an opening that shows the dark inside

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3]];
const pose = (at = [0, 0, 0], rot = [0, 0, 0]) => new THREE.Matrix4().compose(
  new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')), new THREE.Vector3(1, 1, 1));

// Collects triangles from many parts into one geometry. `at` applies a transform to all parts made inside it.
function makeBuilder() {
  const pos = [], nor = [], col = [], uvs = [];
  let frame = new THREE.Matrix4();
  let parts = 0;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const emit = (point, normal, color, u, v) => {
    p.set(...point).applyMatrix4(frame);
    n.set(...normal).transformDirection(frame);
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(...color); uvs.push(u, v);
  };
  const b = {
    at(matrix, make) {
      const outer = frame;
      frame = outer.clone().multiply(matrix);
      make();
      frame = outer;
    },
    // A three.js geometry, in one colour. Each part gets its own tone, so that equal parts do not look identical.
    add(geometry, color, matrix) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (matrix) g.applyMatrix4(matrix);
      const gp = g.getAttribute('position').array, gn = g.getAttribute('normal').array;
      // The texture runs along the longest side of the part.
      g.computeBoundingBox();
      const size = g.boundingBox.getSize(new THREE.Vector3()).toArray();
      const long = size.indexOf(Math.max(...size)), a1 = (long + 1) % 3, a2 = (long + 2) % 3;
      const id = ++parts;
      const toned = shade(color, 0.72 + 0.56 * hash(id, 17));
      for (let i = 0; i < gp.length; i += 3) {
        emit([gp[i], gp[i + 1], gp[i + 2]], [gn[i], gn[i + 1], gn[i + 2]], toned, gp[i + long] + id * 3.7, gp[i + a1] + gp[i + a2] + id * 1.3);
      }
    },
    box(size, at, rot, color) { b.add(new THREE.BoxGeometry(...size), color, pose(at, rot)); },
    // A round bar between two points.
    spar(from, to, r0, color, r1 = r0 * 0.8, sides = 7) {
      const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      const m = new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      b.add(new THREE.CylinderGeometry(r1, r0, a.distanceTo(c), sides, 1), color, m);
    },
    // A bar that follows a list of points.
    line(points, r, color) { for (let i = 0; i < points.length - 1; i++) b.spar(points[i], points[i + 1], r, color, r, 5); },
    // A curved surface fn(u, v). `keep` drops single cells, which makes holes. `color` may be a function of the cell.
    patch(fn, { u = [0, 1], v = [0, 1], nu, nv, keep, color }) {
      const at = (i, j) => [u[0] + (u[1] - u[0]) * i / nu, v[0] + (v[1] - v[0]) * j / nv];
      const normal = (uu, vv) => {
        const e = 1e-3, a = fn(uu + e, vv), c = fn(uu - e, vv), d = fn(uu, vv + e), f = fn(uu, vv - e);
        const du = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], dv = [d[0] - f[0], d[1] - f[1], d[2] - f[2]];
        const x = du[1] * dv[2] - du[2] * dv[1], y = du[2] * dv[0] - du[0] * dv[2], z = du[0] * dv[1] - du[1] * dv[0];
        const len = Math.hypot(x, y, z);
        return len > 1e-9 ? [x / len, y / len, z / len] : [0, 1, 0];
      };
      // Size of the patch in metres, measured through its middle. The texture runs along the longer side.
      const span = (from, to) => {
        let sum = 0, last = fn(...from(0));
        for (let k = 1; k <= 8; k++) {
          const next = fn(...from(k / 8));
          sum += Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]);
          last = next;
        }
        return sum;
      };
      const midU = (u[0] + u[1]) / 2, midV = (v[0] + v[1]) / 2;
      const lenU = span((t) => [u[0] + (u[1] - u[0]) * t, midV]), lenV = span((t) => [midU, v[0] + (v[1] - v[0]) * t]);
      const id = ++parts;
      const texture = (i, j) => (lenU >= lenV
        ? [(i / nu) * lenU + id * 3.7, (j / nv) * lenV + id * 1.3]
        : [(j / nv) * lenV + id * 3.7, (i / nu) * lenU + id * 1.3]);
      const grid = [[0, 0], [1, 0], [0, 1], [1, 1]];
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const mid = at(i + 0.5, j + 0.5);
          if (keep && !keep(i, j, mid[0], mid[1])) continue;
          const c = typeof color === 'function' ? color(i, j, mid[0], mid[1]) : color;
          for (const k of [0, 1, 2, 1, 3, 2]) {
            const corner = at(i + grid[k][0], j + grid[k][1]);
            emit(fn(...corner), normal(...corner), c, ...texture(i + grid[k][0], j + grid[k][1]));
          }
        }
      }
    },
    build() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 4));
      geo.setAttribute('aUV', new THREE.Float32BufferAttribute(uvs, 2));
      return geo;
    },
  };
  return b;
}

// Hull surface. u runs from stern to bow. v runs from the port rail, under the keel, to the starboard rail.
function hullShape({ length, beam, breadth, depth, sheer, flare, bilge }) {
  return (u, v, inset = 1) => {
    const th = (v - 0.5) * Math.PI;
    const s = Math.sin(th), c = Math.max(Math.cos(th), 0);
    return [
      (beam / 2) * breadth(u) * inset * Math.sign(s) * Math.pow(Math.abs(s), flare),
      sheer(u) - depth(u) * inset * Math.pow(c, bilge),
      (u - 0.5) * length,
    ];
  };
}

// Things that lie on the sand around a wreck: loose timbers or plates, at random angles.
function scatter(b, rand, count, near, far, make) {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, r = near + (far - near) * rand();
    b.at(pose([Math.cos(a) * r * 0.6, 0, Math.sin(a) * r], [0, rand() * Math.PI * 2, 0]), () => make(i));
  }
}

const lifeboat = hullShape({
  length: 6.2, beam: 2.0, flare: 0.8, bilge: 0.6,
  breadth: (u) => Math.pow(Math.max(4 * u * (1 - u), 0), 0.5), depth: () => 0.85, sheer: () => 0,
});

function anchor(b, size, color) {
  b.spar([0, 0.12, -1.5 * size], [0, 0.12, 1.5 * size], 0.09 * size, color, 0.075 * size);
  b.spar([-1.1 * size, 0.12, 1.4 * size], [1.1 * size, 0.12, 1.4 * size], 0.07 * size, color);   // stock
  for (const side of [-1, 1]) {
    b.line([[0, 0.12, -1.5 * size], [0.35 * size, 0.45 * size * side, -1.35 * size], [0.6 * size, 0.85 * size * side, -0.95 * size]], 0.075 * size, color);
    b.box([0.07 * size, 0.42 * size, 0.42 * size], [0.62 * size, 0.88 * size * side, -0.9 * size], [0.5 * side, 0, 0.6], color);
  }
}

export function sailingShip() {
  const b = makeBuilder();
  const rand = rng(91);
  const L = 36, B = 9, D = 5.6;
  const spec = {
    length: L, beam: B, flare: 0.75, bilge: 0.7,
    breadth: (u) => (u < 0.45 ? 1 - 0.42 * Math.pow(1 - u / 0.45, 2) : Math.pow(Math.max(1 - Math.pow((u - 0.45) / 0.55, 2.4), 0), 0.62)),
    depth: (u) => D * (0.7 + 0.3 * smooth(0, 0.3, u)) * (1 - 0.3 * smooth(0.85, 1, u)),
    sheer: (u) => 0.4 + 2.2 * Math.pow(Math.max(0, 0.32 - u) / 0.32, 1.4) + 1.5 * Math.pow(Math.max(0, u - 0.72) / 0.28, 2),
  };
  const hull = hullShape(spec);
  const z = (u) => (u - 0.5) * L;
  const half = (u) => (B / 2) * spec.breadth(u);
  const MAIN = -0.5, QUARTER = 1.9, FORE = 1.2; // deck heights

  // The ship lies over on her starboard side, with the keel under the sand.
  b.at(pose([0, D - 2.3, 0], [0, 0, -0.30]), () => {
    // Planking. Planks are missing in runs, most of them near the stern and around one large hole.
    b.patch(hull, {
      nu: 42, nv: 14,
      keep: (i, j, u, v) => {
        const hole = 0.9 * Math.exp(-Math.pow((u - 0.60) / 0.07, 2) - Math.pow((v - 0.22) / 0.13, 2));
        const rot = 0.08 + 0.5 * smooth(0.42, 0.04, u) + 0.25 * smooth(0.25, 0.0, Math.min(v, 1 - v));
        return hash(Math.floor(i / 3), j) > rot + hole;
      },
      color: (i, j) => shade(WOOD, 0.8 + 0.4 * hash(Math.floor(i / 3) + 40, j)),
    });
    // Frames, just inside the planking. Many have lost their tops.
    for (let u = 0.03; u < 0.97; u += 1.3 / L) {
      const k = Math.round(u * 100);
      b.patch((s, v) => hull(u + s * 0.34 / L, v, 0.94), {
        v: [0.5 - 0.30 - 0.20 * hash(k, 1), 0.5 + 0.30 + 0.20 * hash(k, 2)], nu: 1, nv: 12, color: WOOD_DARK,
      });
    }
    b.box([0.55, 0.65, L * 0.9], [0, 0.4 - D * 0.985, -0.6], [0, 0, 0], WOOD_DARK); // keel
    const stem = [];
    for (let u = 0.80; u <= 1.0001; u += 0.04) stem.push(hull(Math.min(u, 0.999), 0.5, 1.02));
    stem.push([0, spec.sheer(1) + 1.6, z(1) + 0.5]);
    b.line(stem, 0.3, WOOD_DARK);
    b.spar([0, 0.4 - D * 0.7, z(0.005)], [0, spec.sheer(0) + 0.3, z(0) - 0.35], 0.3, WOOD_DARK);
    b.box([0.22, 4.4, 1.9], [0.5, -2.4, z(0) - 1.2], [0.5, 0, 0], WOOD);              // rudder, swung over

    // Flat stern with a row of cabin windows.
    b.patch((s, t) => { const e = hull(0.012, s); return [e[0] * (1 - t), e[1] + (spec.sheer(0) - 0.1 - e[1]) * t, e[2]]; }, {
      nu: 12, nv: 4, keep: (i, j) => hash(i + 7, j + 3) > 0.14, color: (i, j) => shade(WOOD, 0.85 + 0.3 * hash(i, j + 9)),
    });
    for (let k = -2; k <= 2; k++) b.box([0.62, 0.8, 0.08], [k * 0.95, 1.25, z(0.012) - 0.06], [0, 0, 0], VOID);
    b.box([5.4, 0.16, 0.3], [0, 0.72, z(0.012) - 0.12], [0, 0, 0], WOOD_PALE);
    b.box([5.4, 0.16, 0.3], [0, 1.78, z(0.012) - 0.12], [0, 0, 0], WOOD_PALE);

    // Decks. `gone` is the share of planks that have fallen in.
    const deck = (u0, u1, y, gone, hatch) => {
      b.patch((u, w) => [(w * 2 - 1) * half(u) * 0.93, y, z(u)], {
        u: [u0, u1], nu: Math.round((u1 - u0) * 60), nv: 12,
        keep: (i, j, u, w) => hash(Math.floor(i / 4) + Math.round(y * 9), j) > gone
          && !(hatch && Math.abs(u - hatch) < 0.04 && Math.abs(w - 0.5) < 0.17),
        color: (i, j) => shade(WOOD_PALE, 0.75 + 0.4 * hash(Math.floor(i / 4), j + 20)),
      });
      for (let u = u0 + 0.01; u < u1; u += 2.1 / L) b.box([half(u) * 1.86, 0.22, 0.24], [0, y - 0.14, z(u)], [0, 0, 0], WOOD_DARK);
    };
    deck(0.31, 0.80, MAIN, 0.30, 0.56);
    deck(0.03, 0.30, QUARTER, 0.38);
    deck(0.81, 0.965, FORE, 0.26);
    // Coaming around the main hatch.
    for (const s of [-1, 1]) {
      b.box([0.16, 0.4, 2.9], [s * 1.45, MAIN + 0.2, z(0.56)], [0, 0, 0], WOOD_DARK);
      b.box([3.05, 0.4, 0.16], [0, MAIN + 0.2, z(0.56) + s * 1.45], [0, 0, 0], WOOD_DARK);
    }
    // Walls at the breaks between decks, each with a door.
    const wall = (u, y0, y1) => {
      b.patch((w, t) => [(w * 2 - 1) * half(u) * 0.93, y0 + (y1 - y0) * t, z(u)], {
        nu: 10, nv: 3, keep: (i, j) => hash(i + 31, j + Math.round(u * 50)) > 0.12 && !(i >= 4 && i <= 5 && j < 2),
        color: (i, j) => shade(WOOD, 0.85 + 0.3 * hash(i + 3, j)),
      });
    };
    wall(0.305, MAIN, QUARTER);
    wall(0.805, MAIN, FORE);

    // Rail on top of each side, with gaps.
    for (const side of [0, 1]) {
      for (let i = 0; i < 26; i++) {
        if (hash(i, side + 60) < 0.36) continue;
        const u0 = 0.03 + i * 0.036, u1 = u0 + 0.036;
        const a = hull(u0, side), c = hull(u1, side);
        b.spar([a[0], a[1] + 0.85, a[2]], [c[0], c[1] + 0.85, c[2]], 0.09, WOOD_PALE, 0.09, 5);
        b.spar(a, [a[0], a[1] + 0.85, a[2]], 0.07, WOOD, 0.07, 5);
      }
    }

    // Main mast: still up, broken above the top platform. Its yard hangs by one end.
    const foot = [0, 0.4 - D * 0.9, z(0.53)], top = [0.5, 11.2, z(0.52)], peak = [0.75, 15.6, z(0.515)];
    b.spar(foot, top, 0.42, WOOD, 0.33, 9);
    b.spar(top, peak, 0.27, WOOD, 0.20, 7);
    b.add(new THREE.CylinderGeometry(1.25, 1.15, 0.16, 10), WOOD_PALE, pose([top[0], top[1], top[2]], [0, 0, 0]));
    b.spar([-5.6, 9.6, z(0.535)], [4.9, 6.3, z(0.50)], 0.19, WOOD, 0.14);
    // What is left of the standing rigging.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        if (hash(k, side + 5) < 0.3) continue;
        const u = 0.47 + k * 0.035, e = hull(u, side < 0 ? 0 : 1);
        b.spar([e[0], e[1] + 0.6, e[2]], [top[0] + side * 1.05, top[1], top[2] - 0.3 + k * 0.3], 0.04, ROPE, 0.04, 4);
      }
    }
    b.spar([0, FORE - 0.2, z(0.80)], [0.3, FORE + 3.4, z(0.795)], 0.36, WOOD, 0.30, 8);   // stump of the fore mast
    b.spar([0, QUARTER - 0.2, z(0.19)], [-0.2, QUARTER + 1.9, z(0.19)], 0.30, WOOD, 0.26, 8); // stump of the mizzen
    b.spar([0, FORE + 0.5, z(0.955)], [0.5, FORE + 3.8, z(0.955) + 7.2], 0.26, WOOD, 0.15);   // bowsprit
    b.add(new THREE.CylinderGeometry(0.55, 0.62, 0.9, 9), WOOD_DARK, pose([0, FORE + 0.45, z(0.87)])); // capstan

    // Guns still on the main deck. The carriages slid to the low side.
    for (const u of [0.37, 0.45, 0.63, 0.71]) {
      for (const side of [-1, 1]) {
        if (hash(Math.round(u * 100), side) < 0.25) continue;
        const x = side * half(u) * 0.62 + 0.7;
        b.box([0.8, 0.35, 1.2], [x, MAIN + 0.2, z(u)], [0, 0.2 * side, 0], WOOD_DARK);
        b.spar([x - side * 0.9, MAIN + 0.55, z(u)], [x + side * 1.2, MAIN + 0.62, z(u) + 0.2], 0.23, IRON, 0.15, 8);
      }
    }
  });

  // On the sand: the masts that went over the side, guns, the anchor, barrels and loose timbers.
  b.spar([3.0, 2.2, z(0.80)], [15.5, 0.25, z(0.80) + 8.5], 0.33, WOOD, 0.20, 8);
  b.spar([8.2, 0.3, z(0.80) + 1.0], [10.6, 0.22, z(0.80) + 10.0], 0.16, WOOD, 0.12);
  b.spar([3.4, 1.3, z(0.20)], [14.0, 0.22, z(0.20) - 9.0], 0.27, WOOD, 0.17, 8);
  b.at(pose([-7.5, 0, z(0.97) + 4.5], [0, 0.7, 0]), () => anchor(b, 1.0, IRON));
  scatter(b, rand, 4, 6, 12, () => b.spar([0, 0.16, -1.0], [0, 0.20, 1.1], 0.23, IRON, 0.15, 8));
  scatter(b, rand, 7, 5, 14, () => b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 9), WOOD_PALE, pose([0, 0.26, 0], [0, 0, Math.PI / 2])));
  scatter(b, rand, 4, 6, 13, (i) => b.box([0.9, 0.8, 1.0], [0, 0.22, 0], [0.12 * i, 0, 0.1], WOOD));
  scatter(b, rand, 18, 5, 17, (i) => b.box([0.26, 0.07, 2.2 + (i % 4) * 0.6], [0, 0.05, 0], [0.03, 0, 0], shade(WOOD_PALE, 0.8 + 0.05 * (i % 5))));
  return b.build();
}

export function steamer() {
  const b = makeBuilder();
  const rand = rng(57);
  const L = 62, B = 11, D = 7.5;
  const spec = {
    length: L, beam: B, flare: 0.42, bilge: 0.45,
    breadth: (u) => Math.min(1, Math.pow(Math.max(u, 0) / 0.2, 0.5)) * (u > 0.72 ? Math.pow(Math.max(1 - Math.pow((u - 0.72) / 0.28, 2.3), 0), 0.7) : 1),
    depth: (u) => D * (0.55 + 0.45 * smooth(0, 0.2, u)),
    sheer: (u) => 0.25 + 1.1 * Math.pow((u - 0.5) * 2, 2) * (u > 0.5 ? 1 : 0.6),
  };
  const hull = hullShape(spec);
  const z = (u) => (u - 0.5) * L;
  const half = (u) => (B / 2) * spec.breadth(u);
  const deckY = (u) => spec.sheer(u) - 0.12;
  // The hull broke in two. The torn edges are ragged, plate by plate.
  const BOW_FROM = 0.415, STERN_TO = 0.335;
  const plating = (i, j, u, v) => {
    const below = smooth(0.30, 0.42, 0.5 - Math.abs(v - 0.5));
    return shade(below > 0.5 ? RUST_DARK : RUST, 0.8 + 0.35 * hash(i, j + 4));
  };

  // A row of posts with two rails, along a list of points.
  const railing = (points, height = 1.0) => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], c = points[i + 1];
      b.spar(a, [a[0], a[1] + height, a[2]], 0.045, IRON, 0.045, 4);
      if (hash(i, Math.round(a[2] * 3)) < 0.22) continue;
      for (const h of [0.5, 1.0]) b.spar([a[0], a[1] + height * h, a[2]], [c[0], c[1] + height * h, c[2]], 0.035, IRON, 0.035, 4);
    }
  };
  // A vent with its mouth turned forward.
  const cowl = (x, y, zz) => {
    b.spar([x, y, zz], [x, y + 1.9, zz], 0.26, RUST_PALE, 0.26, 8);
    b.spar([x, y + 1.75, zz - 0.05], [x, y + 2.15, zz + 0.6], 0.36, RUST_PALE, 0.46, 9);
    b.add(new THREE.CircleGeometry(0.4, 9), VOID, pose([x, y + 2.16, zz + 0.61], [-0.6, 0, 0]));
  };
  const portholes = (u0, u1, drop) => {
    for (let u = u0; u < u1; u += 1.9 / L) {
      for (const v of [0.035, 0.965]) {
        const e = hull(u, v + (v < 0.5 ? drop : -drop), 1.006);
        b.add(new THREE.CircleGeometry(0.2, 8), VOID, pose(e, [0, v < 0.5 ? -Math.PI / 2 : Math.PI / 2, 0]));
      }
    }
  };
  const deck = (u0, u1, hatches) => {
    b.patch((u, w) => [(w * 2 - 1) * half(u) * 0.985, deckY(u), z(u)], {
      u: [u0, u1], nu: Math.round((u1 - u0) * 70), nv: 10,
      keep: (i, j, u, w) => hash(i + 11, j) > 0.05 && !hatches.some((h) => Math.abs(u - h) < 0.036 && Math.abs(w - 0.5) < 0.22),
      color: (i, j) => shade(RUST_PALE, 0.7 + 0.3 * hash(i, j + 30)),
    });
    for (const h of hatches) {
      for (const s of [-1, 1]) {
        b.box([0.2, 0.7, 4.7], [s * 2.45, deckY(h) + 0.3, z(h)], [0, 0, 0], RUST);
        b.box([5.1, 0.7, 0.2], [0, deckY(h) + 0.3, z(h) + s * 2.3], [0, 0, 0], RUST);
      }
      b.box([4.7, 0.05, 4.4], [0, deckY(h) - 1.6, z(h)], [0, 0, 0], VOID);
    }
  };
  // The solid wall above the deck edge.
  const bulwark = (u0, u1, height) => {
    for (const side of [0, 1]) {
      b.patch((u, t) => { const e = hull(u, side); return [e[0], e[1] + t * height, e[2]]; }, {
        u: [u0, u1], nu: Math.round((u1 - u0) * 60), nv: 1, keep: (i) => hash(i, side + 70) > 0.16, color: (i) => shade(RUST, 0.8 + 0.35 * hash(i, 7)),
      });
    }
  };
  const house = (size, at, windowsPerSide, color) => {
    b.box(size, at, [0, 0, 0], color);
    for (const side of [-1, 1]) {
      for (let k = 0; k < windowsPerSide; k++) {
        const along = at[2] - size[2] / 2 + (k + 0.5) * size[2] / windowsPerSide;
        b.box([0.06, 0.62, 0.5], [at[0] + side * (size[0] / 2 + 0.02), at[1] + size[1] * 0.14, along], [0, 0, 0], VOID);
      }
    }
  };

  // Bow section, heeled to port.
  b.at(pose([0, D - 2.6, 1.5], [0, 0, 0.36]), () => {
    b.patch(hull, {
      u: [0.39, 1], nu: 40, nv: 12,
      keep: (i, j, u) => u > BOW_FROM + 0.03 * hash(j, 5) && hash(i, j + 8) > 0.03, color: plating,
    });
    for (let u = 0.40; u < 0.47; u += 1.2 / L) b.patch((s, v) => hull(u + s * 0.3 / L, v, 0.97), { nu: 1, nv: 12, color: RUST_DARK });
    deck(0.43, 0.985, [0.64, 0.775]);
    bulwark(0.43, 0.86, 1.0);
    portholes(0.45, 0.84, 0.07);

    // Deckhouse and bridge, with the funnel behind.
    const houseY = deckY(0.52);
    house([8.6, 2.6, 8.4], [0, houseY + 1.3, z(0.505)], 6, PAINT);
    house([6.4, 2.4, 4.2], [0, houseY + 3.8, z(0.535)], 3, PAINT);
    for (let k = -2; k <= 2; k++) b.box([0.7, 0.62, 0.06], [k * 1.15, houseY + 4.15, z(0.535) + 2.12], [0, 0, 0], VOID);
    b.box([B * 0.98, 0.14, 2.0], [0, houseY + 2.67, z(0.555)], [0, 0, 0], RUST_PALE);            // bridge wings
    b.box([6.9, 0.12, 4.7], [0, houseY + 5.06, z(0.535)], [0, 0, 0], RUST_PALE);                 // bridge roof
    const roof = houseY + 2.6;
    railing([[-4.2, roof, z(0.44)], [-4.2, roof, z(0.47)], [-4.2, roof, z(0.50)]]);
    railing([[4.2, roof, z(0.44)], [4.2, roof, z(0.47)], [4.2, roof, z(0.50)]]);
    b.at(pose([0, roof, z(0.47)], [-0.13, 0, 0.06]), () => {
      b.add(new THREE.CylinderGeometry(1.3, 1.45, 7.2, 14, 1, true), RUST, pose([0, 3.6, 0]));
      b.add(new THREE.CylinderGeometry(1.36, 1.38, 0.5, 14, 1, true), PAINT, pose([0, 5.6, 0]));
      b.add(new THREE.CylinderGeometry(1.39, 1.41, 0.5, 14, 1, true), PAINT, pose([0, 4.6, 0]));
      b.add(new THREE.CircleGeometry(1.24, 14), VOID, pose([0, 7.0, 0], [-Math.PI / 2, 0, 0]));
      b.spar([0.2, 0, 1.5], [0.2, 6.6, 1.45], 0.13, RUST_DARK, 0.13, 5);                        // steam pipe
    });
    cowl(-2.6, roof, z(0.495)); cowl(2.6, roof, z(0.495)); cowl(-2.9, roof, z(0.445)); cowl(2.9, roof, z(0.445));
    // Boat davits on the house roof. One boat still hangs from the starboard pair.
    for (const side of [-1, 1]) {
      for (const u of [0.455, 0.485]) {
        b.line([[side * 4.0, roof, z(u)], [side * 4.1, roof + 2.1, z(u)], [side * 4.7, roof + 2.9, z(u)], [side * 5.5, roof + 2.7, z(u)]], 0.08, IRON);
      }
    }
    b.at(pose([5.6, roof + 1.5, z(0.47)], [0.25, 0, 0.5]), () => b.patch(lifeboat, { nu: 10, nv: 6, color: WOOD_PALE }));
    b.spar([5.5, roof + 2.7, z(0.485)], [5.5, roof + 1.6, z(0.487)], 0.03, ROPE, 0.03, 4);

    // Fore mast with its crosstree, two derricks and stays. A winch sits at its foot.
    const mastU = 0.71, foot = [0, deckY(mastU), z(mastU)], head = [-0.6, deckY(mastU) + 16.5, z(mastU) - 0.4];
    b.spar(foot, head, 0.30, RUST_DARK, 0.17, 8);
    b.spar([-2.1, deckY(mastU) + 11.5, z(mastU) - 0.3], [1.3, deckY(mastU) + 11.6, z(mastU) - 0.3], 0.10, RUST_DARK);
    b.spar([0, deckY(mastU) + 1.2, z(mastU) - 0.3], [1.2, deckY(mastU) + 3.4, z(0.60)], 0.15, RUST_DARK, 0.10);
    b.spar([0, deckY(mastU) + 1.2, z(mastU) + 0.3], [-3.3, deckY(mastU) + 0.9, z(0.80)], 0.15, RUST_DARK, 0.10);
    b.spar(head, [0, deckY(0.97) + 2.0, z(0.97)], 0.03, ROPE, 0.03, 4);
    for (const side of [-1, 1]) b.spar(head, [side * half(0.68) * 0.95, deckY(0.68) + 1.0, z(0.68)], 0.03, ROPE, 0.03, 4);
    b.box([1.9, 0.8, 1.3], [0, deckY(mastU) + 0.4, z(mastU) - 1.5], [0, 0, 0], IRON);
    b.spar([-1.4, deckY(mastU) + 0.6, z(mastU) - 1.5], [1.4, deckY(mastU) + 0.6, z(mastU) - 1.5], 0.42, RUST_DARK, 0.42, 9);

    // Raised forecastle with the anchor windlass.
    const fore = 1.9;
    bulwark(0.86, 0.995, fore);
    b.patch((u, w) => [(w * 2 - 1) * half(u) * 0.97, deckY(u) + fore, z(u)], { u: [0.865, 0.985], nu: 9, nv: 8, color: (i, j) => shade(RUST_PALE, 0.7 + 0.3 * hash(i + 2, j)) });
    b.patch((w, t) => [(w * 2 - 1) * half(0.865) * 0.97, deckY(0.865) + t * fore, z(0.865)], { nu: 8, nv: 2, keep: (i, j) => !(i === 3 && j === 0), color: RUST });
    b.box([2.6, 0.9, 1.2], [0, deckY(0.93) + fore + 0.45, z(0.93)], [0, 0, 0], IRON);
    b.spar([-1.7, deckY(0.93) + fore + 0.7, z(0.93)], [1.7, deckY(0.93) + fore + 0.7, z(0.93)], 0.36, RUST_DARK, 0.36, 9);
    const rail = [];
    for (let u = 0.87; u <= 0.985; u += 0.023) rail.push([half(u) * 0.95, deckY(u) + fore, z(u)]);
    railing(rail);
    railing(rail.map((q) => [-q[0], q[1], q[2]]));
  });

  // Stern section. It rolled the other way and settled deeper.
  b.at(pose([-2.2, D - 3.4, -3.5], [0, 0.20, -0.52]), () => {
    b.patch(hull, {
      u: [0, 0.36], nu: 24, nv: 12,
      keep: (i, j, u) => u < STERN_TO - 0.03 * hash(j, 9) && hash(i + 50, j) > 0.04, color: plating,
    });
    for (let u = 0.28; u < 0.345; u += 1.2 / L) b.patch((s, v) => hull(u + s * 0.3 / L, v, 0.97), { nu: 1, nv: 12, color: RUST_DARK });
    deck(0.03, 0.315, [0.215]);
    bulwark(0.02, 0.31, 1.0);
    portholes(0.07, 0.30, 0.08);
    const poopY = deckY(0.11);
    house([6.2, 2.3, 6.0], [0, poopY + 1.15, z(0.115)], 4, PAINT);
    railing([[-3.0, poopY + 2.3, z(0.07)], [-3.0, poopY + 2.3, z(0.11)], [-3.0, poopY + 2.3, z(0.16)]]);
    b.box([1.8, 0.9, 1.6], [0, poopY + 0.45, z(0.035)], [0, 0, 0], IRON);                        // steering gear
    b.spar([0, deckY(0.27), z(0.27)], [0.9, deckY(0.27) + 5.2, z(0.268)], 0.28, RUST_DARK, 0.22, 8); // broken main mast
    cowl(-2.4, deckY(0.29), z(0.29)); cowl(2.4, deckY(0.29), z(0.29));
    // Rudder and propeller.
    b.box([0.3, 5.2, 2.7], [0, -3.9, z(0.012)], [0, 0.35, 0], RUST_DARK);
    b.spar([0, -5.6, z(0.10)], [0, -5.6, z(0.04)], 0.28, IRON, 0.28, 8);
    for (let k = 0; k < 4; k++) {
      b.at(pose([0, -5.6, z(0.045)], [0, 0, k * Math.PI / 2 + 0.4]), () => b.box([0.95, 1.9, 0.14], [0, 1.15, 0], [0, 0.5, 0], RUST_PALE));
    }
  });

  // On the sand: the upper mast, a boiler that fell out of the break, a lifeboat, the anchor on its chain, and plates.
  b.spar([4.5, 2.0, z(0.27) - 4], [15.5, 0.25, z(0.27) - 12], 0.22, RUST_DARK, 0.12, 8);
  b.at(pose([6.5, 0, z(0.375) - 1.0], [0, 1.1, 0]), () => {
    b.add(new THREE.CylinderGeometry(1.9, 1.9, 5.2, 14, 1, true), RUST_DARK, pose([0, 1.35, 0], [Math.PI / 2, 0, 0]));
    b.add(new THREE.CircleGeometry(1.9, 14), IRON, pose([0, 1.35, 2.6]));
    for (const x of [-0.8, 0.8]) b.add(new THREE.CircleGeometry(0.5, 9), VOID, pose([x, 0.9, 2.62]));
  });
  b.at(pose([-10.5, 0.75, z(0.50)], [0, 0.5, Math.PI]), () => b.patch(lifeboat, { nu: 10, nv: 6, color: WOOD_PALE }));
  const chain = [[-3.2, 4.4, z(0.955) + 1.5], [-4.6, 1.3, z(0.99) + 3.5], [-5.4, 0.12, z(1) + 6.5], [-5.0, 0.1, z(1) + 10.5]];
  b.line(chain, 0.085, IRON);
  b.at(pose([-5.0, 0, z(1) + 12.3], [0, 0.2, 0]), () => anchor(b, 1.15, IRON));
  scatter(b, rand, 12, 7, 20, (i) => b.box([1.6 + (i % 3) * 0.8, 0.05, 1.3 + (i % 4) * 0.5], [0, 0.07, 0], [0.08, 0, 0.05], shade(RUST, 0.8 + 0.1 * (i % 4))));
  scatter(b, rand, 6, 6, 16, (i) => b.spar([0, 0.12, -1.6], [0, 0.14, 1.6 + (i % 3)], 0.11, RUST_DARK, 0.11, 6));
  return b.build();
}
