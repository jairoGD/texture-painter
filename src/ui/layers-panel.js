import { addGraphLayer, moveGraphLayer, readLayerStack, removeGraphLayer } from '../editor/layer-graph.js';
import { BLEND_MODES, cloneTextureGraph } from '../editor/texture-graph.js';
import { button, element } from './index.js';
import upIcon from './icons/layer-up.svg';
import downIcon from './icons/layer-down.svg';
import addIcon from './icons/layer-add.svg';
import importIcon from './icons/layer-import.svg';
import imageIcon from './icons/image.svg';
import removeIcon from './icons/layer-remove.svg';
import eyeIcon from './icons/layer-eye.svg';
import hiddenIcon from './icons/layer-hidden.svg';
import './layers-panel.css';

export function createLayersPanel({ nodeEditor, onCreateImage, onImportImage, onMergeLayer, onError }) {
  const selectedByTarget = new Map();
  const material = element('select', { className: 'layers-panel__select',
    attributes: { 'aria-label': 'Texture material' } });
  const list = element('div', { className: 'layers-panel__list', attributes: { role: 'listbox', 'aria-label': 'Layers' } });
  const newImageInput = element('input', { attributes: { type: 'file', accept: 'image/*', hidden: '' } });
  const replaceImageInput = element('input', { attributes: { type: 'file', accept: 'image/*', hidden: '' } });
  const upButton = button({ label: 'Move layer up', iconUrl: upIcon, variant: 'ghost', iconOnly: true,
    title: 'Move layer up', onClick: () => move(-1) });
  const downButton = button({ label: 'Move layer down', iconUrl: downIcon, variant: 'ghost', iconOnly: true,
    title: 'Move layer down', onClick: () => move(1) });
  const addButton = button({ label: 'Add paint layer', iconUrl: addIcon, variant: 'ghost', iconOnly: true,
    title: 'Add paint layer', onClick: () => addLayer() });
  const mergeButton = button({ label: 'Merge layer down', iconUrl: importIcon, variant: 'ghost', iconOnly: true,
    title: 'Merge layer down', onClick: merge });
  const openButton = button({ label: 'Open image as layer', iconUrl: imageIcon, variant: 'ghost', iconOnly: true,
    title: 'Open image as layer', onClick: () => newImageInput.click() });
  const removeButton = button({ label: 'Remove layer', iconUrl: removeIcon, variant: 'ghost', iconOnly: true,
    title: 'Remove layer', onClick: remove });
  const root = element('aside', { className: 'layers-sidebar', attributes: { 'aria-label': 'Layers sidebar' } }, [
    element('div', { className: 'layers-panel__header' }, [element('h2', { text: 'LAYERS' }), material]),
    element('div', { className: 'layers-panel__toolbar' }, [upButton, downButton, addButton, mergeButton, openButton, removeButton]),
    list,
    newImageInput, replaceImageInput
  ]);

  material.addEventListener('change', () => nodeEditor.selectTarget(material.value));
  function current() { return nodeEditor.getState(); }
  function selectedLayer(state) {
    const layers = state.graph ? readLayerStack(state.graph).layers : [];
    const id = selectedByTarget.get(state.targetId);
    return layers.find((layer) => layer.id === id) ?? null;
  }
  function fail(error) { onError?.(error?.message || 'Unable to update layer'); }

  async function addLayer(file = null) {
    const state = current();
    if (!state.graph) return;
    const graph = cloneTextureGraph(state.graph);
    const created = addGraphLayer(graph, 'image');
    if (!created) return;
    try {
      const asset = file ? await onImportImage(state.targetId, created.source.id, file)
        : onCreateImage(state.targetId, created.source.id);
      if (!asset) throw new Error('Unable to create image layer');
      created.source.imageKey = asset.key;
      created.source.imageName = asset.name;
      if (file) created.mix.layerName = file.name;
      if (current().targetId !== state.targetId) return;
      selectedByTarget.set(state.targetId, created.mix.id);
      nodeEditor.replaceGraph(graph);
      nodeEditor.choosePaintSource(created.source.id);
    } catch (error) { fail(error); }
  }

  function move(direction) {
    const state = current();
    const selected = selectedLayer(state);
    if (!selected) return;
    const graph = cloneTextureGraph(state.graph);
    if (moveGraphLayer(graph, selected.id, direction)) nodeEditor.replaceGraph(graph);
  }

  function merge() {
    const state = current();
    const selected = selectedLayer(state);
    if (!selected) return;
    try {
      const merged = onMergeLayer?.(state.targetId, selected.id, state.graph);
      if (!merged) return;
      selectedByTarget.set(state.targetId, merged.layerId);
      nodeEditor.replaceGraph(merged.graph);
      nodeEditor.choosePaintSource(merged.sourceId);
    } catch (error) { fail(error); }
  }

  function remove() {
    const state = current();
    const selected = selectedLayer(state);
    if (!selected) return;
    const graph = cloneTextureGraph(state.graph);
    if (!removeGraphLayer(graph, selected.id)) return;
    selectedByTarget.set(state.targetId, readLayerStack(graph).layers[0]?.id ?? null);
    nodeEditor.replaceGraph(graph);
  }

  async function replaceImage(file) {
    const state = current();
    const selected = selectedLayer(state);
    if (!selected || selected.type !== 'image') return;
    try {
      const asset = await onImportImage(state.targetId, selected.source.id, file);
      if (!asset) throw new Error('Unable to open image');
      const latest = current();
      if (latest.targetId !== state.targetId || !latest.graph?.nodes.some((node) => node.id === selected.source.id)) return;
      const graph = cloneTextureGraph(latest.graph);
      const source = graph.nodes.find((node) => node.id === selected.source.id);
      source.imageKey = asset.key;
      source.imageName = asset.name;
      nodeEditor.replaceGraph(graph);
      nodeEditor.choosePaintSource(source.id);
    } catch (error) { fail(error); }
  }

  newImageInput.addEventListener('change', async () => {
    const file = newImageInput.files?.[0];
    if (file) await addLayer(file);
    newImageInput.value = '';
  });
  replaceImageInput.addEventListener('change', async () => {
    const file = replaceImageInput.files?.[0];
    if (file) await replaceImage(file);
    replaceImageInput.value = '';
  });

  function selectLayer(state, id, source) {
    selectedByTarget.set(state.targetId, id);
    if (source?.type === 'image' && source.imageKey) nodeEditor.choosePaintSource(source.id);
    else render(current());
  }

  function beginRename(row, id, label) {
    if (row.querySelector('.layers-panel__rename')) return;
    const input = element('input', { className: 'layers-panel__rename-input',
      attributes: { type: 'text', value: label, 'aria-label': 'Layer name', maxlength: '100' } });
    const save = button({ label: 'Save name', icon: '✓', variant: 'ghost', iconOnly: true });
    const cancel = button({ label: 'Cancel rename', icon: '×', variant: 'ghost', iconOnly: true });
    const popover = element('div', { className: 'layers-panel__rename' }, [input,
      element('div', { className: 'layers-panel__rename-actions' }, [save, cancel])]);
    const outside = (event) => { if (!popover.contains(event.target)) close(); };
    const close = () => {
      document.removeEventListener('pointerdown', outside);
      popover.remove();
    };
    const commit = () => {
      const value = input.value.trim();
      close();
      if (value && value !== label) editSpecificLayer(id, (node) => { node.layerName = value; });
    };
    popover.addEventListener('click', (event) => event.stopPropagation());
    popover.addEventListener('keydown', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); close(); row.focus(); }
    });
    save.addEventListener('click', commit);
    cancel.addEventListener('click', close);
    row.append(popover);
    document.addEventListener('pointerdown', outside);
    input.focus(); input.select();
  }

  function createRow({ state, id, node, source, label, selected }) {
    const row = element('div', { className: 'layers-panel__row', attributes: {
      role: 'option', 'aria-selected': String(selected), tabindex: '0'
    } });
    const visible = button({ label: node.layerVisible === false ? 'Show layer' : 'Hide layer',
      iconUrl: node.layerVisible === false ? hiddenIcon : eyeIcon, variant: 'ghost', iconOnly: true,
      title: node.layerVisible === false ? 'Show layer' : 'Hide layer',
      onClick: () => editSpecificLayer(id, (target) => { target.layerVisible = target.layerVisible === false; }) });
    visible.classList.add('layers-panel__visibility');
    const swatch = element('span', { className: 'layers-panel__swatch',
      attributes: { title: source ? 'Double-click to replace image' : 'Paint layer' } });
    const name = element('span', { className: 'layers-panel__name', text: label,
      attributes: { title: 'Double-click to rename layer' } });
    const blend = element('select', { className: 'layers-panel__blend',
      attributes: { 'aria-label': `Blend mode for ${label}`, title: 'Blend mode' } },
      BLEND_MODES.map(([value, modeLabel]) => element('option', { text: modeLabel, attributes: { value } })));
    blend.value = node.mode || 'mix';
    blend.addEventListener('click', (event) => event.stopPropagation());
    blend.addEventListener('change', (event) => {
      event.stopPropagation();
      editSpecificLayer(id, (target) => { target.mode = blend.value; });
    });
    const opacityValue = Math.round((node.factor ?? 1) * 100);
    const opacity = element('input', { className: 'layers-panel__opacity', attributes: {
      type: 'range', min: '0', max: '100', value: opacityValue, 'aria-label': `Opacity for ${label}`,
      title: 'Opacity' } });
    const opacityText = element('output', { className: 'layers-panel__opacity-value', text: `${opacityValue}%` });
    const opacityWrap = element('div', { className: 'layers-panel__opacity-wrap' }, [opacity, opacityText]);
    let before = null;
    opacity.addEventListener('pointerdown', (event) => event.stopPropagation());
    opacity.addEventListener('click', (event) => event.stopPropagation());
    opacity.addEventListener('input', (event) => {
      event.stopPropagation();
      if (!before) before = current().graph;
      opacityText.value = `${opacity.value}%`;
      nodeEditor.previewGraph((graph) => {
        const target = graph.nodes.find((candidate) => candidate.id === id);
        if (target) target.factor = Number(opacity.value) / 100;
      });
    });
    opacity.addEventListener('change', (event) => {
      event.stopPropagation();
      if (before) nodeEditor.finishGraphChange(before);
      before = null;
    });
    row.append(visible, swatch, name,
      element('div', { className: 'layers-panel__controls' }, [blend, opacityWrap]));
    row.addEventListener('click', (event) => {
      if (visible.contains(event.target) || blend.contains(event.target) || opacityWrap.contains(event.target)) return;
      if (event.detail >= 2 && name.contains(event.target)) { beginRename(row, id, label); return; }
      if (!selected) selectLayer(state, id, source);
    });
    row.addEventListener('dblclick', (event) => {
      if (swatch.contains(event.target) && source) { selectLayer(state, id, source); replaceImageInput.click(); }
      else if (name.contains(event.target)) beginRename(row, id, label);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); selectLayer(state, id, source);
      }
      if (event.key === 'F2') { event.preventDefault(); beginRename(row, id, label); }
    });
    return row;
  }

  function render(state) {
    const hasGraph = Boolean(state.graph);
    material.replaceChildren(...state.targets.map(({ id, label }) =>
      element('option', { text: label, attributes: { value: id } })));
    if (state.targetId) material.value = state.targetId;
    material.hidden = state.targets.length < 2;
    material.disabled = !hasGraph;
    addButton.disabled = !hasGraph;
    openButton.disabled = !hasGraph;
    if (!hasGraph) {
      list.replaceChildren(element('p', { className: 'layers-panel__empty', text: 'Import a GLB model to start painting.' }));
      upButton.disabled = downButton.disabled = mergeButton.disabled = removeButton.disabled = true;
      return;
    }
    const { layers } = readLayerStack(state.graph);
    const chosen = selectedByTarget.get(state.targetId);
    const paintingLayer = layers.find((layer) => layer.source.id === state.paintSource);
    if (paintingLayer && chosen !== paintingLayer.id)
      selectedByTarget.set(state.targetId, paintingLayer.id);
    else if (!chosen || !layers.some((layer) => layer.id === chosen))
      selectedByTarget.set(state.targetId, layers[0]?.id ?? null);
    const selected = selectedLayer(state);
    list.replaceChildren(...layers.map((layer) => createRow({ state, id: layer.id, node: layer.mix,
      source: layer.source, label: layer.label, selected: selected?.id === layer.id })));
    const index = layers.findIndex((layer) => layer.id === selected?.id);
    upButton.disabled = index <= 0;
    downButton.disabled = index < 0 || index >= layers.length - 1;
    mergeButton.disabled = index < 0 || index >= layers.length - 1;
    removeButton.disabled = !selected;
  }

  function editSpecificLayer(id, mutator) {
    const state = current();
    const graph = cloneTextureGraph(state.graph);
    const mix = graph.nodes.find((node) => node.id === id);
    if (!mix) return;
    mutator(mix);
    nodeEditor.replaceGraph(graph);
  }

  function setState(state) { render(state); }
  setState(current());
  return { element: root, setState };
}
