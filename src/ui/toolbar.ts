import { version } from '../../package.json';
import { isBrush, isTool } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import type { ObjectCommands } from '../editor/object-commands.ts';
import { element } from './dom.ts';
import type { FileActions } from './file-actions.ts';

export function bindToolbar(editor: Editor, files: FileActions, commands: ObjectCommands, frameScene: () => void): void {
  const actions: [string, () => void][] = [
    ['new-file', files.newDocument],
    ['open-file', files.open],
    ['save-file', files.save],
    ['add-object', commands.addObject],
    ['frame-camera', frameScene],
    ['export-sheet', () => void files.exportSpriteSheet()],
  ];
  actions.forEach(([id, action]) => element(id, HTMLButtonElement).addEventListener('click', action));

  const toolButtons = [...element('tools', HTMLDivElement).querySelectorAll('button')];
  toolButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const { tool } = button.dataset;
      if (isTool(tool)) editor.setTool(tool);
    }),
  );

  const brushButtons = [...element('brushes', HTMLDivElement).querySelectorAll('button')];
  brushButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const { brush } = button.dataset;
      if (isBrush(brush)) editor.setBrush(brush);
    }),
  );

  element('app-version', HTMLSpanElement).textContent = `v${version}`;
  const fileName = element('file-name', HTMLSpanElement);
  editor.subscribe(() => {
    toolButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === editor.state.tool)));
    brushButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.brush === editor.state.brush)));
    fileName.textContent = `${editor.state.fileName}${editor.state.dirty ? ' (não salvo)' : ''}`;
  });
}
