import type { Editor } from '../editor/editor.ts';
import { isCameraMode, isWheelZoom } from '../render/camera-rig.ts';
import { cameraFromDict, cameraToDict } from '../render/camera-chunk.ts';
import type { Viewport } from '../render/viewport.ts';
import { bindButtonGroup, element } from './dom.ts';

const SLOT_COUNT = 10;
const WHEEL_ZOOM_KEY = 'voxel-editor:wheel-zoom';

/** The wheel zoom choice is a per-browser preference; storage may be unavailable (private windows). */
function storedWheelZoom() {
  try {
    const stored = localStorage.getItem(WHEEL_ZOOM_KEY);
    return isWheelZoom(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeWheelZoom(value: string) {
  try {
    localStorage.setItem(WHEEL_ZOOM_KEY, value);
  } catch {
    // Not persisted; the choice still holds for this session.
  }
}

export type CameraPanel = ReturnType<typeof bindCameraPanel>;

/**
 * Camera mode switch and the ten camera slots (MagicaVoxel `cam_mode`, `cam save`, `cam load`, `cam_slot`),
 * kept in the document's rCAM chunks like MagicaVoxel, so they travel with the file.
 */
export function bindCameraPanel(editor: Editor, viewport: Viewport) {
  const { camera } = viewport;
  const modeButtons = [...element('camera-options', HTMLDivElement).querySelectorAll<HTMLButtonElement>('[data-camera-mode]')];
  const slotSelect = element('camera-slot', HTMLSelectElement);
  const slot = () => Number(slotSelect.value);

  const syncModes = () => modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cameraMode === camera.mode())));
  modeButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const { cameraMode } = button.dataset;
      if (!isCameraMode(cameraMode)) return;
      camera.setMode(cameraMode);
      syncModes();
    }),
  );
  slotSelect.append(...Array.from({ length: SLOT_COUNT }, (_unused, index) => new Option(String(index), String(index))));

  const save = () => {
    editor.state.vox.cameras.set(slot(), cameraToDict(camera.state()));
    editor.state.dirty = true;
    editor.status(`Câmera salva no slot ${slot()}`);
  };
  const load = () => {
    const stored = editor.state.vox.cameras.get(slot());
    const saved = stored && cameraFromDict(stored);
    if (!saved) return editor.status(`O slot de câmera ${slot()} está vazio`, 'error');
    camera.restore(saved);
    syncModes();
    editor.status(`Câmera do slot ${slot()} carregada`);
  };
  element('camera-save', HTMLButtonElement).addEventListener('click', save);
  element('camera-load', HTMLButtonElement).addEventListener('click', load);
  syncModes();

  const showWheelZoom = bindButtonGroup('wheel-zoom', (raw) => (isWheelZoom(raw) ? raw : undefined), (zoom) => {
    camera.setWheelZoom(zoom);
    storeWheelZoom(zoom);
    showWheelZoom(zoom);
  });
  camera.setWheelZoom(storedWheelZoom() ?? camera.wheelZoom());
  showWheelZoom(camera.wheelZoom());

  return {
    save,
    load,
    selectSlot(index: number) {
      slotSelect.value = String(index);
      editor.status(`Slot de câmera ${index}`);
    },
  };
}
