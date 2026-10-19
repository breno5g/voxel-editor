import { DEFAULT_DISPLAY, DISPLAY_COLORS, DISPLAY_OPTIONS, isDisplayOption } from '../editor/editor.ts';
import type { Display, DisplayColor, DisplayOption, Editor } from '../editor/editor.ts';
import { element } from './dom.ts';

const STORAGE_KEY = 'voxel-editor:display';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Viewport settings saved by an earlier session, keeping only well-formed values (MagicaVoxel keeps them in its config). */
function storedDisplay(): Partial<Display> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const entries = new Map(Object.entries(parsed));
    const flags = DISPLAY_OPTIONS.flatMap((option): [DisplayOption, boolean][] => {
      const value = entries.get(option);
      return typeof value === 'boolean' ? [[option, value]] : [];
    });
    const storedColors = entries.get('colors');
    const colorEntries = typeof storedColors === 'object' && storedColors !== null ? new Map(Object.entries(storedColors)) : new Map<string, unknown>();
    const colors = { ...DEFAULT_DISPLAY.colors };
    DISPLAY_COLORS.forEach((key) => {
      const value = colorEntries.get(key);
      if (typeof value === 'string' && HEX_COLOR.test(value)) colors[key] = value;
    });
    const spacing = entries.get('frameSpacing');
    return { ...Object.fromEntries(flags), colors, ...(typeof spacing === 'number' ? { frameSpacing: spacing } : {}) };
  } catch {
    return {};
  }
}

const isDisplayColor = (value: string | undefined): value is DisplayColor => DISPLAY_COLORS.some((key) => key === value);

/** Viewport display toggles (MagicaVoxel's display switches) and the `m_opt` display options. */
export function bindDisplayPanel(editor: Editor): void {
  const { state } = editor;
  const buttons = [...element('display-options', HTMLDivElement).querySelectorAll<HTMLButtonElement>('button[data-display]')];
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      const { display } = button.dataset;
      if (isDisplayOption(display)) editor.toggleDisplay(display);
    }),
  );

  const settings = element('display-settings', HTMLElement);
  const more = element('display-more', HTMLButtonElement);
  more.addEventListener('click', () => {
    settings.hidden = !settings.hidden;
    more.setAttribute('aria-expanded', String(!settings.hidden));
  });
  const checks = [...settings.querySelectorAll<HTMLInputElement>('[data-display-check]')];
  checks.forEach((input) =>
    input.addEventListener('change', () => {
      const option = input.dataset.displayCheck;
      if (isDisplayOption(option)) editor.setDisplay({ [option]: input.checked });
    }),
  );
  const colorInputs = [...settings.querySelectorAll<HTMLInputElement>('[data-display-color]')];
  colorInputs.forEach((input) =>
    input.addEventListener('input', () => {
      const key = input.dataset.displayColor;
      if (isDisplayColor(key)) editor.setDisplay({ colors: { ...state.display.colors, [key]: input.value } });
    }),
  );
  const spacing = element('frame-spacing', HTMLInputElement);
  spacing.addEventListener('change', () => editor.setDisplay({ frameSpacing: spacing.valueAsNumber }));
  element('display-reset', HTMLButtonElement).addEventListener('click', () => editor.setDisplay(DEFAULT_DISPLAY));

  const sync = () => {
    const { display } = state;
    buttons.forEach((button) => {
      const option = button.dataset.display;
      button.setAttribute('aria-pressed', String(isDisplayOption(option) && display[option]));
    });
    checks.forEach((input) => {
      const option = input.dataset.displayCheck;
      input.checked = isDisplayOption(option) && display[option];
    });
    colorInputs.forEach((input) => {
      const key = input.dataset.displayColor;
      if (isDisplayColor(key)) input.value = display.colors[key];
    });
    spacing.value = String(display.frameSpacing);
  };
  editor.setDisplay(storedDisplay());
  sync();
  editor.subscribe((event) => {
    if (event.type !== 'display') return;
    sync();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.display));
    } catch (error) {
      editor.fail('Não foi possível guardar as opções de exibição', error);
    }
  });
}
