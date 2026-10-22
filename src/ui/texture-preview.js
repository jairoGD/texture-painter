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
      }
      canvas.getContext('2d').drawImage(source, 0, 0);
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
    targetId = id;
    panel.setSubtitle(label);
    lastSource = null;
  }

  return { element: panel.element, setVisible, isVisible: panel.isVisible, setTarget };
}
