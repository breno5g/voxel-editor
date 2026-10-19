import * as THREE from 'three';
import type { Editor } from '../editor/editor.ts';
import { isCameraMode, isWheelZoom } from '../render/camera-rig.ts';
import { cameraFromDict, cameraToDict } from '../render/camera-chunk.ts';
import type { Viewport } from '../render/viewport.ts';
import { t } from '../i18n/i18n.ts';
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

const round = (value: number, digits = 1) => String(Number(value.toFixed(digits)));

/**
 * MagicaVoxel's camera panel (`cam.ui`): centre, distance, pitch and yaw, field of view, free camera
 * speed and mouse sensitivity. Fields follow the camera unless they are being edited.
 */
function bindCameraDetails(camera: Viewport['camera']) {
  const panel = element('camera-settings', HTMLElement);
  const toggle = element('camera-more', HTMLButtonElement);
  const fields = new Map([...panel.querySelectorAll<HTMLInputElement>('[data-camera-field]')].map((input) => [input.dataset.cameraField ?? '', input]));
  const field = (name: string) => fields.get(name)?.valueAsNumber ?? Number.NaN;
  const finite = (...values: number[]) => values.every(Number.isFinite);

  const apply: Record<string, () => void> = {
    x: () => applyCenter(),
    y: () => applyCenter(),
    z: () => applyCenter(),
    distance: () => finite(field('distance')) && camera.setDistance(field('distance')),
    pitch: () => applyOrientation(),
    yaw: () => applyOrientation(),
    roll: () => finite(field('roll')) && camera.setRoll(field('roll')),
    fov: () => finite(field('fov')) && camera.setFov(field('fov')),
    move: () => applySpeeds(),
    mouse: () => applySpeeds(),
  };
  const applyCenter = () => {
    const [x, y, z] = [field('x'), field('y'), field('z')];
    if (finite(x, y, z)) camera.centerOn(new THREE.Vector3(x, y, z));
  };
  const applyOrientation = () => {
    const [pitch, yaw] = [field('pitch'), field('yaw')];
    if (finite(pitch, yaw)) camera.setOrientation(Math.max(-90, Math.min(90, pitch)), yaw);
  };
  const applySpeeds = () => {
    const [move, mouse] = [field('move'), field('mouse')];
    if (finite(move, mouse)) camera.setSpeeds({ move, mouse });
  };
  fields.forEach((input, name) => input.addEventListener('change', () => apply[name]?.()));

  const sync = () => {
    if (panel.hidden) return;
    const { target } = camera.state();
    const [pitch, yaw] = camera.orientation();
    const { move, mouse } = camera.speeds();
    const values: Record<string, string> = { x: round(target[0]), y: round(target[1]), z: round(target[2]), distance: round(camera.distance()), pitch: round(pitch), yaw: round(yaw), roll: round(camera.roll()), fov: round(camera.fov(), 0), move: round(move, 2), mouse: round(mouse, 2) };
    fields.forEach((input, name) => {
      if (input !== document.activeElement && values[name] !== undefined) input.value = values[name];
    });
  };
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    sync();
  });
  camera.onChange(sync);
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
    editor.status(t('Câmera salva no slot {slot}', { slot: slot() }));
  };
  const load = () => {
    const stored = editor.state.vox.cameras.get(slot());
    const saved = stored && cameraFromDict(stored);
    if (!saved) return editor.status(t('O slot de câmera {slot} está vazio', { slot: slot() }), 'error');
    camera.restore(saved);
    syncModes();
    editor.status(t('Câmera do slot {slot} carregada', { slot: slot() }));
  };
  bindCameraDetails(camera);
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
      editor.status(t('Slot de câmera {slot}', { slot: index }));
    },
  };
}
