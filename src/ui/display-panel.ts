import { isDisplayOption } from '../editor/editor.ts';
import type { Editor } from '../editor/editor.ts';
import { element } from './dom.ts';

/** Viewport display toggles (MagicaVoxel's "Show Display Settings" switches). */
export function bindDisplayPanel(editor: Editor): void {
  const buttons = [...element('display-options', HTMLDivElement).querySelectorAll('button')];
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const { display } = button.dataset;
      if (isDisplayOption(display)) editor.toggleDisplay(display);
    }),
  );
  const sync = () =>
    buttons.forEach((button) => {
      const { display } = button.dataset;
      button.setAttribute('aria-pressed', String(isDisplayOption(display) && editor.state.display[display]));
    });
  sync();
  editor.subscribe((event) => {
    if (event.type === 'display') sync();
  });
}
