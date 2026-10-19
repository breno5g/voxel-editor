import type { Editor } from '../editor/editor.ts';
import { isCameraMode } from '../render/camera-rig.ts';
import type { CameraState } from '../render/camera-rig.ts';
import type { Viewport } from '../render/viewport.ts';
import { element } from './dom.ts';

const SLOT_COUNT = 10;

export type CameraPanel = ReturnType<typeof bindCameraPanel>;

/**
 * Camera mode switch and the ten camera slots (MagicaVoxel `cam_mode`, `cam save`, `cam load`, `cam_slot`).
 * ponytail: slots last for the session; writing them to rCAM waits on confirming the base matrix of `_angle`
 * (docs/magicavoxel-re.md), so files from MagicaVoxel keep their cameras untouched.
 */
export function bindCameraPanel(editor: Editor, viewport: Viewport) {
  const { camera } = viewport;
  const modeButtons = [...element('camera-options', HTMLDivElement).querySelectorAll<HTMLButtonElement>('[data-camera-mode]')];
  const slotSelect = element('camera-slot', HTMLSelectElement);
  const slots = new Map<number, CameraState>();
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
    slots.set(slot(), camera.state());
    editor.status(`Câmera salva no slot ${slot()}`);
  };
  const load = () => {
    const saved = slots.get(slot());
    if (!saved) return editor.status(`O slot de câmera ${slot()} está vazio`, 'error');
    camera.restore(saved);
    syncModes();
    editor.status(`Câmera do slot ${slot()} carregada`);
  };
  element('camera-save', HTMLButtonElement).addEventListener('click', save);
  element('camera-load', HTMLButtonElement).addEventListener('click', load);
  syncModes();

  return {
    save,
    load,
    selectSlot(index: number) {
      slotSelect.value = String(index);
      editor.status(`Slot de câmera ${index}`);
    },
  };
}
