import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { createVoxelTools } from '../editor/voxel-tools.ts';
import { selectedVoxels } from '../editor/voxel-selection.ts';
import { createWorldTools } from '../editor/world-tools.ts';
import type { CameraDrag } from '../render/camera-rig.ts';
import type { Viewport } from '../render/viewport.ts';
import { isLooping, previousShapeModel } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';
import { isEditingText } from './dom.ts';

const MAIN_BUTTON = 0;
/** MagicaVoxel `camera-control`: hold the key and drag with the left button. */
const CAMERA_DRAG_KEYS: Record<string, CameraDrag> = { Space: 'pan', KeyZ: 'zoom', KeyK: 'rotate' };

/**
 * Keeps the viewport in step with editor events and routes left-button input by editor:
 * brush strokes in model mode, object selection in world mode (right/middle buttons
 * belong to the camera). Tab switches editors while the canvas has focus, so it still
 * moves focus everywhere else; Esc hands focus back to the page.
 */
export function bindViewportPanel(editor: Editor, viewport: Viewport, commands: ObjectCommands) {
  const { state } = editor;
  const voxelTools = createVoxelTools(editor, viewport, commands.resizeDrag);
  const worldTools = createWorldTools(editor, commands, viewport);
  const tools = () => (state.mode === 'model' ? voxelTools : worldTools);
  const { canvas } = viewport;

  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Viewport 3D. Tab alterna entre Modelo e Mundo, Esc sai do viewport');
  /** MagicaVoxel transform sessions: Enter keeps the result, Esc reverts it (captured before Esc blurs the canvas). */
  window.addEventListener('keydown', (event) => {
    if (isEditingText(event) || state.mode !== 'model') return;
    const handled = event.key === 'Enter' ? voxelTools.finishTransform() : event.key === 'Escape' && voxelTools.cancelTransform();
    if (handled) event.preventDefault();
  }, { capture: true });
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) return canvas.blur();
    if (event.key !== 'Tab') return;
    event.preventDefault();
    editor.setMode(event.shiftKey || state.mode === 'model' ? 'world' : 'model');
  });

  window.addEventListener('keydown', (event) => {
    const drag = CAMERA_DRAG_KEYS[event.code];
    if (!drag || event.ctrlKey || event.metaKey || isEditingText(event) || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    viewport.camera.setLeftDrag(drag);
  });
  window.addEventListener('keyup', (event) => {
    if (CAMERA_DRAG_KEYS[event.code]) viewport.camera.setLeftDrag(null);
  });
  window.addEventListener('blur', () => viewport.camera.setLeftDrag(null));

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== MAIN_BUTTON || viewport.camera.leftDrag()) return;
    canvas.setPointerCapture(event.pointerId);
    tools().begin(event.clientX, event.clientY, event);
  });
  canvas.addEventListener('pointermove', (event) => tools().move(event.clientX, event.clientY));
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === MAIN_BUTTON) tools().end();
  });

  const isOnEditedModel = (clientX: number, clientY: number) =>
    state.selected !== null && (viewport.pick(clientX, clientY, state.selected) !== null || viewport.floorCell(clientX, clientY, state.selected) !== null);

  /**
   * MagicaVoxel: double click enters the clicked object's model, switches to another
   * object from model mode, or leaves to the world from empty space. On the edited
   * model itself the clicks are just brush strokes.
   */
  canvas.addEventListener('dblclick', ({ clientX, clientY }) => {
    if (state.mode === 'world') {
      if (viewport.pick(clientX, clientY)) editor.setMode('model');
      return;
    }
    if (isOnEditedModel(clientX, clientY)) return;
    const other = viewport.pick(clientX, clientY);
    if (other) editor.select(other.transformId);
    else editor.setMode('world');
  });
  canvas.addEventListener('pointerleave', () => viewport.showHover(null));

  /** Frames every pose in the range, so animated objects stay in view while playing. */
  const frameScene = () => {
    const [start, end] = state.range;
    const poses = Array.from({ length: end - start + 1 }, (_unused, offset) => evaluateScene(state.vox, start + offset)).flat();
    viewport.frameAll(poses, state.vox.models);
  };
  /** MagicaVoxel `cam focus` (5): the edited or selected object, else everything on screen. */
  const focusCamera = () => {
    const selected = editor.selectedInstance();
    viewport.frameAll(selected ? [selected] : state.instances, state.vox.models);
  };

  const syncGhost = () => {
    const instance = state.onionSkin ? editor.selectedInstance() : undefined;
    const shape = instance && state.vox.nodes[instance.shapeId];
    const previous = shape?.kind === 'shape' ? previousShapeModel(shape.keys, state.frame, isLooping(shape.attrs)) : null;
    viewport.setGhost(instance && previous !== null ? instance.transformId : null, previous === null ? null : state.vox.models[previous]);
  };

  const syncInstances = () => {
    viewport.syncInstances(state.instances, state.vox.models);
    syncGhost();
  };

  const syncFocus = () => viewport.setFocus(state.mode === 'model' ? state.selected : null);

  /** Highlights the voxel selection while its model is the one being edited. */
  const syncVoxelSelection = () => {
    const instance = state.mode === 'model' ? editor.selectedInstance() : undefined;
    const model = instance && state.vox.models[instance.model];
    const mask = model && editor.selectionOf(model);
    viewport.setVoxelSelection(instance && mask ? instance.transformId : null, model && mask ? selectedVoxels(model, mask) : null);
  };

  viewport.setDisplay(state.display);
  editor.subscribe((event) => {
    if (event.type === 'document') {
      viewport.reset();
      viewport.setPalette(state.vox.palette);
      syncInstances();
      viewport.setSelection(state.selected);
      syncFocus();
      syncVoxelSelection();
      frameScene();
      return;
    }
    if (event.type === 'display') return viewport.setDisplay(state.display);
    if (event.type === 'scene' || event.type === 'frame') {
      syncInstances();
      return syncVoxelSelection();
    }
    if (event.type === 'voxelSelection') return syncVoxelSelection();
    if (event.type === 'voxels') {
      viewport.refreshModel(event.model, event.chunks);
      if (state.voxelSelection?.model === event.model) syncVoxelSelection();
      return;
    }
    if (event.type === 'palette') return viewport.setPalette(state.vox.palette);
    if (event.type === 'tool') return syncGhost();
    if (event.type === 'mode') {
      viewport.showHover(null);
      syncVoxelSelection();
      return syncFocus();
    }
    if (event.type === 'selection') {
      viewport.setSelection(state.selected);
      syncFocus();
      syncGhost();
      syncVoxelSelection();
    }
  });

  return { focusCamera };
}
