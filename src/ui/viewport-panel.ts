import type { Editor } from '../editor/editor.ts';
import { createVoxelTools } from '../editor/voxel-tools.ts';
import type { Viewport } from '../render/viewport.ts';
import { isLooping, previousShapeModel } from '../scene/keyframes.ts';
import { evaluateScene } from '../scene/scene-graph.ts';

const MAIN_BUTTON = 0;

/**
 * Keeps the viewport in step with editor events and turns left-button input
 * into voxel tool strokes (right/middle buttons belong to the camera).
 */
export function bindViewportPanel(editor: Editor, viewport: Viewport) {
  const { state } = editor;
  const tools = createVoxelTools(editor, viewport);
  const { canvas } = viewport;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== MAIN_BUTTON) return;
    canvas.setPointerCapture(event.pointerId);
    tools.begin(event.clientX, event.clientY, event.altKey);
  });
  canvas.addEventListener('pointermove', (event) => tools.move(event.clientX, event.clientY));
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === MAIN_BUTTON) tools.end();
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
    if (event.type === 'selection') {
      viewport.setSelection(state.selected);
      syncGhost();
    }
  });

  return { frameScene };
}
