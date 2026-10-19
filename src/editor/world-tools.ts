import type { Vec3 } from '../format/vox.ts';
import type { Viewport } from '../render/viewport.ts';
import type { Editor } from './editor.ts';
import type { ObjectCommands } from './object-commands.ts';

type DragHandle = NonNullable<ReturnType<ObjectCommands['dragSelected']>>;
type Drag = { handle: DragHandle; origin: Vec3; height: number; last: string };

/**
 * World editor pointer input (MagicaVoxel `b_obj move`): a click selects the object under
 * the pointer and dragging slides it over the horizontal plane in whole voxels.
 */
export function createWorldTools(editor: Editor, commands: ObjectCommands, viewport: Viewport) {
  let drag: Drag | null = null;

  return {
    begin(clientX: number, clientY: number) {
      editor.select(viewport.pick(clientX, clientY)?.transformId ?? null);
      const height = editor.selectedInstance()?.pose.translation[2];
      const origin = height === undefined ? null : viewport.planePoint(clientX, clientY, height);
      const handle = origin && commands.dragSelected();
      drag = origin && handle && height !== undefined ? { handle, origin, height, last: '0,0' } : null;
    },

    move(clientX: number, clientY: number) {
      const point = drag && viewport.planePoint(clientX, clientY, drag.height);
      if (!drag || !point) return;
      const delta: Vec3 = [Math.round(point[0] - drag.origin[0]), Math.round(point[1] - drag.origin[1]), 0];
      const key = `${delta[0]},${delta[1]}`;
      if (key === drag.last) return;
      drag.last = key;
      drag.handle.preview(delta);
    },

    end() {
      drag?.handle.commit();
      drag = null;
    },
  };
}
