import editor from './editor.ts';
import htmlDialogs from './html-dialogs.ts';
import htmlLeft from './html-left.ts';
import htmlRight from './html-right.ts';
import ui from './ui.ts';

/**
 * One entry per Portuguese source string (the key), with its English and Spanish text. Keys keep
 * `{name}` placeholders verbatim; an `@context` suffix separates two meanings of the same words.
 */
export type Entry = { readonly en: string; readonly es: string };
export type Catalog = Readonly<Record<string, Entry>>;

/** Split by where the strings live, so each part can be edited on its own; a key shared by two areas must translate alike. */
export const AREAS = { htmlLeft, htmlRight, htmlDialogs, editor, ui } as const;

export const CATALOG = { ...htmlLeft, ...htmlRight, ...htmlDialogs, ...editor, ...ui };
export type Message = keyof typeof CATALOG;
