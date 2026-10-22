import brushIcon from '../ui/icons/brush.svg';
import eraserIcon from '../ui/icons/eraser.svg';
import bucketIcon from '../ui/icons/bucket.svg';
import lineIcon from '../ui/icons/line.svg';
import eyedropperIcon from '../ui/icons/eyedropper.svg';
import blurIcon from '../ui/icons/blur.svg';
import lassoIcon from '../ui/icons/lasso.svg';
import magicIcon from '../ui/icons/magic.svg';
import wireIcon from '../ui/icons/wire.svg';

const size = { type: 'slider', key: 'size', label: 'Size', min: 2, max: 128, step: 1, unit: ' px' };
const fineSize = { ...size, min: 1 };
const hardness = { type: 'slider', key: 'hardness', label: 'Hardness', min: 0, max: 100, step: 1, unit: '%' };
const opacity = { type: 'slider', key: 'opacity', label: 'Opacity', min: 1, max: 100, step: 1, unit: '%' };
const antialias = { type: 'checkbox', key: 'antialias', label: 'Antialiasing' };
export const TOOL_DEFINITIONS = [
  { id: 'brush', label: 'Brush', iconUrl: brushIcon,
    usesColor: true, defaults: { size: 10, hardness: 100, opacity: 100, antialias: true },
    controls: [fineSize, hardness, opacity, antialias] },
  { id: 'eraser', label: 'Eraser', iconUrl: eraserIcon,
    defaults: { size: 10, hardness: 100, opacity: 100, antialias: true },
    controls: [size, hardness, opacity, antialias] },
  { id: 'bucket', label: 'Bucket', iconUrl: bucketIcon,
    usesColor: true, defaults: { tolerance: 0, opacity: 100 },
    controls: [{ type: 'slider', key: 'tolerance', label: 'Tolerance', min: 0, max: 100, step: 1, unit: '%' }, opacity] },
  { id: 'line', label: 'Line', iconUrl: lineIcon,
    usesColor: true, defaults: { size: 2, hardness: 100, opacity: 100, antialias: true },
    controls: [fineSize, hardness, opacity, antialias] },
  { id: 'blur', label: 'Blur', iconUrl: blurIcon,
    defaults: { size: 72, hardness: 35, strength: 20, spread: 20 },
    controls: [size, hardness,
      { type: 'slider', key: 'strength', label: 'Strength', min: 1, max: 100, step: 1, unit: '%' },
      { type: 'slider', key: 'spread', label: 'Spread', min: 1, max: 32, step: 1, unit: ' px' }] },
  { id: 'lasso', label: 'Lasso', iconUrl: lassoIcon,
    defaults: { maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'wand', label: 'Wand', iconUrl: magicIcon,
    defaults: { threshold: 30, similar: false, allLayers: false,
      maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'slider', key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1 },
      { type: 'checkbox', key: 'similar', label: 'Select Similar' },
      { type: 'checkbox', key: 'allLayers', label: 'Sample All Layers' },
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'faces', label: 'Face Select', iconUrl: wireIcon,
    defaults: { maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'eyedropper', label: 'Eyedropper', iconUrl: eyedropperIcon,
    defaults: {}, controls: [] }
];
