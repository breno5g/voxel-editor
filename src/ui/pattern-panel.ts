import type { Editor } from '../editor/editor.ts';
import type { PatternCommands } from '../editor/pattern-commands.ts';
import { isoImage, ISO_OPTIONS } from '../format/voxel-images.ts';
import { bindButtonGroup, element } from './dom.ts';

/** MagicaVoxel's pattern panel: the current pattern, its source, and the pattern library. */
export function bindPatternPanel(editor: Editor, patterns: PatternCommands): void {
  const { state } = editor;
  const preview = element('pattern-preview', HTMLCanvasElement);
  const library = element('pattern-library', HTMLSelectElement);

  const guarded = (action: () => Promise<void> | void) => async () => {
    try {
      await action();
      await refreshLibrary();
    } catch (error) {
      editor.fail('Padrões', error);
    }
  };

  async function refreshLibrary() {
    const names = await patterns.listPatterns();
    const current = library.value;
    library.replaceChildren(...names.map((name) => new Option(name, name)));
    if (names.includes(current)) library.value = current;
  }

  const drawPreview = () => {
    preview.hidden = !state.pattern;
    if (!state.pattern) return;
    const image = isoImage(state.pattern, state.vox.palette, { ...ISO_OPTIONS, views: 1 });
    preview.width = image.width;
    preview.height = image.height;
    preview.getContext('2d')?.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
  };

  element('pattern-from-selection', HTMLButtonElement).addEventListener('click', () => patterns.patternFromSelection());
  element('pattern-place', HTMLButtonElement).addEventListener('click', () => patterns.placePattern());
  element('pattern-rotate', HTMLButtonElement).addEventListener('click', () => patterns.rotatePattern(2, 1));
  element('pattern-load', HTMLButtonElement).addEventListener('click', () => library.value && void guarded(() => patterns.loadPattern(library.value))());
  element('pattern-save', HTMLButtonElement).addEventListener('click', () => {
    if (!state.pattern) return editor.status('Crie um padrão primeiro (da seleção, ou da biblioteca)', 'error');
    const name = window.prompt('Nome do padrão', library.value || 'padrão');
    if (name?.trim()) void guarded(() => patterns.savePattern(name))().then(() => (library.value = name.trim()));
  });
  element('pattern-delete', HTMLButtonElement).addEventListener('click', () => {
    if (library.value && window.confirm(`Apagar o padrão ${library.value}?`)) void guarded(() => patterns.deletePattern(library.value))();
  });
  const showColor = bindButtonGroup('pattern-color', (raw) => (raw === 'palette' ? true : raw === 'voxel' ? false : undefined), editor.setPatternUsesPalette);

  let shown = state.pattern;
  const sync = () => {
    showColor(state.patternUsesPalette);
    if (shown === state.pattern) return;
    shown = state.pattern;
    drawPreview();
  };
  sync();
  drawPreview();
  void guarded(() => undefined)();
  editor.subscribe((event) => {
    if (event.type === 'tool') sync();
    if (event.type === 'palette' || event.type === 'document') drawPreview();
  });
}
