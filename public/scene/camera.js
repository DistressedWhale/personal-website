import * as THREE from 'three';
import { TAU, clamp } from './util.js';

const MAX_TILT = 1.35; // radians above or below level

// Chase camera. It drifts around the rear of its target and never settles. Moving the mouse nudges it,
// and a drag turns it around the target. `fixed` may hold az, el or dist to pin that part of the path.
export function createChaseCamera(canvas, fixed) {
  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 1500);
  const pointer = new THREE.Vector2(); // mouse position, -1..1 on each axis
  const nudge = new THREE.Vector2();   // the same, smoothed
  const drag = { active: false, id: -1, x: 0, y: 0, az: 0, el: 0, idle: 0 };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    Object.assign(drag, { active: true, id: e.pointerId, x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (drag.active && e.pointerId === drag.id) {
      const size = Math.min(window.innerWidth, window.innerHeight);
      drag.az -= ((e.clientX - drag.x) / size) * 3.2;
      drag.el += ((e.clientY - drag.y) / size) * 2.4;
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

  return {
    camera,
    resize(aspect) {
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 62 : 46; // a tall screen needs a wider lens, or the whale does not fit
      camera.updateProjectionMatrix();
    },
    // `target` is the point to look at and `heading` the yaw of the animal there. `deep` lets the camera go
    // down to the sea floor, which only the test views use.
    update(time, dt, target, heading, deep) {
      // After a drag the camera holds the chosen view for a few seconds, then eases back to its own path.
      if (drag.active) {
        nudge.multiplyScalar(Math.exp(-dt * 4));
      } else {
        nudge.lerp(pointer, 1 - Math.exp(-dt * 2.5));
        drag.idle += dt;
        if (drag.idle > 6) {
          drag.az *= Math.exp(-dt * 0.35);
          drag.el *= Math.exp(-dt * 0.35);
        }
      }
      // On a tall screen a side view cuts the whale off, so the camera stays closer to the rear and further away.
      const tall = camera.aspect < 1;
      const pathAz = fixed.az ?? (1.05 * Math.sin(time * 0.0310 + 0.9) + 0.70 * Math.sin(time * 0.0173 + 1.3)) * (tall ? 0.28 : 1);
      // Straight behind, a level view hides the body. The camera rises there to show the back.
      const pathEl = fixed.el ?? 0.02 + 0.30 * Math.sin(time * 0.0230 + 2.1) + 0.14 * Math.sin(time * 0.0097) + 0.34 * Math.cos(pathAz) ** 2;
      const dist = (fixed.dist ?? 35 + 7 * Math.sin(time * 0.0170 + 2.0) + 4 * Math.sin(time * 0.0071)) * (tall ? 1.45 : 1);

      const az = pathAz + nudge.x * 0.25 + drag.az + heading;
      const el = clamp(pathEl - nudge.y * 0.15 + drag.el, -MAX_TILT, MAX_TILT);
      drag.el = clamp(drag.el, -MAX_TILT - pathEl, MAX_TILT - pathEl);
      camera.position.set(
        target.x + Math.sin(az) * Math.cos(el) * dist,
        clamp(target.y + Math.sin(el) * dist, deep ? -68 : -46, -4.5), // stay under the surface and above the sand
        target.z - Math.cos(az) * Math.cos(el) * dist,
      );
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
  };
}
