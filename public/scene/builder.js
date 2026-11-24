import * as THREE from 'three';
import { geometry, cross } from './util.js';

// Builds one model from many parts. Each vertex gets a position, a normal, a colour and a texture coordinate in metres.
// A colour is [r, g, b, seams]. The wreck shader reads `seams` to choose the surface texture.

export const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
// A fixed pseudo-random number in 0..1 for a pair of whole numbers.
export const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
export const shade = (color, k) => [color[0] * k, color[1] * k, color[2] * k, color[3]];
// A point lifted by h metres.
export const raised = (p, h) => [p[0], p[1] + h, p[2]];
// A transform from a position and yaw-pitch-roll angles, given as [pitch, yaw, roll].
export const pose = (at = [0, 0, 0], rot = [0, 0, 0]) => new THREE.Matrix4().compose(
  new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')), new THREE.Vector3(1, 1, 1));

export function makeBuilder() {
  const pos = [], nor = [], col = [], uvs = [];
  let transform = new THREE.Matrix4();
  let rigid = 0; // 1 inside `section`
  let parts = 0;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const emit = (point, normal, color, u, v) => {
    p.set(...point).applyMatrix4(transform);
    n.set(...normal).transformDirection(transform);
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(...color); uvs.push(u, v, rigid);
  };
  // Every part gets its own stretch of texture, so that equal parts do not look identical.
  const nextPart = () => { const id = ++parts; return { id, offsetU: id * 3.7, offsetV: id * 1.3 }; };

  const b = {
    // Applies a transform to all parts made inside `make`.
    within(matrix, make) {
      const outer = transform;
      transform = outer.clone().multiply(matrix);
      make();
      transform = outer;
    },
    // Like `within`, for a piece of hull. It stays rigid, while other parts follow the dune under them.
    section(matrix, make) {
      rigid = 1;
      b.within(matrix, make);
      rigid = 0;
    },
    // A three.js geometry, in one colour with a tone of its own.
    add(geo, color, matrix = new THREE.Matrix4()) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const gp = g.getAttribute('position').array, gn = g.getAttribute('normal').array;
      // The texture runs along the longest side of the part, in its own frame.
      g.computeBoundingBox();
      const size = g.boundingBox.getSize(new THREE.Vector3()).toArray();
      const long = size.indexOf(Math.max(...size)), a1 = (long + 1) % 3, a2 = (long + 2) % 3;
      const { id, offsetU, offsetV } = nextPart();
      const toned = shade(color, 0.72 + 0.56 * hash(id, 17));
      b.within(matrix, () => {
        for (let i = 0; i < gp.length; i += 3) {
          emit([gp[i], gp[i + 1], gp[i + 2]], [gn[i], gn[i + 1], gn[i + 2]], toned, gp[i + long] + offsetU, gp[i + a1] + gp[i + a2] + offsetV);
        }
      });
    },
    box(size, at, color, rot) { b.add(new THREE.BoxGeometry(...size), color, pose(at, rot)); },
    // An upright cylinder with radii [top, bottom]. `open` leaves out the end caps.
    cylinder(radii, height, sides, color, at, rot, open = false) {
      b.add(new THREE.CylinderGeometry(...radii, height, sides, 1, open), color, pose(at, rot));
    },
    // A flat disc that faces +Z.
    disc(radius, sides, color, at, rot) { b.add(new THREE.CircleGeometry(radius, sides), color, pose(at, rot)); },
    // A round bar between two points, with radius r0 at `from` and r1 at `to`.
    spar(from, to, r0, color, r1 = r0 * 0.8, sides = 7) {
      const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      const m = new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      b.add(new THREE.CylinderGeometry(r1, r0, a.distanceTo(c), sides, 1), color, m);
    },
    // A bar that follows a list of points.
    line(points, r, color) { for (let i = 0; i < points.length - 1; i++) b.spar(points[i], points[i + 1], r, color, r, 5); },
    // A curved surface fn(u, v) of nu by nv cells. Cells for which `keep` returns false are left out, which makes holes.
    // `keep` and a `color` function both get (i, j, u, v) of the cell.
    patch(fn, { u = [0, 1], v = [0, 1], nu, nv, keep, color }) {
      const at = (i, j) => [u[0] + (u[1] - u[0]) * i / nu, v[0] + (v[1] - v[0]) * j / nv];
      const midU = (u[0] + u[1]) / 2, midV = (v[0] + v[1]) / 2, e = 1e-3;
      const raw = (uu, vv) => cross(fn(uu + e, vv), fn(uu - e, vv), fn(uu, vv + e), fn(uu, vv - e));
      const normal = (uu, vv) => {
        let c = raw(uu, vv);
        // Where the patch shrinks to a point, take the normal from just inside it.
        if (c[3] < 1e-9) c = raw(uu + (midU - uu) * 0.01, vv + (midV - vv) * 0.01);
        return c[3] > 1e-9 ? [c[0] / c[3], c[1] / c[3], c[2] / c[3]] : [0, 1, 0];
      };
      // Size of the patch in metres, measured through its middle. The texture runs along the longer side.
      const arcLength = (from) => {
        let sum = 0, last = fn(...from(0));
        for (let k = 1; k <= 8; k++) {
          const next = fn(...from(k / 8));
          sum += Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]);
          last = next;
        }
        return sum;
      };
      const lenU = arcLength((t) => [u[0] + (u[1] - u[0]) * t, midV]), lenV = arcLength((t) => [midU, v[0] + (v[1] - v[0]) * t]);
      const { offsetU, offsetV } = nextPart();
      const texCoord = (i, j) => (lenU >= lenV
        ? [(i / nu) * lenU + offsetU, (j / nv) * lenV + offsetV]
        : [(j / nv) * lenV + offsetU, (i / nu) * lenU + offsetV]);
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const mid = at(i + 0.5, j + 0.5);
          if (keep && !keep(i, j, mid[0], mid[1])) continue;
          const c = typeof color === 'function' ? color(i, j, mid[0], mid[1]) : color;
          for (const k of [0, 1, 2, 1, 3, 2]) {
            const ci = i + corners[k][0], cj = j + corners[k][1], corner = at(ci, cj);
            emit(fn(...corner), normal(...corner), c, ...texCoord(ci, cj));
          }
        }
      }
    },
    // aUV holds the texture coordinate, then the rigid flag.
    build: () => geometry({ position: [pos, 3], normal: [nor, 3], aColor: [col, 4], aUV: [uvs, 3] }),
  };
  return b;
}
