import { element } from './dom.ts';

/** Shortcut reference in a native modal dialog (Esc and the Close button dismiss it). */
export function bindHelp(): { open: () => void } {
  const dialog = element('help', HTMLDialogElement);
  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  element('open-help', HTMLButtonElement).addEventListener('click', open);
  return { open };
}
