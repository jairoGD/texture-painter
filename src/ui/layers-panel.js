import { addGraphLayer, copyGraphLayerTree, layerAncestors, moveGraphLayer,
  moveGraphLayerTo, pasteGraphLayerTree, readLayerStack, removeGraphLayer,
  syncLayerMasks } from '../editor/layer-graph.js';
import { BLEND_MODES, cloneTextureGraph } from '../editor/texture-graph.js';
import { button, element, toggleButton } from './index.js';
import { createMaterialsPanel } from './materials-panel.js';
import { createLayerImageProperties } from './layer-image-properties.js';
import upIcon from './icons/layer-up.svg';
import downIcon from './icons/layer-down.svg';
import addIcon from './icons/layer-add.svg';
import importIcon from './icons/layer-import.svg';
import imageIcon from './icons/image.svg';
import removeIcon from './icons/layer-remove.svg';
import eyeIcon from './icons/layer-eye.svg';
import hiddenIcon from './icons/layer-hidden.svg';
import maskIcon from './icons/mask.svg';
import invertIcon from './icons/invert_color.svg';
import './layers-panel.css';

export function createLayersPanel({ nodeEditor, onCreateImage, onImportImage, onMergeLayer,
  getImageCanvas, getImageInfo, getMaterialVisibilityState,
  onToggleMaterialVisibility, onToggleMaterialIsolation, onError }) {
  const selectedByTarget = new Map();
  let draggingId = null;
  let copiedLayers = null;
  let contextMenu = null;
  const materialsPanel = createMaterialsPanel({
    onSelect: (id) => nodeEditor.selectTarget(id),
    onToggleVisibility: (id) => {
      onToggleMaterialVisibility?.(id);
      refreshMaterials();
    },
    onToggleIsolation: (id) => {
      onToggleMaterialIsolation?.(id);
      refreshMaterials();
    }
  });
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
  const maskToggle = toggleButton({ label: 'Mask', iconUrl: maskIcon,
    className: 'layers-panel__option-toggle', onChange: (checked) => {
      const selected = selectedLayer(current());
      if (selected) editSpecificLayer(selected.id, (node) => { node.layerIsMask = checked; });
    } });
  const invertToggle = toggleButton({ label: 'Invert', iconUrl: invertIcon,
    className: 'layers-panel__option-toggle', onChange: (checked) => {
      const selected = selectedLayer(current());
      if (selected) editSpecificLayer(selected.id, (node) => { node.layerInvert = checked; });
    } });
  const optionsPanel = element('div', { className: 'layers-panel__options' }, [maskToggle, invertToggle]);
  const rootDrop = element('div', { className: 'layers-panel__root-drop',
    text: 'Drop here to move out of group' });
  const imageProperties = createLayerImageProperties({
    getImageInfo,
    onEdit: (nodeId, key, value) => editImageNode(nodeId, (node) => { node[key] = value; })
  });
  const root = element('aside', { className: 'layers-sidebar', attributes: { 'aria-label': 'Layers sidebar' } }, [
    materialsPanel.element,
    element('div', { className: 'ui-section-header' }, [element('h2', { text: 'LAYERS' }), optionsPanel]),
    element('div', { className: 'layers-panel__toolbar' }, [upButton, downButton, addButton, mergeButton, openButton, removeButton]),
    list,
    imageProperties.element,
    newImageInput, replaceImageInput
  ]);

  function dropLayer(targetId, placement) {
    if (!draggingId) return;
    const state = current();
    const graph = cloneTextureGraph(state.graph);
    if (!moveGraphLayerTo(graph, draggingId, targetId, placement)) return;
    const moved = readLayerStack(graph).layers.find((layer) => layer.id === draggingId);
    selectedByTarget.set(state.targetId, draggingId);
    clearDragState();
    nodeEditor.replaceGraph(graph);
    if (moved?.source.type === 'image' && moved.source.imageKey)
      nodeEditor.choosePaintSource(moved.source.id);
  }
  function clearDragState() {
    draggingId = null;
    root.classList.remove('is-dragging-layer');
    rootDrop.classList.remove('is-drop-target');
    list.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-inside, .is-drag-source')
      .forEach((item) => item.classList.remove('is-drop-before', 'is-drop-after',
        'is-drop-inside', 'is-drag-source'));
  }
  rootDrop.addEventListener('dragover', (event) => {
    if (!draggingId) return;
    event.preventDefault();
    rootDrop.classList.add('is-drop-target');
  });
  rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('is-drop-target'));
  rootDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    dropLayer(null, 'root');
    rootDrop.classList.remove('is-drop-target');
  });

  function current() { return nodeEditor.getState(); }
  function refreshMaterials(state = current()) {
    materialsPanel.setState(state.targets, state.targetId, getMaterialVisibilityState?.());
  }
  function selectedLayer(state) {
    const layers = state.graph ? readLayerStack(state.graph).layers : [];
    const id = selectedByTarget.get(state.targetId);
    return layers.find((layer) => layer.id === id) ?? null;
  }
  function fail(error) { onError?.(error?.message || 'Unable to update layer'); }

  function copyLayer(state, layerId) {
    const tree = copyGraphLayerTree(state.graph, layerId);
    if (!tree) return null;
    return tree.map((item) => {
      const image = getImageCanvas?.(state.targetId, item.source.imageKey);
      if (!image) throw new Error(`Image missing from ${item.label}`);
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return { ...item, canvas,
        imported: getImageInfo?.(state.targetId, item.source.imageKey)?.imported ?? false };
    });
  }

  function pasteLayer(copied = copiedLayers, beforeId = selectedLayer(current())?.id) {
    if (!copied?.length) return;
    const state = current();
    if (!state.graph) return;
    const graph = cloneTextureGraph(state.graph);
    const created = pasteGraphLayerTree(graph, copied, beforeId);
    if (!created) return;
    try {
      for (const { original, source } of created) {
        const asset = onCreateImage(state.targetId, source.id, original.canvas,
          original.source.imageName || original.label, original.imported);
        if (!asset) throw new Error(`Unable to copy image from ${original.label}`);
        source.imageKey = asset.key;
        source.imageName = asset.name;
      }
      selectedByTarget.set(state.targetId, created[0].mix.id);
      nodeEditor.replaceGraph(graph);
      nodeEditor.choosePaintSource(created[0].source.id);
    } catch (error) { fail(error); }
  }

  function convertToBitmap(layerId) {
    const state = current();
    const layer = state.graph && readLayerStack(state.graph).layers
      .find((item) => item.id === layerId);
    if (!layer?.source.vertexColor) return;
    try {
      const image = getImageCanvas?.(state.targetId, layer.source.imageKey, true);
      if (!image) throw new Error('Unable to render vertex colors for this layer');
      const asset = onCreateImage(state.targetId, layer.source.id, image, layer.label);
      if (!asset) throw new Error('Unable to create bitmap layer');
      const graph = cloneTextureGraph(state.graph);
      const source = graph.nodes.find((node) => node.id === layer.source.id);
      source.vertexColor = false;
      source.imageKey = asset.key;
      source.imageName = asset.name;
      source.projection = 'flat';
      source.extension = 'clip';
      source.scale = 1;
      source.rotation = source.offsetU = source.offsetV = 0;
      delete source.warp;
      selectedByTarget.set(state.targetId, layerId);
      nodeEditor.replaceGraph(graph);
      nodeEditor.choosePaintSource(source.id);
    } catch (error) { fail(error); }
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
    document.removeEventListener('pointerdown', outsideContextMenu, true);
    document.removeEventListener('keydown', contextMenuKeydown, true);
    window.removeEventListener('blur', closeContextMenu);
    window.removeEventListener('scroll', closeContextMenu, true);
  }
  function outsideContextMenu(event) {
    if (!contextMenu?.contains(event.target)) closeContextMenu();
  }
  function contextMenuKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(); }
  }
  function showContextMenu(event, state, layerId, source) {
    event.preventDefault();
    closeContextMenu();
    selectLayer(state, layerId, source);
    const item = (label, action, disabled = false) => {
      const control = element('button', { text: label,
        attributes: { type: 'button', role: 'menuitem' } });
      control.disabled = disabled;
      control.addEventListener('click', () => { closeContextMenu(); action(); });
      return control;
    };
    contextMenu = element('div', { className: 'layers-panel__context-menu',
      attributes: { role: 'menu', 'aria-label': 'Layer actions' } }, [
      item('Copy', () => { try { copiedLayers = copyLayer(current(), layerId); } catch (error) { fail(error); } }),
      item('Paste', () => pasteLayer(copiedLayers, layerId), !copiedLayers),
      item('Duplicate', () => {
        try { pasteLayer(copyLayer(current(), layerId), layerId); } catch (error) { fail(error); }
      }),
      item('Convert to bitmap layer', () => convertToBitmap(layerId), !source?.vertexColor)
    ]);
    document.body.append(contextMenu);
    const bounds = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - bounds.width - 4))}px`;
    contextMenu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - bounds.height - 4))}px`;
    document.addEventListener('pointerdown', outsideContextMenu, true);
    document.addEventListener('keydown', contextMenuKeydown, true);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);
  }

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
      if (file) {
        created.source.extension = 'clip';
        created.mix.layerName = file.name;
      }
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
      source.extension = 'clip';
      nodeEditor.replaceGraph(graph);
      nodeEditor.choosePaintSource(source.id);
    } catch (error) { fail(error); }
  }

  function editImageNode(nodeId, mutator) {
    const state = current();
    if (!state.graph) return;
    const graph = cloneTextureGraph(state.graph);
    const node = graph.nodes.find((item) => item.id === nodeId && item.type === 'image');
    if (!node) return;
    mutator(node);
    nodeEditor.replaceGraph(graph);
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

  function createRow({ state, id, node, source, label, selected, depth, layers }) {
    const row = element('div', { className: 'layers-panel__row', attributes: {
      role: 'option', 'aria-selected': String(selected), tabindex: '0', draggable: 'true'
    } });
    row.style.setProperty('--layer-depth', Math.min(depth, 8));
    if (depth) row.classList.add('is-child');
    const inheritedHidden = layerAncestors(layers, { id, mix: node })
      .some((ancestor) => ancestor.mix.layerVisible === false);
    if (inheritedHidden) row.classList.add('is-inherited-hidden');
    if (node.layerIsMask) row.classList.add('is-mask');
    const visibilityLabel = inheritedHidden ? 'Hidden by parent' : node.layerIsMask ?
      node.layerVisible === false ? 'Enable mask' : 'Disable mask' :
      node.layerVisible === false ? 'Show layer' : 'Hide layer';
    const visible = button({ label: visibilityLabel,
      iconUrl: inheritedHidden || node.layerVisible === false ? hiddenIcon : eyeIcon,
      variant: 'ghost', iconOnly: true,
      title: visibilityLabel,
      onClick: () => editSpecificLayer(id, (target) => { target.layerVisible = target.layerVisible === false; }) });
    visible.disabled = inheritedHidden;
    visible.classList.add('layers-panel__visibility');
    const swatch = element('span', { className: 'layers-panel__swatch',
      attributes: { title: source ? 'Double-click to replace image' : 'Paint layer' } });
    if (source?.imageKey) {
      const thumbnail = element('canvas', { className: 'layers-panel__thumbnail',
        attributes: { width: '52', height: '50' } });
      thumbnail.dataset.targetId = state.targetId;
      thumbnail.dataset.imageKey = source.imageKey;
      thumbnail.dataset.vertexColor = String(Boolean(source.vertexColor));
      thumbnail.dataset.inverted = String(node.layerIsMask ? !node.layerInvert : Boolean(node.layerInvert));
      swatch.append(thumbnail);
    }
    const name = element('span', { className: 'layers-panel__name', text: label,
      attributes: { title: 'Double-click to rename layer' } });
    const maskBadge = node.layerIsMask ? element('span', { className: 'layers-panel__mask-badge',
      text: 'MASK', attributes: { title: 'Masks child layers' } }) : null;
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
    let adjustingOpacity = false;
    const restoreLayerDrag = () => {
      adjustingOpacity = false;
      row.draggable = true;
      window.removeEventListener('pointerup', restoreLayerDrag, true);
      window.removeEventListener('pointercancel', restoreLayerDrag, true);
      window.removeEventListener('blur', restoreLayerDrag);
    };
    opacity.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      adjustingOpacity = true;
      row.draggable = false;
      window.addEventListener('pointerup', restoreLayerDrag, true);
      window.addEventListener('pointercancel', restoreLayerDrag, true);
      window.addEventListener('blur', restoreLayerDrag);
    });
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
    row.append(...[visible, swatch, name, maskBadge,
      node.layerIsMask ? null : element('div', { className: 'layers-panel__controls' }, [blend, opacityWrap])]
      .filter(Boolean));
    row.addEventListener('click', (event) => {
      if (visible.contains(event.target) || blend.contains(event.target) || opacityWrap.contains(event.target)) return;
      if (event.detail >= 2 && name.contains(event.target)) { beginRename(row, id, label); return; }
      if (!selected) selectLayer(state, id, source);
    });
    row.addEventListener('dblclick', (event) => {
      if (swatch.contains(event.target) && source) { selectLayer(state, id, source); replaceImageInput.click(); }
      else if (name.contains(event.target)) beginRename(row, id, label);
    });
    row.addEventListener('contextmenu', (event) => showContextMenu(event, state, id, source));
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); selectLayer(state, id, source);
      }
      if (event.key === 'F2') { event.preventDefault(); beginRename(row, id, label); }
    });
    row.addEventListener('dragstart', (event) => {
      if (adjustingOpacity || event.target.closest('button, input, select')) { event.preventDefault(); return; }
      draggingId = id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
      root.classList.add('is-dragging-layer');
      row.classList.add('is-drag-source');
    });
    row.addEventListener('dragend', clearDragState);
    row.addEventListener('dragover', (event) => {
      if (!draggingId || draggingId === id ||
          layerAncestors(layers, { id, mix: node }).some((ancestor) => ancestor.id === draggingId)) return;
      event.preventDefault();
      const relativeY = (event.clientY - row.getBoundingClientRect().top) / row.offsetHeight;
      const placement = relativeY < .25 ? 'before' : relativeY > .75 ? 'after' : 'inside';
      row.dataset.dropPlacement = placement;
      row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
      row.classList.add(`is-drop-${placement}`);
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropLayer(id, row.dataset.dropPlacement || 'inside');
    });
    return row;
  }

  function renderOptions(selected) {
    maskToggle.disabled = invertToggle.disabled = !selected;
    maskToggle.setPressed(Boolean(selected?.mix.layerIsMask));
    invertToggle.setPressed(Boolean(selected?.mix.layerInvert));
  }

  function render(state) {
    closeContextMenu();
    const hasGraph = Boolean(state.graph);
    refreshMaterials(state);
    addButton.disabled = !hasGraph;
    openButton.disabled = !hasGraph;
    if (!hasGraph) {
      renderOptions(null);
      imageProperties.render(null);
      list.replaceChildren(element('p', { className: 'layers-panel__empty', text: 'Import a GLB or FBX model to start painting.' }));
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
    renderOptions(selected);
    imageProperties.render(selected, state.targetId);
    list.replaceChildren(...layers.map((layer) => createRow({ state, id: layer.id, node: layer.mix,
      source: layer.source, label: layer.label, selected: selected?.id === layer.id,
      depth: layerAncestors(layers, layer).length, layers })), rootDrop);
    refreshThumbnails();
    const siblings = layers.filter((layer) =>
      (layer.mix.layerParentId ?? null) === (selected?.mix.layerParentId ?? null));
    const siblingIndex = siblings.findIndex((layer) => layer.id === selected?.id);
    upButton.disabled = siblingIndex <= 0;
    downButton.disabled = siblingIndex < 0 || siblingIndex >= siblings.length - 1;
    const index = layers.findIndex((layer) => layer.id === selected?.id);
    const below = layers[index + 1];
    mergeButton.disabled = !selected || selected.mix.layerIsMask ||
      selected.mix.layerParentId || layers.some((layer) => layer.mix.layerParentId === selected.id) ||
      !below || below.mix.layerIsMask || below.mix.layerParentId ||
      layers.some((layer) => layer.mix.layerParentId === below.id);
    removeButton.disabled = !selected;
  }

  function editSpecificLayer(id, mutator) {
    const state = current();
    const graph = cloneTextureGraph(state.graph);
    const mix = graph.nodes.find((node) => node.id === id);
    if (!mix) return;
    mutator(mix);
    syncLayerMasks(graph);
    nodeEditor.replaceGraph(graph);
  }

  function refreshThumbnails() {
    for (const thumbnail of list.querySelectorAll('.layers-panel__thumbnail')) {
      const context = thumbnail.getContext('2d');
      context.clearRect(0, 0, thumbnail.width, thumbnail.height);
      const image = getImageCanvas?.(thumbnail.dataset.targetId, thumbnail.dataset.imageKey,
        thumbnail.dataset.vertexColor === 'true');
      if (image) {
        context.drawImage(image, 0, 0, thumbnail.width, thumbnail.height);
        if (thumbnail.dataset.inverted === 'true') {
          const pixels = context.getImageData(0, 0, thumbnail.width, thumbnail.height);
          for (let offset = 0; offset < pixels.data.length; offset += 4) {
            pixels.data[offset] = 255 - pixels.data[offset];
            pixels.data[offset + 1] = 255 - pixels.data[offset + 1];
            pixels.data[offset + 2] = 255 - pixels.data[offset + 2];
          }
          context.putImageData(pixels, 0, 0);
        }
      }
    }
  }

  function setState(state) { render(state); }
  setState(current());
  return { element: root, setState, refreshThumbnails };
}
