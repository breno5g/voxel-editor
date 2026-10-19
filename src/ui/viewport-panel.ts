import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { createVoxelTools } from '../editor/voxel-tools.ts';
import { createWorldTools } from '../editor/world-tools.ts';
import type { Viewport } from '../render/viewport.ts';
import { isLooping, previousShapeModel } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';

const MAIN_BUTTON = 0;

/**
 * Keeps the viewport in step with editor events and routes left-button input by editor:
 * brush strokes in model mode, object selection in world mode (right/middle buttons
 * belong to the camera). Tab switches editors while the canvas has focus, so it still
 * moves focus everywhere else; Esc hands focus back to the page.
 */
export function bindViewportPanel(editor: Editor, viewport: Viewport, commands: ObjectCommands) {
  const { state } = editor;
  const voxelTools = createVoxelTools(editor, viewport);
  const worldTools = createWorldTools(editor, commands, viewport);
  const tools = () => (state.mode === 'model' ? voxelTools : worldTools);
  const { canvas } = viewport;

  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Viewport 3D. Tab alterna entre Modelo e Mundo, Esc sai do viewport');
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return canvas.blur();
    if (event.key !== 'Tab') return;
    event.preventDefault();
    editor.setMode(event.shiftKey || state.mode === 'model' ? 'world' : 'model');
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== MAIN_BUTTON) return;
    canvas.setPointerCapture(event.pointerId);
    tools().begin(event.clientX, event.clientY, event.altKey);
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

  editor.subscribe((event) => {
    if (event.type === 'document') {
      viewport.reset();
      viewport.setPalette(state.vox.palette);
      syncInstances();
      viewport.setSelection(state.selected);
      frameScene();
      return;
    }
    if (event.type === 'scene' || event.type === 'frame') return syncInstances();
    if (event.type === 'voxels') return viewport.refreshModel(event.model, event.chunks);
    if (event.type === 'palette') return viewport.setPalette(state.vox.palette);
    if (event.type === 'tool') return syncGhost();
    if (event.type === 'mode') return viewport.showHover(null);
    if (event.type === 'selection') {
      viewport.setSelection(state.selected);
      syncGhost();
    }
  });

  return { frameScene };
}
