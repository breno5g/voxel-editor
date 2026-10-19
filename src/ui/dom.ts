/** Typed lookup of a required element; fails fast if index.html and the code drift apart. */
export function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing #${id} (${type.name}) in index.html`);
  return node;
}

export function isEditingText(event: Event): boolean {
  const { target } = event;
  return target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'color';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A group of buttons that each carry a `data-value`: clicking one chooses its parsed value.
 * Returns the function that marks the button of the current value as pressed.
 */
export function bindButtonGroup<T>(groupId: string, parse: (raw: string | undefined) => T | undefined, choose: (value: T) => void) {
  const buttons = [...element(groupId, HTMLElement).querySelectorAll('button')];
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const value = parse(button.dataset.value);
      if (value !== undefined) choose(value);
    }),
  );
  return (current: T) => buttons.forEach((button) => button.setAttribute('aria-pressed', String(parse(button.dataset.value) === current)));
}
