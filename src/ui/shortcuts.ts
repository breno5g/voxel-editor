import type { BrushMode, BrushType, Editor, Mode } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import type { Axis } from '../format/rotation.ts';
import type { Vec3 } from '../format/vox.ts';
import { isEditingText } from './dom.ts';
import type { FileActions } from './file-actions.ts';

type Keymap = Map<string, () => void>;

/** Matched by physical key: Shift turns ',' into '<' and '=' into '+', and digits into symbols. */
const CODE_KEYS = /^(Comma|Period|Equal|Minus|Digit\d|Numpad\d)$/;

function comboOf(event: KeyboardEvent): string {
  const key = CODE_KEYS.test(event.code) ? event.code : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [event.ctrlKey || event.metaKey ? 'ctrl' : '', event.shiftKey ? 'shift' : '', key].filter(Boolean).join('+');
}

/** Lets a focused button keep its own Space/Enter activation. */
const isActivatingButton = (event: KeyboardEvent) => event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter');

export type ShortcutActions = { focusCamera: () => void; openHelp: () => void };

/**
 * MagicaVoxel's `config/hotkey.txt`: a global map plus one per editor (`model-editor`, `world-editor`);
 * the editor's map wins. Tab (switch editor) is handled by the viewport, which owns its focus.
 * Browsers reserve Ctrl+N/T/W, so those MagicaVoxel keys only reach the page in a standalone window.
 */
export function bindShortcuts(editor: Editor, commands: ObjectCommands, files: FileActions, actions: ShortcutActions): void {
  const { state } = editor;
  const undo = () => {
    if (!editor.history.undo()) editor.status('Nada para desfazer');
  };
  const redo = () => {
    if (!editor.history.redo()) editor.status('Nada para refazer');
  };
  const brushMode = (mode: BrushMode) => () => editor.setBrushMode(mode);
  const brushType = (type: BrushType) => () => editor.setBrushType(type);
  const move = (delta: Vec3) => () => commands.moveSelected(delta);
  const rotate = (axis: Axis, direction: 1 | -1) => () => commands.rotateSelected(axis, direction);

  const global: Keymap = new Map([
    ['ctrl+z', undo],
    ['ctrl+y', redo],
    ['ctrl+shift+z', redo],
    ['ctrl+p', files.newDocument],
    ['ctrl+o', files.open],
    ['ctrl+s', files.save],
    ['ctrl+shift+s', files.saveAs],
    ['F5', commands.addKey],
    ['F6', commands.removeKey],
    ['Comma', () => editor.stepFrame(-1)],
    ['Period', () => editor.stepFrame(1)],
    ['ctrl+Comma', () => commands.stepKey(-1)],
    ['ctrl+Period', () => commands.stepKey(1)],
    ['ctrl+shift+Comma', () => commands.stepKey(-1, true)],
    ['ctrl+shift+Period', () => commands.stepKey(1, true)],
    ['Digit5', actions.focusCamera],
    ['o', () => editor.setOnionSkin(!state.onionSkin)],
    ['?', actions.openHelp],
    ['shift+?', actions.openHelp],
    ['F1', actions.openHelp],
  ]);

  const byMode: Record<Mode, Keymap> = {
    model: new Map([
      ['v', brushMode('vox')],
      ['b', brushMode('box')],
      ['t', brushType('attach')],
      ['r', brushType('erase')],
      ['g', brushType('paint')],
    ]),
    world: new Map([
      ['ctrl+n', commands.addObject],
      ['Delete', commands.deleteSelected],
      ['Backspace', commands.deleteSelected],
      ['ctrl+d', () => editor.select(null)],
      ['ctrl+h', () => state.selected !== null && commands.toggleHidden(state.selected)],
      ['g', commands.groundSelected],
      ['ArrowLeft', move([-1, 0, 0])],
      ['ArrowRight', move([1, 0, 0])],
      ['ArrowUp', move([0, 1, 0])],
      ['ArrowDown', move([0, -1, 0])],
      ['PageUp', move([0, 0, 1])],
      ['PageDown', move([0, 0, -1])],
      ['Equal', rotate(2, -1)],
      ['Minus', rotate(2, 1)],
      ['Digit9', rotate(0, -1)],
      ['Digit0', rotate(0, 1)],
    ]),
  };

  window.addEventListener('keydown', (event) => {
    if (isEditingText(event) || isActivatingButton(event)) return;
    const combo = comboOf(event);
    const action = byMode[state.mode].get(combo) ?? global.get(combo);
    if (!action) return;
    event.preventDefault();
    action();
  });
}
