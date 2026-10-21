import brushIcon from '../ui/icons/brush.svg';
import eraserIcon from '../ui/icons/eraser.svg';
import bucketIcon from '../ui/icons/bucket.svg';
import lineIcon from '../ui/icons/line.svg';
import eyedropperIcon from '../ui/icons/eyedropper.svg';

const size = { type: 'slider', key: 'size', label: 'Size', min: 2, max: 128, step: 1, unit: ' px' };
const hardness = { type: 'slider', key: 'hardness', label: 'Hardness', min: 0, max: 100, step: 1, unit: '%' };
const opacity = { type: 'slider', key: 'opacity', label: 'Opacity', min: 1, max: 100, step: 1, unit: '%' };
const color = { type: 'colorPicker', key: 'color', label: 'Color' };

export const TOOL_DEFINITIONS = [
  { id: 'brush', label: 'Brush', iconUrl: brushIcon,
    defaults: { color: '#28343f', size: 36, hardness: 100, opacity: 100 },
    controls: [color, size, hardness, opacity] },
  { id: 'eraser', label: 'Eraser', iconUrl: eraserIcon,
    defaults: { size: 36, hardness: 100, opacity: 100 },
    controls: [size, hardness, opacity] },
  { id: 'bucket', label: 'Bucket', iconUrl: bucketIcon,
    defaults: { color: '#28343f', tolerance: 0, opacity: 100 },
    controls: [color, { type: 'slider', key: 'tolerance', label: 'Tolerance', min: 0, max: 100, step: 1, unit: '%' }, opacity] },
  { id: 'line', label: 'Line', iconUrl: lineIcon,
    defaults: { color: '#28343f', size: 36, hardness: 100, opacity: 100 },
    controls: [color, size, hardness, opacity] },
  { id: 'eyedropper', label: 'Eyedropper', iconUrl: eyedropperIcon,
    defaults: { color: '#28343f' },
    controls: [color] }
];
