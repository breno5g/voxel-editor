import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS, CATALOG, type Catalog } from './catalog/index.ts';
import { isMessage, normalizeText, t, tn } from './i18n.ts';

const ROOT = new URL('../../', import.meta.url);
const WORD = /\p{L}{2}/u;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) => text.replace(/&(\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** The strings translateDocument looks up: body text nodes and the translated attributes, as catalog keys. */
function htmlStrings(html: string): { texts: string[]; keys: string[] } {
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
  const texts = [
    ...[...body.matchAll(/>([^<>]+)</g)].map((match) => match[1]),
    ...[...body.matchAll(/\s(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map((match) => match[1]),
  ]
    .map((text) => normalizeText(decode(text)))
    .filter((text) => WORD.test(text));
  const keys = [...body.matchAll(/\sdata-i18n="([^"]*)"/g)].map((match) => match[1]);
  return { texts: [...new Set(texts)], keys };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('catalog', () => {
  it('covers every string of index.html', () => {
    const { texts, keys } = htmlStrings(readFileSync(new URL('index.html', ROOT), 'utf8'));
    expect(texts.filter((text) => !isMessage(text))).toEqual([]);
    expect(keys.filter((key) => !isMessage(key))).toEqual([]);
  });

  it('leaves no accented Portuguese literal in the code outside the catalog', () => {
    const literals = sourceFiles(new URL('src', ROOT).pathname).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ](?:(?!\1)[^\\\n]|\\.)*)\1/g)]
        .map((match) => match[2])
        .filter((literal) => !isMessage(literal))
        .map((literal) => `${path.slice(path.indexOf('src/'))}: ${literal}`),
    );
    expect(literals).toEqual([]);
  });

  it('translates every entry alike wherever two areas share it', () => {
    const seen = new Map<string, string>();
    const conflicts = Object.values(AREAS as Record<string, Catalog>).flatMap((area) =>
      Object.entries(area).flatMap(([key, entry]) => {
        const json = JSON.stringify(entry);
        const previous = seen.get(key);
        seen.set(key, json);
        return previous !== undefined && previous !== json ? [`${key}: ${previous} vs ${json}`] : [];
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('keeps every placeholder and leaves no translation empty', () => {
    const broken = Object.entries(CATALOG as Catalog).flatMap(([key, entry]) =>
      Object.entries(entry).flatMap(([language, text]) =>
        !text.trim() || placeholders(text).join() !== placeholders(key).join() ? [`${language} ${key}: ${text}`] : [],
      ),
    );
    expect(broken).toEqual([]);
  });
});

describe('t', () => {
  const sample = Object.keys(CATALOG).find((key) => placeholders(key).length === 0 && !key.includes('@'));

  it('returns the source text outside a browser', () => {
    if (sample && isMessage(sample)) expect(t(sample)).toBe(sample);
  });

  it('picks the plural form by count', () => {
    if (!sample || !isMessage(sample)) return;
    const other = Object.keys(CATALOG).find((key) => key !== sample && isMessage(key));
    if (!other || !isMessage(other)) return;
    expect(tn(1, sample, other)).toBe(t(sample));
    expect(tn(2, sample, other)).toBe(t(other));
  });
});
