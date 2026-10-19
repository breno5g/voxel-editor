import type { Editor } from '../editor/editor.ts';
import { element } from './dom.ts';

/** Shows status events and routes uncaught errors through `editor.fail` so none go unnoticed. */
export function bindStatusBar(editor: Editor): void {
  const bar = element('status', HTMLDivElement);
  editor.subscribe((event) => {
    if (event.type !== 'status') return;
    bar.textContent = event.message;
    bar.dataset.tone = event.tone;
  });
  window.addEventListener('error', (event) => editor.fail('Erro inesperado', event.error));
  window.addEventListener('unhandledrejection', (event) => editor.fail('Erro inesperado', event.reason));
}
