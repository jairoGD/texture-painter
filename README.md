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

- 3D viewport with immediate orbit motion: Alt + left drag or middle-button drag to orbit, Space + left drag to pan, mouse wheel to zoom.
- File → Import Model opens a local `.glb` file. Each imported mesh with UV coordinates receives a new white 1024×1024 canvas texture.
- Display → Shaded / Unlit changes the model's lighting mode; Display → Show grid toggles the grid.
- Brush and Eraser paint directly on the model; Bucket fills a connected color region in the UV texture; Line draws a straight stroke with a live preview; Eyedropper samples a painted color. Choose a tool from the icon grid on the left; hovering for half a second shows its name. Adjust size, hardness, opacity, or bucket tolerance in Properties. The eraser paints white.
- The Color panel above Tools holds the shared paint color for Brush, Bucket, and Line. Click the front swatch on the right to pick a color, click the back swatch to change the secondary color, or swap them with the arrow. It includes 20 basic colors and 12 temporary color slots: click an empty slot to save the current color, click a filled slot to use it, Shift-click to replace it, and right-click to clear it. Brush and Eraser start at 10 px; Line starts at 2 px; Blur starts at 20% Strength.
- Blur mixes neighboring texture pixels with a local Gaussian brush. Size and Hardness shape its footprint, Strength controls how much the blurred result replaces the current color, and Spread controls how far nearby color travels. Drag over a painted edge to soften and extend it; each drag is one undoable stroke.
- Lasso selects the visible part of a model's UV texture: hold the mouse button and draw a freehand contour on the model; releasing closes it. A single click outside the selection, including the scene background, clears it. Drag inside the highlighted area to cut and move its pixels on the same material. The selection stays active as a paint mask for Brush, Eraser, Bucket, Line, and Blur; turn off **Mask painting to selection** or use **Clear Selection** in Lasso Properties. Escape cancels a selection in progress. Selection creation, movement, and clearing participate in Undo/Redo.
- Edit → Undo / Redo works per paint stroke. The shortcuts are Ctrl+Z and Ctrl+Shift+Z (Command equivalents on macOS). Importing another model starts a fresh paint history.
- Texture Nodes opens from the collapsed bar below the 3D view. Each material starts with Paint Texture connected to Texture Output. Add Solid Color and Mix nodes, drag from an output socket to an input socket, and adjust node controls to change the texture shown on the model. Drag node titles to arrange them, middle-drag or Alt + left drag to pan, scroll to zoom, and use Frame to fit the graph. Select a node or wire and press Delete to remove it; the node toolbar has its own Undo/Redo history. The material selector switches between graphs for imported material slots.
- Reusable interface module in `src/ui/` with buttons, dropdowns, tool groups, panels and other controls. Panels are rendered from control definitions. New control types can be added with `registerControl()`; updating a shared component updates every use in the editor.

Textures currently stay in memory during the session; saving and exporting painted textures are future work. Models need UV coordinates for painting. Each material slot has its own texture, so a Line stroke and Lasso selection remain on their starting slot. Bucket operates on connected pixels of that UV texture. Overlapping UVs share texture pixels and therefore cannot be selected independently.
