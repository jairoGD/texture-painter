import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createScene(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#252b34');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.set(3.4, 2.4, 4.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.65, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight('#dbe9ff', '#525667', 2.1));
  const keyLight = new THREE.DirectionalLight('#ffffff', 3.2);
  keyLight.position.set(3, 6, 4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#9bbcff', 1.5);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(20, 20, '#66717d', '#3a434e');
  grid.position.y = -0.005;
  scene.add(grid);

  const defaultModel = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#aabed2', metalness: 0.18, roughness: 0.48 });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.27, 180, 24), material);
  knot.position.y = 1.05;
  defaultModel.add(knot);
  scene.add(defaultModel);

  let model = defaultModel;
  const loader = new GLTFLoader();

  function frame(object) {
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.5);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius * 1.65, radius * 1.15, radius * 1.9));
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = Math.max(radius * 100, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function importGlb(file) {
    if (!file || !/\.glb$/i.test(file.name)) return Promise.reject(new Error('Select a .glb file.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        loader.parse(reader.result, '', (gltf) => {
          const next = gltf.scene;
          if (!next.children.length) return reject(new Error('The GLB contains no visible scene.'));
          scene.remove(model);
          model = next;
          scene.add(model);
          frame(model);
          resolve(next);
        }, reject);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  new ResizeObserver(resize).observe(host);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  return {
    importGlb,
    frame: () => frame(model),
    setGridVisible: (visible) => { grid.visible = visible; },
    setExposure: (value) => { renderer.toneMappingExposure = value; }
  };
}
