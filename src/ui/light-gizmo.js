import { element } from './index.js';
import './light-gizmo.css';

export function createLightGizmo({ onChange, onEnd, onReset }) {
  const beam = element('span', { className: 'light-gizmo__beam' });
  const sphere = element('span', { className: 'light-gizmo__sphere' });
  const sun = element('span', { className: 'light-gizmo__sun' });
  const stage = element('span', { className: 'light-gizmo__stage' }, [beam, sphere, sun]);
  const root = element('button', { className: 'light-gizmo', attributes: {
    type: 'button', title: 'Drag to rotate scene lighting. Double-click to reset.',
    'aria-label': 'Rotate scene lighting. Drag horizontally or vertically; double-click to reset.'
  } }, [element('span', { className: 'light-gizmo__label', text: 'LIGHT' }), stage]);
  let state = { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 };
  let gesture = null;

  function setState(next) {
    state = next;
    const x = next.x * 29;
    const y = -next.y * 29;
    const length = Math.hypot(x, y);
    sun.style.left = `calc(50% + ${x}px)`;
    sun.style.top = `calc(50% + ${y}px)`;
    sun.classList.toggle('is-behind', next.z < 0);
    beam.style.width = `${length}px`;
    beam.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
    sphere.style.setProperty('--light-x', `${50 + next.x * 35}%`);
    sphere.style.setProperty('--light-y', `${50 - next.y * 35}%`);
    root.setAttribute('aria-label', `Rotate scene lighting. Horizontal ${Math.round(next.yaw * 180 / Math.PI)} degrees, vertical ${Math.round(next.pitch * 180 / Math.PI)} degrees.`);
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
      yaw: state.yaw, pitch: state.pitch, moved: false };
    root.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging');
  });
  root.addEventListener('pointermove', (event) => {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault();
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    gesture.moved = true;
    onChange?.(gesture.yaw + dx * 0.012, gesture.pitch - dy * 0.012);
  });
  function endGesture(event) {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault();
    event.stopPropagation();
    const moved = gesture.moved;
    gesture = null;
    root.classList.remove('is-dragging');
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (moved) onEnd?.();
  }
  root.addEventListener('pointerup', endGesture);
  root.addEventListener('pointercancel', endGesture);
  root.addEventListener('dblclick', (event) => {
    event.preventDefault();
    onReset?.();
  });
  root.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.05 : 0.15;
    if (event.key === 'Home') {
      onReset?.();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowLeft') onChange?.(state.yaw - step, state.pitch);
    else if (event.key === 'ArrowRight') onChange?.(state.yaw + step, state.pitch);
    else if (event.key === 'ArrowUp') onChange?.(state.yaw, state.pitch + step);
    else if (event.key === 'ArrowDown') onChange?.(state.yaw, state.pitch - step);
    else return;
    event.preventDefault();
    event.stopPropagation();
    onEnd?.();
  });
  setState(state);
  return { element: root, setState };
}
