# Texture Painter

Early foundation for a browser-based 3D texture painting editor built with three.js.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates a self-contained static build in `dist/`. The three.js package is installed in `node_modules` and bundled into the build; the editor does not load it from a CDN.

On Windows, after `npm install` has been run once, double-click `start-editor.bat` to start the local server and open the editor automatically. Keep the command window open while using the editor; press Ctrl+C there to stop it.

## Current features

- 3D viewport with orbit, pan and zoom controls, lighting and grid.
- File → Import Model opens a local `.glb` file. The Scene panel has the same action.
- Reusable interface module in `src/ui/` with button, dropdown, toolbar, panel, slider, checkbox and notice components. Panels are rendered from control definitions. New control types can be added with `registerControl()`; updating a shared component updates every use in the editor.
- Viewport exposure, grid visibility and model framing controls.

Texture painting itself has not been implemented yet.
