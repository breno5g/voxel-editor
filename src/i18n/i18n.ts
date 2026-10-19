import { CATALOG, type Message } from './catalog/index.ts';

/** Interface languages, by their own names (the picker never translates these). */
export const LOCALES = { 'pt-BR': 'Português', en: 'English', es: 'Español' } as const;
export type Locale = keyof typeof LOCALES;
type Params = Readonly<Record<string, string | number>>;

const STORAGE_KEY = 'voxel-editor.locale';
/** `Apagar@object` is "Apagar" where it means deleting an object; the suffix only tells catalog entries apart. */
const CONTEXT = /@[a-z-]+$/;
const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'] as const;
const WORD = /\p{L}{2}/u;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value);
}

export function isMessage(text: string): text is Message {
  return Object.hasOwn(CATALOG, text);
}

/** The saved choice, else the browser's first supported language, else English. Outside a browser (tests) the source, pt-BR. */
function resolveLocale(): Locale {
  if (typeof window === 'undefined') return 'pt-BR';
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked: fall back to the browser languages.
  }
  if (isLocale(saved)) return saved;
  for (const language of navigator.languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (base === 'en' || base === 'es') return base;
  }
  return 'en';
}

/** Fixed for the page's lifetime: module-level labels are resolved once, when the modules load. */
export const locale: Locale = resolveLocale();
const plurals = new Intl.PluralRules(locale);

/** Saves the language and reloads the page, which re-resolves every label (autosave keeps the work). */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (error) {
    console.error('[i18n] could not save the language', error);
    return;
  }
  location.reload();
}

function interpolate(text: string, params: Params | undefined): string {
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole)) : text;
}

/** The message in the current language, with `{name}` placeholders filled from `params`. */
export function t(message: Message, params?: Params): string {
  return interpolate(locale === 'pt-BR' ? message.replace(CONTEXT, '') : CATALOG[message][locale], params);
}

/** `one` or `other` by the language's plural rules for `count`, which also fills `{n}`. */
export function tn(count: number, one: Message, other: Message, params?: Params): string {
  return t(plurals.select(count) === 'one' ? one : other, { n: count, ...params });
}

const missing = new Set<string>();

function translateText(text: string): string {
  if (isMessage(text)) return t(text);
  if (!missing.has(text)) {
    missing.add(text);
    console.warn(`[i18n] no ${locale} translation for "${text}"`);
  }
  return text;
}

/** Whitespace-collapsed text, the form index.html strings take as catalog keys. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Translates the static text of index.html in place: text nodes and the `title`, `aria-label`,
 * `placeholder` and `alt` attributes. An element's `data-i18n` names the key of its text when the
 * Portuguese alone is ambiguous. Runs before any module writes into the DOM; pt-BR is the source.
 */
export function translateDocument(root: Document): void {
  root.documentElement.lang = locale;
  if (locale === 'pt-BR') return;
  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue ?? '';
    const text = normalizeText(raw);
    const parent = node.parentElement;
    if (!parent || !WORD.test(text) || parent.closest('script, style')) continue;
    const key = parent.dataset.i18n;
    node.nodeValue = raw.replace(raw.trim(), key && isMessage(key) ? t(key) : translateText(text));
  }
  for (const element of root.body.querySelectorAll(ATTRIBUTES.map((name) => `[${name}]`).join(','))) {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value && WORD.test(value)) element.setAttribute(name, translateText(normalizeText(value)));
    }
  }
}
