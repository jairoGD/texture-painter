import { element } from './index.js';
import { createFloatingPanel } from './floating-panel.js';
import './texture-preview.css';

export function createTexturePreview({ getTexture, onClose }) {
  const canvas = element('canvas', { className: 'texture-preview__canvas',
    attributes: { width: 1024, height: 1024, 'aria-label': 'Composited material texture' } });
  const empty = element('p', { className: 'texture-preview__empty', text: 'No material selected' });
  const body = element('div', { className: 'texture-preview__body' }, [canvas, empty]);
  const panel = createFloatingPanel({ title: '2D Texture', className: 'texture-preview',
    children: [body], onClose: () => { stop(); onClose?.(); } });
  let targetId = null;
  let frame = null;
  let lastSource = null;
  let lastRevision = -1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;

  function fitScale() {
    if (!canvas.width || !canvas.height) return 1;
    return Math.min(Math.max(1, body.clientWidth - 24) / canvas.width,
      Math.max(1, body.clientHeight - 24) / canvas.height);
  }
  function updateView() {
    const scale = fitScale() * zoom;
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
    canvas.style.left = `${body.clientWidth / 2 + panX}px`;
    canvas.style.top = `${body.clientHeight / 2 + panY}px`;
    canvas.style.imageRendering = scale >= 1 ? 'pixelated' : 'auto';
  }
  function resetView() {
    zoom = 1;
    panX = panY = 0;
    updateView();
  }

  body.addEventListener('wheel', (event) => {
    if (canvas.hidden) return;
    event.preventDefault();
    const rect = body.getBoundingClientRect();
    const x = event.clientX - rect.left - body.clientWidth / 2;
    const y = event.clientY - rect.top - body.clientHeight / 2;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? body.clientHeight : 1);
    const next = Math.max(0.1, Math.min(64, zoom * Math.exp(-delta * 0.0015)));
    const factor = next / zoom;
    panX = x - (x - panX) * factor;
    panY = y - (y - panY) * factor;
    zoom = next;
    updateView();
  }, { passive: false });
  body.addEventListener('pointerdown', (event) => {
    if (canvas.hidden || (event.button !== 0 && event.button !== 1)) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      panX, panY };
    body.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  body.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.pointerId) return;
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
    updateView();
  });
  function endDrag(event) {
    if (event.pointerId !== drag?.pointerId) return;
    drag = null;
    if (body.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
  }
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);
  body.addEventListener('dblclick', (event) => {
    if (canvas.hidden) return;
    event.preventDefault();
    resetView();
  });
  new ResizeObserver(updateView).observe(body);

  function draw() {
    frame = null;
    if (!panel.isVisible()) return;
    const preview = getTexture(targetId);
    const source = preview?.canvas;
    empty.hidden = Boolean(source);
    canvas.hidden = !source;
    if (source && (source !== lastSource || preview.revision !== lastRevision)) {
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
        updateView();
      }
      const context = canvas.getContext('2d');
      if (source === lastSource && preview.revision === lastRevision + 1 && preview.regions?.length) {
        for (const region of preview.regions) {
          const width = region.right - region.left;
          const height = region.bottom - region.top;
          context.drawImage(source, region.left, region.top, width, height,
            region.left, region.top, width, height);
        }
      } else context.drawImage(source, 0, 0);
      lastSource = source;
      lastRevision = preview.revision;
    }
    frame = requestAnimationFrame(draw);
  }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function setVisible(visible) {
    panel.setVisible(visible);
    if (visible && frame === null) frame = requestAnimationFrame(draw);
    if (!visible) stop();
  }
  function setTarget(id, label) {
    if (targetId !== id) resetView();
    targetId = id;
    panel.setSubtitle(label);
    lastSource = null;
  }

  return { element: panel.element, setVisible, isVisible: panel.isVisible, setTarget };
}
