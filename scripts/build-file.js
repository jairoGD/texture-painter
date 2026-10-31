import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workers = {};
for (const kind of ['ambient-occlusion', 'curvature']) {
  const result = await build({
    entryPoints: [`src/editor/${kind}-worker.js`],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    write: false
  });
  workers[kind] = result.outputFiles[0].text;
}

await mkdir('app', { recursive: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: 'app/editor.js',
  plugins: [{
    name: 'file-worker-factory',
    setup(bundler) {
      bundler.onResolve({ filter: /^\.\/worker-factory\.js$/ }, (args) => ({
        path: resolve(args.resolveDir, 'worker-factory-file.js')
      }));
    }
  }, {
    name: 'svg-data-urls',
    setup(bundler) {
      bundler.onLoad({ filter: /\.svg$/ }, async (args) => ({
        contents: `export default ${JSON.stringify(
          `data:image/svg+xml;base64,${(await readFile(args.path)).toString('base64')}`
        )};`,
        loader: 'js'
      }));
    }
  }],
  define: { __FILE_WORKER_SOURCES__: JSON.stringify(workers) }
});
