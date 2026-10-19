import { OBJECT_TOOLS } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isAxis } from '../format/rotation.ts';
import { bindButtonGroup } from './dom.ts';

const SIDES = { '-1': -1, '0': 0, '1': 1 } as const;
const isSide = (raw: string): raw is keyof typeof SIDES => raw in SIDES;

/** The world editor's left panel: pointer tool, object selection, alignment and visibility. */
export function bindWorldPanel(editor: Editor, commands: ObjectCommands): void {
  const showTool = bindButtonGroup('object-tool', (raw) => OBJECT_TOOLS.find((tool) => tool === raw), editor.setObjectTool);

  const actions: Record<string, () => void> = {
    selectAll: commands.selectAll,
    invertSelection: commands.invertSelection,
    selectNone: commands.selectNone,
    hide: () => commands.hideSelected(true),
    show: () => commands.hideSelected(false),
    ground: commands.groundSelected,
  };
  document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach((button) =>
    button.addEventListener('click', () => actions[button.dataset.world ?? '']?.()),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((button) =>
    button.addEventListener('click', () => {
      const [axisText, side] = (button.dataset.align ?? '').split(' ');
      const axis = Number(axisText);
      if (isAxis(axis) && isSide(side)) commands.alignSelected(axis, SIDES[side]);
    }),
  );

  showTool(editor.state.objectTool);
  editor.subscribe((event) => {
    if (event.type === 'tool') showTool(editor.state.objectTool);
  });
}
