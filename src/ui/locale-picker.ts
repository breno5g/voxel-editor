import { isLocale, locale, LOCALES, setLocale } from '../i18n/i18n.ts';
import { element } from './dom.ts';

/** The interface language picker in the toolbar; choosing reloads the page in that language. */
export function bindLocalePicker(): void {
  const picker = element('locale-picker', HTMLSelectElement);
  picker.append(...Object.entries(LOCALES).map(([value, name]) => new Option(name, value, false, value === locale)));
  picker.addEventListener('change', () => {
    if (isLocale(picker.value)) setLocale(picker.value);
  });
}
