import { TAU, rng } from './util.js';
import { makeBuilder, pose, hash, shade, smooth, raised } from './builder.js';

// Shipwreck models: a wooden sailing ship and a steamer that broke in two.
// Local axes: +Z is the bow, +Y is up, +X is port, and y = 0 is the sand.

// Surface colours. The fourth number is the seam count per metre: planks for wood, plates for steel, 0 for none, -1 for an opening.
const WOOD = [0.200, 0.150, 0.105, 2.5];
const WOOD_PALE = [0.420, 0.360, 0.270, 2.5];
const WOOD_DARK = [0.070, 0.055, 0.042, 2.5];
const IRON = [0.040, 0.042, 0.048, 0];
const RUST = [0.260, 0.130, 0.080, 0.6];
const RUST_DARK = [0.100, 0.055, 0.040, 0.6];
const RUST_PALE = [0.400, 0.250, 0.150, 0.6];
const PAINT = [0.550, 0.550, 0.500, 0.6];
const ROPE = [0.300, 0.270, 0.190, 0];
const VOID = [0.008, 0.010, 0.013, -1]; // an opening that shows the dark inside

// Hull surface. u runs from stern to bow. v runs from the starboard rail, under the keel, to the port rail.
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

// Loose objects that lie on the sand around a wreck, at random angles.
function scatter(b, rand, count, near, far, make) {
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU, r = near + (far - near) * rand();
    b.within(pose([Math.cos(a) * r * 0.6, 0, Math.sin(a) * r], [0, rand() * TAU, 0]), () => make(i));
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
    const arm = [[0, 0.12, -1.5 * size], [0.35 * size, 0.45 * size * side, -1.35 * size], [0.6 * size, 0.85 * size * side, -0.95 * size]];
    b.line(arm, 0.075 * size, color);
    b.box([0.07 * size, 0.42 * size, 0.42 * size], [0.62 * size, 0.88 * size * side, -0.9 * size], color, [0.5 * side, 0, 0.6]);
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

  // The ship lies over on her port side, with the keel under the sand.
  b.section(pose([0, D - 2.3, 0], [0, 0, -0.30]), () => {
    // Planking. Planks are missing in runs, most of them near the stern and around one large hole.
    b.patch(hull, {
      nu: 42, nv: 14,
      keep: (i, j, u, v) => {
        const hole = 0.9 * Math.exp(-Math.pow((u - 0.60) / 0.07, 2) - Math.pow((v - 0.22) / 0.13, 2));
        const decay = 0.08 + 0.5 * smooth(0.42, 0.04, u) + 0.25 * smooth(0.25, 0.0, Math.min(v, 1 - v));
        return hash(Math.floor(i / 3), j) > decay + hole;
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
    b.box([0.55, 0.65, L * 0.9], [0, 0.4 - D * 0.985, -0.6], WOOD_DARK); // keel
    const stem = [];
    for (let u = 0.80; u <= 1.0001; u += 0.04) stem.push(hull(Math.min(u, 0.999), 0.5, 1.02));
    stem.push([0, spec.sheer(1) + 1.6, z(1) + 0.5]);
    b.line(stem, 0.3, WOOD_DARK);
    b.spar([0, 0.4 - D * 0.7, z(0.005)], [0, spec.sheer(0) + 0.3, z(0) - 0.35], 0.3, WOOD_DARK);
    b.box([0.22, 4.4, 1.9], [0.5, -2.4, z(0) - 1.2], WOOD, [0.5, 0, 0]);              // rudder, swung over

    // Flat stern with a row of cabin windows.
    b.patch((s, t) => { const e = hull(0.012, s); return [e[0] * (1 - t), e[1] + (spec.sheer(0) - 0.1 - e[1]) * t, e[2]]; }, {
      nu: 12, nv: 4, keep: (i, j) => hash(i + 7, j + 3) > 0.14, color: (i, j) => shade(WOOD, 0.85 + 0.3 * hash(i, j + 9)),
    });
    for (let k = -2; k <= 2; k++) b.box([0.62, 0.8, 0.08], [k * 0.95, 1.25, z(0.012) - 0.06], VOID);
    b.box([5.4, 0.16, 0.3], [0, 0.72, z(0.012) - 0.12], WOOD_PALE);
    b.box([5.4, 0.16, 0.3], [0, 1.78, z(0.012) - 0.12], WOOD_PALE);

    // Decks. `gone` is the share of planks that have fallen in.
    const deck = (u0, u1, y, gone, hatch) => {
      b.patch((u, w) => [(w * 2 - 1) * half(u) * 0.93, y, z(u)], {
        u: [u0, u1], nu: Math.round((u1 - u0) * 60), nv: 12,
        keep: (i, j, u, w) => hash(Math.floor(i / 4) + Math.round(y * 9), j) > gone
          && !(hatch && Math.abs(u - hatch) < 0.04 && Math.abs(w - 0.5) < 0.17),
        color: (i, j) => shade(WOOD_PALE, 0.75 + 0.4 * hash(Math.floor(i / 4), j + 20)),
      });
      for (let u = u0 + 0.01; u < u1; u += 2.1 / L) b.box([half(u) * 1.86, 0.22, 0.24], [0, y - 0.14, z(u)], WOOD_DARK);
    };
    deck(0.31, 0.80, MAIN, 0.30, 0.56);
    deck(0.03, 0.30, QUARTER, 0.38);
    deck(0.81, 0.965, FORE, 0.26);
    // Coaming around the main hatch.
    for (const s of [-1, 1]) {
      b.box([0.16, 0.4, 2.9], [s * 1.45, MAIN + 0.2, z(0.56)], WOOD_DARK);
      b.box([3.05, 0.4, 0.16], [0, MAIN + 0.2, z(0.56) + s * 1.45], WOOD_DARK);
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
        b.spar(raised(a, 0.85), raised(c, 0.85), 0.09, WOOD_PALE, 0.09, 5);
        b.spar(a, raised(a, 0.85), 0.07, WOOD, 0.07, 5);
      }
    }

    // Main mast: still up, broken above the top platform. Its yard hangs by one end.
    const foot = [0, 0.4 - D * 0.9, z(0.53)], top = [0.5, 11.2, z(0.52)], peak = [0.75, 15.6, z(0.515)];
    b.spar(foot, top, 0.42, WOOD, 0.33, 9);
    b.spar(top, peak, 0.27, WOOD, 0.20, 7);
    b.cylinder([1.25, 1.15], 0.16, 10, WOOD_PALE, top);
    b.spar([-5.6, 9.6, z(0.535)], [4.9, 6.3, z(0.50)], 0.19, WOOD, 0.14);
    // What is left of the standing rigging.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        if (hash(k, side + 5) < 0.3) continue;
        const u = 0.47 + k * 0.035, e = hull(u, side < 0 ? 0 : 1);
        b.spar(raised(e, 0.6), [top[0] + side * 1.05, top[1], top[2] - 0.3 + k * 0.3], 0.04, ROPE, 0.04, 4);
      }
    }
    b.spar([0, FORE - 0.2, z(0.80)], [0.3, FORE + 3.4, z(0.795)], 0.36, WOOD, 0.30, 8);   // stump of the fore mast
    b.spar([0, QUARTER - 0.2, z(0.19)], [-0.2, QUARTER + 1.9, z(0.19)], 0.30, WOOD, 0.26, 8); // stump of the mizzen
    b.spar([0, FORE + 0.5, z(0.955)], [0.5, FORE + 3.8, z(0.955) + 7.2], 0.26, WOOD, 0.15);   // bowsprit
    b.cylinder([0.55, 0.62], 0.9, 9, WOOD_DARK, [0, FORE + 0.45, z(0.87)]); // capstan

    // Guns still on the main deck. The carriages slid to the low side.
    for (const u of [0.37, 0.45, 0.63, 0.71]) {
      for (const side of [-1, 1]) {
        if (hash(Math.round(u * 100), side) < 0.25) continue;
        const x = side * half(u) * 0.62 + 0.7;
        b.box([0.8, 0.35, 1.2], [x, MAIN + 0.2, z(u)], WOOD_DARK, [0, 0.2 * side, 0]);
        b.spar([x - side * 0.9, MAIN + 0.55, z(u)], [x + side * 1.2, MAIN + 0.62, z(u) + 0.2], 0.23, IRON, 0.15, 8);
      }
    }
  });

  // On the sand: the masts that went over the side, guns, the anchor, barrels, crates and loose timbers.
  b.spar([3.0, 2.2, z(0.80)], [15.5, 0.25, z(0.80) + 8.5], 0.33, WOOD, 0.20, 8);
  b.spar([8.2, 0.3, z(0.80) + 1.0], [10.6, 0.22, z(0.80) + 10.0], 0.16, WOOD, 0.12);
  b.spar([3.4, 1.3, z(0.20)], [14.0, 0.22, z(0.20) - 9.0], 0.27, WOOD, 0.17, 8);
  b.within(pose([-7.5, 0, z(0.97) + 4.5], [0, 0.7, 0]), () => anchor(b, 1.0, IRON));
  scatter(b, rand, 4, 6, 12, () => b.spar([0, 0.16, -1.0], [0, 0.20, 1.1], 0.23, IRON, 0.15, 8));
  scatter(b, rand, 7, 5, 14, () => b.cylinder([0.34, 0.34], 0.9, 9, WOOD_PALE, [0, 0.26, 0], [0, 0, Math.PI / 2]));
  scatter(b, rand, 4, 6, 13, (i) => b.box([0.9, 0.8, 1.0], [0, 0.22, 0], WOOD, [0.12 * i, 0, 0.1]));
  scatter(b, rand, 18, 5, 17, (i) => {
    b.box([0.26, 0.07, 2.2 + (i % 4) * 0.6], [0, 0.05, 0], shade(WOOD_PALE, 0.8 + 0.05 * (i % 5)), [0.03, 0, 0]);
  });
  return b.build();
}

export function steamer() {
  const b = makeBuilder();
  const rand = rng(57);
  const L = 62, B = 11, D = 7.5;
  const spec = {
    length: L, beam: B, flare: 0.42, bilge: 0.45,
    breadth: (u) => Math.min(1, Math.pow(Math.max(u, 0) / 0.2, 0.5))
      * (u > 0.72 ? Math.pow(Math.max(1 - Math.pow((u - 0.72) / 0.28, 2.3), 0), 0.7) : 1),
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
      b.spar(a, raised(a, height), 0.045, IRON, 0.045, 4);
      if (hash(i, Math.round(a[2] * 3)) < 0.22) continue;
      for (const h of [0.5, 1.0]) b.spar(raised(a, height * h), raised(c, height * h), 0.035, IRON, 0.035, 4);
    }
    const end = points[points.length - 1];
    b.spar(end, raised(end, height), 0.045, IRON, 0.045, 4);
  };
  // A vent with its mouth turned forward.
  const cowl = (x, y, zz) => {
    b.spar([x, y, zz], [x, y + 1.9, zz], 0.26, RUST_PALE, 0.26, 8);
    b.spar([x, y + 1.75, zz - 0.05], [x, y + 2.15, zz + 0.6], 0.36, RUST_PALE, 0.46, 9);
    b.disc(0.4, 9, VOID, [x, y + 2.16, zz + 0.61], [-0.6, 0, 0]);
  };
  const portholes = (u0, u1, drop) => {
    for (let u = u0; u < u1; u += 1.9 / L) {
      for (const v of [0.035, 0.965]) {
        const e = hull(u, v + (v < 0.5 ? drop : -drop), 1.006);
        b.disc(0.2, 8, VOID, e, [0, v < 0.5 ? -Math.PI / 2 : Math.PI / 2, 0]);
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
        b.box([0.2, 0.7, 4.7], [s * 2.45, deckY(h) + 0.3, z(h)], RUST);
        b.box([5.1, 0.7, 0.2], [0, deckY(h) + 0.3, z(h) + s * 2.3], RUST);
      }
      b.box([4.7, 0.05, 4.4], [0, deckY(h) - 1.6, z(h)], VOID);
    }
  };
  // The solid wall above the deck edge.
  const bulwark = (u0, u1, height) => {
    for (const side of [0, 1]) {
      b.patch((u, t) => { const e = hull(u, side); return raised(e, t * height); }, {
        u: [u0, u1], nu: Math.round((u1 - u0) * 60), nv: 1,
        keep: (i) => hash(i, side + 70) > 0.16, color: (i) => shade(RUST, 0.8 + 0.35 * hash(i, 7)),
      });
    }
  };
  const house = (size, at, windowsPerSide, color) => {
    b.box(size, at, color);
    for (const side of [-1, 1]) {
      for (let k = 0; k < windowsPerSide; k++) {
        const along = at[2] - size[2] / 2 + (k + 0.5) * size[2] / windowsPerSide;
        b.box([0.06, 0.62, 0.5], [at[0] + side * (size[0] / 2 + 0.02), at[1] + size[1] * 0.14, along], VOID);
      }
    }
  };

  // Bow section, heeled to starboard.
  b.section(pose([0, D - 2.6, 1.5], [0, 0, 0.36]), () => {
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
    for (let k = -2; k <= 2; k++) b.box([0.7, 0.62, 0.06], [k * 1.15, houseY + 4.15, z(0.535) + 2.12], VOID);
    b.box([B * 0.98, 0.14, 2.0], [0, houseY + 2.67, z(0.555)], RUST_PALE);            // bridge wings
    b.box([6.9, 0.12, 4.7], [0, houseY + 5.06, z(0.535)], RUST_PALE);                 // bridge roof
    const roof = houseY + 2.6;
    railing([[-4.2, roof, z(0.44)], [-4.2, roof, z(0.47)], [-4.2, roof, z(0.50)]]);
    railing([[4.2, roof, z(0.44)], [4.2, roof, z(0.47)], [4.2, roof, z(0.50)]]);
    b.within(pose([0, roof, z(0.47)], [-0.13, 0, 0.06]), () => {
      b.cylinder([1.3, 1.45], 7.2, 14, RUST, [0, 3.6, 0], [0, 0, 0], true);
      b.cylinder([1.36, 1.38], 0.5, 14, PAINT, [0, 5.6, 0], [0, 0, 0], true);
      b.cylinder([1.39, 1.41], 0.5, 14, PAINT, [0, 4.6, 0], [0, 0, 0], true);
      b.disc(1.24, 14, VOID, [0, 7.0, 0], [-Math.PI / 2, 0, 0]);
      b.spar([0.2, 0, 1.5], [0.2, 6.6, 1.45], 0.13, RUST_DARK, 0.13, 5);                        // steam pipe
    });
    cowl(-2.6, roof, z(0.495)); cowl(2.6, roof, z(0.495)); cowl(-2.9, roof, z(0.445)); cowl(2.9, roof, z(0.445));
    // Boat davits on the house roof. One boat still hangs from the port pair.
    for (const side of [-1, 1]) {
      for (const u of [0.455, 0.485]) {
        const davit = [[4.0, 0], [4.1, 2.1], [4.7, 2.9], [5.5, 2.7]]; // distance from the middle, height above the roof
        b.line(davit.map(([x, y]) => [side * x, roof + y, z(u)]), 0.08, IRON);
      }
    }
    b.within(pose([5.6, roof + 1.5, z(0.47)], [0.25, 0, 0.5]), () => b.patch(lifeboat, { nu: 10, nv: 6, color: WOOD_PALE }));
    b.spar([5.5, roof + 2.7, z(0.485)], [5.5, roof + 1.6, z(0.487)], 0.03, ROPE, 0.03, 4);

    // Fore mast with its crosstree, two derricks and stays. A winch sits at its foot.
    const mastU = 0.71, foot = [0, deckY(mastU), z(mastU)], head = [-0.6, deckY(mastU) + 16.5, z(mastU) - 0.4];
    b.spar(foot, head, 0.30, RUST_DARK, 0.17, 8);
    b.spar([-2.1, deckY(mastU) + 11.5, z(mastU) - 0.3], [1.3, deckY(mastU) + 11.6, z(mastU) - 0.3], 0.10, RUST_DARK);
    b.spar([0, deckY(mastU) + 1.2, z(mastU) - 0.3], [1.2, deckY(mastU) + 3.4, z(0.60)], 0.15, RUST_DARK, 0.10);
    b.spar([0, deckY(mastU) + 1.2, z(mastU) + 0.3], [-3.3, deckY(mastU) + 0.9, z(0.80)], 0.15, RUST_DARK, 0.10);
    b.spar(head, [0, deckY(0.97) + 2.0, z(0.97)], 0.03, ROPE, 0.03, 4);
    for (const side of [-1, 1]) b.spar(head, [side * half(0.68) * 0.95, deckY(0.68) + 1.0, z(0.68)], 0.03, ROPE, 0.03, 4);
    b.box([1.9, 0.8, 1.3], [0, deckY(mastU) + 0.4, z(mastU) - 1.5], IRON);
    b.spar([-1.4, deckY(mastU) + 0.6, z(mastU) - 1.5], [1.4, deckY(mastU) + 0.6, z(mastU) - 1.5], 0.42, RUST_DARK, 0.42, 9);

    // Raised forecastle with the anchor windlass.
    const fore = 1.9;
    bulwark(0.86, 0.995, fore);
    b.patch((u, w) => [(w * 2 - 1) * half(u) * 0.97, deckY(u) + fore, z(u)], {
      u: [0.865, 0.985], nu: 9, nv: 8, color: (i, j) => shade(RUST_PALE, 0.7 + 0.3 * hash(i + 2, j)),
    });
    b.patch((w, t) => [(w * 2 - 1) * half(0.865) * 0.97, deckY(0.865) + t * fore, z(0.865)], {
      nu: 8, nv: 2, keep: (i, j) => !(i === 3 && j === 0), color: RUST, // the gap is a doorway
    });
    b.box([2.6, 0.9, 1.2], [0, deckY(0.93) + fore + 0.45, z(0.93)], IRON);
    b.spar([-1.7, deckY(0.93) + fore + 0.7, z(0.93)], [1.7, deckY(0.93) + fore + 0.7, z(0.93)], 0.36, RUST_DARK, 0.36, 9);
    const rail = [];
    for (let u = 0.87; u <= 0.985; u += 0.023) rail.push([half(u) * 0.95, deckY(u) + fore, z(u)]);
    railing(rail);
    railing(rail.map((q) => [-q[0], q[1], q[2]]));
  });

  // Stern section. It rolled the other way and settled deeper.
  b.section(pose([-2.2, D - 3.4, -3.5], [0, 0.20, -0.52]), () => {
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
    b.box([1.8, 0.9, 1.6], [0, poopY + 0.45, z(0.035)], IRON);                        // steering gear
    b.spar([0, deckY(0.27), z(0.27)], [0.9, deckY(0.27) + 5.2, z(0.268)], 0.28, RUST_DARK, 0.22, 8); // broken main mast
    cowl(-2.4, deckY(0.29), z(0.29)); cowl(2.4, deckY(0.29), z(0.29));
    // Rudder and propeller. The shaft leaves the hull above the keel.
    b.box([0.3, 3.6, 2.7], [0, -2.3, z(0.012)], RUST_DARK, [0, 0.35, 0]);
    b.spar([0, -3.0, z(0.10)], [0, -3.0, z(0.04)], 0.28, IRON, 0.28, 8);
    for (let k = 0; k < 4; k++) {
      const blade = pose([0, -3.0, z(0.045)], [0, 0, k * Math.PI / 2 + 0.4]);
      b.within(blade, () => b.box([0.95, 1.9, 0.14], [0, 1.15, 0], RUST_PALE, [0, 0.5, 0]));
    }
  });

  // On the sand: the upper mast, a boiler that fell out of the break, a lifeboat, the anchor on its chain, plates and pipes.
  b.spar([4.5, 2.0, z(0.27) - 4], [15.5, 0.25, z(0.27) - 12], 0.22, RUST_DARK, 0.12, 8);
  b.within(pose([6.5, 0, z(0.375) - 1.0], [0, 1.1, 0]), () => {
    b.cylinder([1.9, 1.9], 5.2, 14, RUST_DARK, [0, 1.35, 0], [Math.PI / 2, 0, 0], true);
    b.disc(1.9, 14, IRON, [0, 1.35, 2.6]);
    for (const x of [-0.8, 0.8]) b.disc(0.5, 9, VOID, [x, 0.9, 2.62]);
  });
  b.within(pose([-10.5, -0.05, z(0.50)], [0, 0.5, Math.PI]), () => b.patch(lifeboat, { nu: 10, nv: 6, color: WOOD_PALE }));
  const chain = [[-3.2, 4.4, z(0.955) + 1.5], [-4.6, 1.3, z(0.99) + 3.5], [-5.4, 0.12, z(1) + 6.5], [-5.0, 0.1, z(1) + 10.5]];
  b.line(chain, 0.085, IRON);
  b.within(pose([-5.0, 0, z(1) + 12.3], [0, 0.2, 0]), () => anchor(b, 1.15, IRON));
  scatter(b, rand, 12, 7, 20, (i) => {
    b.box([1.6 + (i % 3) * 0.8, 0.05, 1.3 + (i % 4) * 0.5], [0, 0.07, 0], shade(RUST, 0.8 + 0.1 * (i % 4)), [0.08, 0, 0.05]);
  });
  scatter(b, rand, 6, 6, 16, (i) => b.spar([0, 0.12, -1.6], [0, 0.14, 1.6 + (i % 3)], 0.11, RUST_DARK, 0.11, 6));
  return b.build();
}
