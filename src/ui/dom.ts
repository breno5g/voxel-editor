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
