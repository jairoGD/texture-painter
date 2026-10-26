import { button, element } from './index.js';
import './bake-dialog.css';

export function createBakeDialog({ onBake, onError, onComplete }) {
  const title = element('h2', { text: 'Ambient Occlusion' });
  const closeButton = button({ label: 'Close bake panel', icon: '×', variant: 'ghost',
    iconOnly: true, onClick: close });
  const target = element('p', { className: 'bake-dialog__target' });
  const resolution = element('select', { attributes: { 'aria-label': 'Bake resolution' } },
    [256, 512, 1024].map((value) => element('option', { text: `${value} × ${value}`,
      attributes: { value } })));
  resolution.value = '512';
  const samples = element('select', { attributes: { 'aria-label': 'AO samples' } },
    [8, 16, 32, 64].map((value) => element('option', { text: `${value} rays`,
      attributes: { value } })));
  samples.value = '32';
  const reach = element('input', { attributes: { type: 'range', min: 1, max: 100,
    value: 20, 'aria-label': 'AO reach' } });
  const reachValue = element('output', { text: '20%' });
  reach.addEventListener('input', () => { reachValue.value = `${reach.value}%`; });
  const strength = element('input', { attributes: { type: 'range', min: 0, max: 100,
    value: 100, 'aria-label': 'AO strength' } });
  const strengthValue = element('output', { text: '100%' });
  strength.addEventListener('input', () => { strengthValue.value = `${strength.value}%`; });
  const shadeSmooth = element('input', { attributes: { type: 'checkbox' } });
  const ignoreNearby = element('input', { attributes: { type: 'checkbox' } });
  const curvatureMode = element('select', { attributes: { 'aria-label': 'Curvature output' } }, [
    element('option', { text: 'Convex edges', attributes: { value: 'convex' } }),
    element('option', { text: 'Cavities', attributes: { value: 'cavity' } }),
    element('option', { text: 'Both (signed)', attributes: { value: 'signed' } })
  ]);
  const edgeWidth = element('input', { attributes: { type: 'range', min: 0.1, max: 10,
    step: 0.1, value: 2, 'aria-label': 'Curvature edge width' } });
  const edgeWidthValue = element('output', { text: '2%' });
  edgeWidth.addEventListener('input', () => { edgeWidthValue.value = `${edgeWidth.value}%`; });
  const minimumAngle = element('input', { attributes: { type: 'range', min: 0, max: 180,
    step: 1, value: 10, 'aria-label': 'Minimum edge angle' } });
  const minimumAngleValue = element('output', { text: '10°' });
  minimumAngle.addEventListener('input', () => {
    minimumAngleValue.value = `${minimumAngle.value}°`;
  });
  const markedSharpOnly = element('input', { attributes: { type: 'checkbox' } });
  const aoOptions = element('div', { className: 'bake-dialog__options' }, [
    element('label', {}, [element('span', { text: 'Samples' }), samples]),
    element('label', {}, [element('span', { className: 'bake-dialog__label' },
      [element('span', { text: 'Reach · model size' }), reachValue]), reach]),
    element('label', { className: 'bake-dialog__checkbox' },
      [shadeSmooth, element('span', { text: 'Shade smooth' })]),
    element('label', { className: 'bake-dialog__checkbox', attributes: {
      title: 'Only the selected material’s mesh can occlude itself.' } },
    [ignoreNearby, element('span', { text: 'Ignore nearby objects' })])
  ]);
  const curvatureOptions = element('div', { className: 'bake-dialog__options',
    attributes: { hidden: '' } }, [
    element('label', {}, [element('span', { text: 'Output' }), curvatureMode]),
    element('label', {}, [element('span', { className: 'bake-dialog__label' },
      [element('span', { text: 'Edge width · model size' }), edgeWidthValue]), edgeWidth]),
    element('label', {}, [element('span', { className: 'bake-dialog__label' },
      [element('span', { text: 'Minimum edge angle' }), minimumAngleValue]), minimumAngle]),
    element('label', { className: 'bake-dialog__checkbox', attributes: {
      title: 'Detect sharp edges from splits in the imported vertex normals.' } },
    [markedSharpOnly, element('span', { text: 'Marked sharp only' })])
  ]);
  const progress = element('p', { className: 'bake-dialog__progress',
    attributes: { role: 'status', 'aria-live': 'polite' } });
  const cancelButton = button({ label: 'Cancel', variant: 'ghost', onClick: close });
  const bakeButton = button({ label: 'Bake', variant: 'primary', onClick: bake });
  const card = element('section', { className: 'bake-dialog__card', attributes: {
    role: 'dialog', 'aria-labelledby': 'bake-dialog-title' } }, [
    element('div', { className: 'bake-dialog__header' }, [title, closeButton]),
    element('div', { className: 'bake-dialog__body' }, [target,
      element('label', {}, [element('span', { text: 'Resolution' }), resolution]),
      aoOptions, curvatureOptions,
      element('label', {}, [element('span', { className: 'bake-dialog__label' },
        [element('span', { text: 'Strength' }), strengthValue]), strength]),
      progress
    ]),
    element('div', { className: 'bake-dialog__actions' }, [cancelButton, bakeButton])
  ]);
  title.id = 'bake-dialog-title';
  const root = element('div', { className: 'bake-dialog', attributes: { hidden: '' } }, [card]);
  let targetId = null;
  let bakeType = 'ambientOcclusion';
  let controller = null;

  function close() {
    controller?.abort();
    controller = null;
    root.hidden = true;
    targetId = null;
    bakeButton.disabled = false;
    progress.textContent = '';
  }

  function open(id, label, type = 'ambientOcclusion') {
    if (!id) return false;
    targetId = id;
    bakeType = type === 'curvature' ? 'curvature' : 'ambientOcclusion';
    title.textContent = bakeType === 'curvature' ? 'Curvature' : 'Ambient Occlusion';
    aoOptions.hidden = bakeType !== 'ambientOcclusion';
    curvatureOptions.hidden = bakeType !== 'curvature';
    target.textContent = `Material: ${label}`;
    progress.textContent = '';
    card.style.left = `${Math.max(12, window.innerWidth - 322)}px`;
    card.style.top = '72px';
    root.hidden = false;
    bakeButton.focus();
    return true;
  }

  async function bake() {
    if (!targetId || controller) return;
    controller = new AbortController();
    const running = controller;
    bakeButton.disabled = true;
    progress.textContent = 'Preparing geometry…';
    try {
      const type = bakeType;
      const options = type === 'curvature' ? {
        resolution: Number(resolution.value), strength: Number(strength.value),
        width: Number(edgeWidth.value), mode: curvatureMode.value,
        angle: Number(minimumAngle.value), markedSharpOnly: markedSharpOnly.checked
      } : {
        resolution: Number(resolution.value), samples: Number(samples.value),
        distance: Number(reach.value), strength: Number(strength.value),
        shadeSmooth: shadeSmooth.checked, selfOcclusionOnly: ignoreNearby.checked
      };
      const result = await onBake(type, targetId, options, (fraction) => {
        if (controller === running)
          progress.textContent = `Baking… ${Math.round(fraction * 100)}%`;
      }, running.signal);
      if (controller !== running) return;
      close();
      if (result) onComplete?.(type);
      else onError?.('Could not create the baked layer.');
    } catch (error) {
      if (controller !== running) return;
      controller = null;
      bakeButton.disabled = false;
      if (error.name === 'AbortError') return;
      progress.textContent = 'Bake failed';
      onError?.(error.message || 'Bake failed.');
    }
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  });
  return { element: root, open, close, isBusy: () => Boolean(controller) };
}
