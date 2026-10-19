import { OBJECT_TOOLS } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isAxis } from '../format/rotation.ts';
import type { Axis } from '../format/rotation.ts';
import type { Vec3 } from '../format/vox.ts';
import { bindButtonGroup, element } from './dom.ts';

const SIDES = { '-1': -1, '0': 0, '1': 1 } as const;
const AXES: Record<string, Axis> = { x: 0, y: 1, z: 2 };

/** MagicaVoxel `omove`: `g` grounds the selection, otherwise axis/step pairs such as `x 4 z -2`. */
export function parseMove(text: string): Vec3 | 'ground' | null {
  const words = text.trim().toLowerCase().split(/\s+/);
  if (words.length === 1 && words[0] === 'g') return 'ground';
  if (words.length < 2 || words.length % 2 !== 0) return null;
  const delta: Vec3 = [0, 0, 0];
  for (let index = 0; index < words.length; index += 2) {
    const axis = AXES[words[index]];
    const steps = Number(words[index + 1]);
    if (axis === undefined || !Number.isInteger(steps)) return null;
    delta[axis] += steps;
  }
  return delta;
}
const isSide = (raw: string): raw is keyof typeof SIDES => raw in SIDES;

/** The world editor's left panel: pointer tool, selection and clipboard, transform, alignment, groups and visibility. */
export function bindWorldPanel(editor: Editor, commands: ObjectCommands): void {
  const showTool = bindButtonGroup('object-tool', (raw) => OBJECT_TOOLS.find((tool) => tool === raw), editor.setObjectTool);

  const actions: Record<string, () => void> = {
    selectAll: commands.selectAll,
    invertSelection: commands.invertSelection,
    selectNone: commands.selectNone,
    hide: () => commands.hideSelected(true),
    show: () => commands.hideSelected(false),
    ground: commands.groundSelected,
    group: commands.groupSelected,
    ungroup: commands.ungroupSelected,
    enter: commands.enterLevel,
    exit: commands.exitLevel,
    first: () => commands.orderSelected(2),
    last: () => commands.orderSelected(-2),
    union: commands.unionSelected,
    intersect: commands.intersectSelected,
    operands: commands.pickOperands,
    subtract: commands.subtractSelected,
    replace: commands.replaceSelected,
    copy: () => commands.copy('copy'),
    copyRef: () => commands.copy('ref'),
    copyFrame: () => commands.copy('frame'),
    cut: commands.cut,
    paste: commands.paste,
    refToObject: () => commands.referencesToObjects(false),
    copyTransform: commands.copyTransform,
    pasteTransform: () => commands.pasteTransform('all'),
    pasteRotation: () => commands.pasteTransform('r'),
    pasteTranslation: () => commands.pasteTransform('t'),
    resetRotation: () => commands.pasteTransform('i'),
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

  const positions = (['position-x', 'position-y', 'position-z'] as const).map((id) => element(id, HTMLInputElement));
  positions.forEach((input, axis) =>
    input.addEventListener('change', () => {
      const current = commands.primaryPosition();
      if (!current || !Number.isFinite(input.valueAsNumber)) return;
      const delta: Vec3 = [0, 0, 0];
      delta[axis] = Math.round(input.valueAsNumber) - current[axis];
      commands.moveSelected(delta);
    }),
  );
  const moveField = element('move-objects', HTMLInputElement);
  moveField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const move = parseMove(moveField.value);
    if (move === 'ground') return commands.groundSelected();
    if (!move) return editor.status('Mover: use eixo e passos, ex.: x 4 z -2, ou g', 'error');
    commands.moveSelected(move);
  });

  const syncPosition = () => {
    const position = commands.primaryPosition();
    positions.forEach((input, axis) => {
      input.disabled = !position;
      if (document.activeElement !== input) input.value = position ? String(position[axis]) : '';
    });
  };

  const wrapOptions = element('object-wrap-options', HTMLElement);
  const wrapInputs = (['object-wrap-x', 'object-wrap-y', 'object-wrap-z'] as const).map((id) => element(id, HTMLInputElement));
  wrapInputs.forEach((input, axis) => input.addEventListener('change', () => isAxis(axis) && editor.setWrapSpacing(axis, input.valueAsNumber, 'world')));
  const syncTool = () => {
    showTool(editor.state.objectTool);
    wrapOptions.hidden = editor.state.objectTool !== 'wrap';
    wrapInputs.forEach((input, axis) => (input.value = String(editor.state.objectWrapSpacing[axis])));
  };

  syncTool();
  editor.subscribe((event) => {
    if (event.type === 'tool') syncTool();
    if (event.type === 'selection' || event.type === 'scene' || event.type === 'frame' || event.type === 'document') syncPosition();
  });
}
