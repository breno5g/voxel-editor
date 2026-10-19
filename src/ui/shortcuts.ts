import type { BrushMode, BrushType, DisplayOption, Editor, Mode } from '../editor/editor.ts';
import type { ModelCommands } from '../editor/model-commands.ts';
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

export type ShortcutActions = {
  focusCamera: () => void;
  faceView: () => void;
  snapshot: () => void;
  saveCamera: () => void;
  loadCamera: () => void;
  selectCameraSlot: (slot: number) => void;
  /** Free camera movement: forward, right and up steps. */
  fly: (forward: number, right: number, up: number) => void;
  openHelp: () => void;
};

/**
 * MagicaVoxel's `config/hotkey.txt`: a global map plus one per editor (`model-editor`, `world-editor`);
 * the editor's map wins. Tab (switch editor) is handled by the viewport, which owns its focus.
 * Browsers reserve Ctrl+N/T/W, so those MagicaVoxel keys only reach the page in a standalone window.
 */
export function bindShortcuts(editor: Editor, commands: ObjectCommands, models: ModelCommands, files: FileActions, actions: ShortcutActions): void {
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
  const toggle = (option: DisplayOption) => () => editor.toggleDisplay(option);
  const mirror = (axis: Axis) => () => editor.toggleMirror(axis);
  const lockAxis = (axis: Axis) => () => editor.toggleAxis(axis);
  const resizeBrush = (delta: number) => () => {
    editor.setVoxBrush({ size: state.voxBrush.size + delta });
    editor.status(`Pincel de ${state.voxBrush.size} voxel(s)`);
  };

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
    ['ctrl+Digit5', actions.faceView],
    ['Digit6', actions.snapshot],
    ['ctrl+Digit6', actions.snapshot],
    ['Digit7', actions.saveCamera],
    ['Digit8', actions.loadCamera],
    ...Array.from({ length: 10 }, (_unused, slot): [string, () => void] => [`Numpad${slot}`, () => actions.selectCameraSlot(slot)]),
    ['w', () => actions.fly(1, 0, 0)],
    ['s', () => actions.fly(-1, 0, 0)],
    ['a', () => actions.fly(0, -1, 0)],
    ['d', () => actions.fly(0, 1, 0)],
    ['q', () => actions.fly(0, 0, -1)],
    ['e', () => actions.fly(0, 0, 1)],
    ['ctrl+e', toggle('edges')],
    ['ctrl+g', toggle('grid')],
    ['ctrl+b', toggle('backgroundObjects')],
    ['o', () => editor.setOnionSkin(!state.onionSkin)],
    ['?', actions.openHelp],
    ['shift+?', actions.openHelp],
    ['F1', actions.openHelp],
  ]);

  const byMode: Record<Mode, Keymap> = {
    model: new Map([
      ['v', brushMode('vox')],
      ['f', brushMode('face')],
      ['b', brushMode('box')],
      ['l', brushMode('geo')],
      ['t', brushType('attach')],
      ['r', brushType('erase')],
      ['g', brushType('paint')],
      ['Digit1', mirror(0)],
      ['Digit2', mirror(1)],
      ['Digit3', mirror(2)],
      ['ctrl+Digit1', lockAxis(0)],
      ['ctrl+Digit2', lockAxis(1)],
      ['ctrl+Digit3', lockAxis(2)],
      ['Minus', resizeBrush(-1)],
      ['Equal', resizeBrush(1)],
      ['m', brushType('msel')],
      ['n', brushType('asel')],
      ['u', models.full],
      ['i', models.fill],
      ['Delete', models.zero],
      ['Backspace', models.zero],
      ['ctrl+f', toggle('frame')],
      ['ctrl+a', () => models.run('sel_all')],
      ['ctrl+i', () => models.run('sel_inv')],
      ['ctrl+d', () => models.run('sel_none')],
      ['ctrl+c', () => models.run('copy')],
      ['ctrl+x', () => models.run('cut')],
      ['ctrl+v', () => models.run('paste')],
    ]),
    world: new Map([
      ['ctrl+n', commands.addObject],
      ['Delete', commands.deleteSelected],
      ['Backspace', commands.deleteSelected],
      ['ctrl+a', commands.selectAll],
      ['ctrl+i', commands.invertSelection],
      ['ctrl+d', commands.selectNone],
      ['ctrl+h', () => commands.hideSelected()],
      ['m', () => editor.setObjectTool(state.objectTool === 'msel' ? 'move' : 'msel')],
      ['ctrl+c', () => commands.copy('copy')],
      ['ctrl+shift+c', () => commands.copy('ref')],
      ['ctrl+x', commands.cut],
      ['ctrl+v', commands.paste],
      ['ctrl+t', () => commands.referencesToObjects(false)],
      ['ctrl+shift+t', () => commands.referencesToObjects(true)],
      ['ctrl+r', commands.groupSelected],
      ['ctrl+shift+r', commands.ungroupSelected],
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
