import * as THREE from 'three';

/** What image exports need from the viewport, whichever projection is active. */
export type ImageTarget = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: () => THREE.Camera;
  aspect: () => number;
  setAspect: (aspect: number) => void;
  setOverlaysVisible: (visible: boolean) => void;
};

/** Must run in the same task as the render: the WebGL drawing buffer is not preserved after that. */
const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'));

/**
 * Renders `frameCount` square frames from the current camera into one PNG grid
 * with a transparent background. `showFrame(i)` must put frame i on screen.
 */
export async function renderSpriteSheet(target: ImageTarget, frameCount: number, frameSize: number, showFrame: (index: number) => void): Promise<Blob> {
  const { renderer, scene } = target;
  const columns = Math.ceil(Math.sqrt(frameCount));
  const sheet = document.createElement('canvas');
  sheet.width = columns * frameSize;
  sheet.height = Math.ceil(frameCount / columns) * frameSize;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');

  const previous = {
    size: renderer.getSize(new THREE.Vector2()),
    pixelRatio: renderer.getPixelRatio(),
    aspect: target.aspect(),
    background: scene.background,
  };
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(frameSize, frameSize, false);
    target.setAspect(1);
    scene.background = null;
    target.setOverlaysVisible(false);
    for (let index = 0; index < frameCount; index++) {
      showFrame(index);
      renderer.render(scene, target.camera());
      context.drawImage(renderer.domElement, (index % columns) * frameSize, Math.floor(index / columns) * frameSize);
    }
  } finally {
    renderer.setPixelRatio(previous.pixelRatio);
    renderer.setSize(previous.size.x, previous.size.y, false);
    target.setAspect(previous.aspect);
    scene.background = previous.background;
    target.setOverlaysVisible(true);
  }
  return toPng(sheet);
}

/** MagicaVoxel `snap scene` (6): the current view as PNG, without editor overlays. */
export async function renderSnapshot(target: ImageTarget): Promise<Blob> {
  target.setOverlaysVisible(false);
  try {
    target.renderer.render(target.scene, target.camera());
    return await toPng(target.renderer.domElement);
  } finally {
    target.setOverlaysVisible(true);
  }
}
