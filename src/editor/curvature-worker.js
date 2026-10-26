import { createCurvatureBaker } from './curvature-bake.js';

self.onmessage = ({ data: { source, options } }) => {
  try {
    const baker = createCurvatureBaker(source, options);
    let index = 0;
    const advance = () => {
      const limit = Math.min(baker.triangleCount, index + 2);
      for (; index < limit; index++) baker.bakeTriangle(index);
      self.postMessage({ type: 'progress', value: index / baker.triangleCount });
      if (index < baker.triangleCount) { setTimeout(advance, 0); return; }
      const image = baker.finish();
      self.postMessage({ type: 'complete', image }, [image.data.buffer]);
    };
    advance();
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Curvature bake failed.' });
  }
};
