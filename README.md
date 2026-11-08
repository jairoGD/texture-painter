# Texture Painter

Texture painting editor directly on the 3D model, with various image editing features. Built with [three.js](https://threejs.org/).
Doesn't generate PBR maps; it's geared more toward hand-painting.

**[Open Texture Painter](https://jairogd.github.io/texture-painter/)**

<img width="1912" height="905" alt="image" src="https://github.com/user-attachments/assets/29d92dd0-5ad8-45a8-ab2d-0a7c8fdd21d9" />

Import a `.glb` or `.fbx` model, paint on its surface, organize layers and texture nodes, then export PNG textures. Save your work as a `.tp3d` project to continue later. Models need UV coordinates for texture painting.

Your files stay on your device. New projects are saved locally in the browser and appear under Recent Projects. You can save a `.tp3d` file later. Browsers with the File System Access API can save directly to a chosen file or folder; other browsers download the project file and export textures as a ZIP.
