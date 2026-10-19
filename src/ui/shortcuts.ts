import type { Editor, Tool } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import type { Vec3 } from '../format/vox.ts';
import { isEditingText } from './dom.ts';
import type { FileActions } from './file-actions.ts';

/** Comma/period are matched by physical key so Shift (which turns ',' into '<') still works. */
const KEYS_BY_CODE = new Set(['Comma', 'Period']);

function comboOf(event: KeyboardEvent): string {
  const key = KEYS_BY_CODE.has(event.code) ? event.code : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [event.ctrlKey || event.metaKey ? 'ctrl' : '', event.shiftKey ? 'shift' : '', key].filter(Boolean).join('+');
}

/** Lets a focused button keep its own Space/Enter activation. */
const isActivatingButton = (event: KeyboardEvent) => event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter');

export function bindShortcuts(editor: Editor, commands: ObjectCommands, files: FileActions, frameScene: () => void, openHelp: () => void): void {
  const tool = (name: Tool) => () => editor.setTool(name);
  const move = (delta: Vec3) => () => commands.moveSelected(delta);
  const undo = () => {
    if (!editor.history.undo()) editor.status('Nada para desfazer');
  };
  const redo = () => {
    if (!editor.history.redo()) editor.status('Nada para refazer');
  };

  const shortcuts = new Map<string, () => void>([
    ['1', tool('select')],
    ['2', tool('attach')],
    ['3', tool('erase')],
    ['4', tool('paint')],
    ['b', () => editor.setBrush(editor.state.brush === 'box' ? 'voxel' : 'box')],
    ['o', () => editor.setOnionSkin(!editor.state.onionSkin)],
    ['ctrl+z', undo],
    ['ctrl+y', redo],
    ['ctrl+shift+z', redo],
    ['ctrl+s', files.save],
    ['ctrl+o', files.open],
    ['F5', commands.addTransformKey],
    ['shift+F5', commands.addModelFrame],
    ['F6', commands.removeTransformKey],
    ['shift+F6', commands.removeModelFrame],
    ['Comma', () => editor.stepFrame(-1)],
    ['Period', () => editor.stepFrame(1)],
    ['ctrl+Comma', () => commands.stepKey(-1)],
    ['ctrl+Period', () => commands.stepKey(1)],
    ['ctrl+shift+Comma', () => commands.stepKey(-1, true)],
    ['ctrl+shift+Period', () => commands.stepKey(1, true)],
    ['Delete', commands.deleteSelected],
    ['ctrl+d', commands.duplicateSelected],
    ['r', () => commands.rotateSelected(2, 1)],
    ['shift+r', () => commands.rotateSelected(2, -1)],
    [' ', () => editor.setPlaying(!editor.state.playing)],
    ['f', frameScene],
    ['?', openHelp],
    ['shift+?', openHelp],
    ['F1', openHelp],
    ['ArrowLeft', move([-1, 0, 0])],
    ['ArrowRight', move([1, 0, 0])],
    ['ArrowUp', move([0, 1, 0])],
    ['ArrowDown', move([0, -1, 0])],
    ['PageUp', move([0, 0, 1])],
    ['PageDown', move([0, 0, -1])],
  ]);

  window.addEventListener('keydown', (event) => {
    if (isEditingText(event) || isActivatingButton(event)) return;
    const action = shortcuts.get(comboOf(event));
    if (!action) return;
    event.preventDefault();
    action();
  });
}
