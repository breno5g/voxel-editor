import * as THREE from 'three';

export type SpriteTarget = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setOverlaysVisible: (visible: boolean) => void;
};

/**
 * Renders `frameCount` square frames from the current camera into one PNG grid
 * with a transparent background. `showFrame(i)` must put frame i on screen.
 */
export async function renderSpriteSheet(target: SpriteTarget, frameCount: number, frameSize: number, showFrame: (index: number) => void): Promise<Blob> {
  const { renderer, scene, camera } = target;
  const columns = Math.ceil(Math.sqrt(frameCount));
  const sheet = document.createElement('canvas');
  sheet.width = columns * frameSize;
  sheet.height = Math.ceil(frameCount / columns) * frameSize;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');

  const previous = {
    size: renderer.getSize(new THREE.Vector2()),
    pixelRatio: renderer.getPixelRatio(),
    aspect: camera.aspect,
    background: scene.background,
  };
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(frameSize, frameSize, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    scene.background = null;
    target.setOverlaysVisible(false);
    for (let index = 0; index < frameCount; index++) {
      showFrame(index);
      renderer.render(scene, camera);
      context.drawImage(renderer.domElement, (index % columns) * frameSize, Math.floor(index / columns) * frameSize);
    }
  } finally {
    renderer.setPixelRatio(previous.pixelRatio);
    renderer.setSize(previous.size.x, previous.size.y, false);
    camera.aspect = previous.aspect;
    camera.updateProjectionMatrix();
    scene.background = previous.background;
    target.setOverlaysVisible(true);
  }

  return new Promise((resolve, reject) => {
    sheet.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}
