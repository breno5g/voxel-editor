import { version } from '../../package.json';
import { MODES } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { t } from '../i18n/i18n.ts';
import { bindButtonGroup, element } from './dom.ts';
import type { FileActions } from './file-actions.ts';

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

  const showMode = bindButtonGroup('modes', (raw) => MODES.find((mode) => mode === raw), editor.setMode);
  const modeOnly = [...document.querySelectorAll<HTMLElement>('[data-only-mode]')];

  element('app-version', HTMLSpanElement).textContent = `v${version}`;
  const fileName = element('file-name', HTMLSpanElement);
  editor.subscribe(() => {
    showMode(state.mode);
    modeOnly.forEach((group) => (group.hidden = group.dataset.onlyMode !== state.mode));
    fileName.textContent = state.dirty ? t('{file} (não salvo)', { file: state.fileName }) : state.fileName;
  });
}
