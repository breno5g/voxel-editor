import { version } from '../../package.json';
import { isBrushMode, isBrushType, isMode } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { isAxis } from '../format/rotation.ts';
import { element } from './dom.ts';
import type { FileActions } from './file-actions.ts';

/**
 * Wires a group of buttons that each carry `data-<attribute>` to a setter;
 * returns the function that marks the current value as pressed.
 */
function bindChoice<T extends string>(groupId: string, attribute: string, isValue: (value: unknown) => value is T, choose: (value: T) => void) {
  const buttons = [...element(groupId, HTMLDivElement).querySelectorAll('button')];
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const value = button.dataset[attribute];
      if (isValue(value)) choose(value);
    }),
  );
  return (current: T) => buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset[attribute] === current)));
}

export function bindToolbar(editor: Editor, files: FileActions, commands: ObjectCommands, focusCamera: () => void): void {
  const { state } = editor;
  const actions: [string, () => void][] = [
    ['new-file', files.newDocument],
    ['open-file', files.open],
    ['save-file', files.save],
    ['add-object', commands.addObject],
    ['frame-camera', focusCamera],
    ['export-sheet', () => void files.exportSpriteSheet()],
  ];
  actions.forEach(([id, action]) => element(id, HTMLButtonElement).addEventListener('click', action));

  const showMode = bindChoice('modes', 'mode', isMode, editor.setMode);
  const showBrushMode = bindChoice('brush-modes', 'brushMode', isBrushMode, editor.setBrushMode);
  const showBrushType = bindChoice('brush-types', 'brushType', isBrushType, editor.setBrushType);
  const mirrorButtons = [...element('mirror', HTMLDivElement).querySelectorAll('button')];
  mirrorButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const axis = Number(button.dataset.axis);
      if (isAxis(axis)) editor.toggleMirror(axis);
    }),
  );
  const modeOnly = [...document.querySelectorAll<HTMLElement>('[data-only-mode]')];

  element('app-version', HTMLSpanElement).textContent = `v${version}`;
  const fileName = element('file-name', HTMLSpanElement);
  editor.subscribe(() => {
    showMode(state.mode);
    showBrushMode(state.brushMode);
    showBrushType(state.brushType);
    mirrorButtons.forEach((button) => button.setAttribute('aria-pressed', String(state.mirror[Number(button.dataset.axis)] ?? false)));
    modeOnly.forEach((group) => (group.hidden = group.dataset.onlyMode !== state.mode));
    fileName.textContent = `${state.fileName}${state.dirty ? ' (não salvo)' : ''}`;
  });
}
