import type { StatusTone } from '../editor/editor.ts';
import { t } from '../i18n/i18n.ts';
import { element } from './dom.ts';

declare global {
  interface Navigator {
    /** Keyboard Lock (Chromium, not in TypeScript's DOM types): in fullscreen, keys the browser reserves reach the page. */
    readonly keyboard?: { lock(codes?: string[]): Promise<void>; unlock(): void };
  }
}

/** MagicaVoxel shortcuts browsers keep for themselves: new object, reference to object, shadow. */
const RESERVED_KEYS = ['KeyN', 'KeyT', 'KeyW'];

/**
 * Fullscreen with the keyboard locked, so `Ctrl+N`, `Ctrl+T` and `Ctrl+W` work like in MagicaVoxel;
 * outside it (or without the API) the browser keeps them.
 */
export function bindFullscreen(status: (message: string, tone?: StatusTone) => void): void {
  const button = element('fullscreen-toggle', HTMLButtonElement);
  button.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) return await document.exitFullscreen();
      await document.documentElement.requestFullscreen();
      if (!navigator.keyboard) return status(t('Tela cheia; este navegador não libera Ctrl+N/T/W para o editor'));
      await navigator.keyboard.lock(RESERVED_KEYS);
      status(t('Tela cheia: Ctrl+N, Ctrl+T e Ctrl+W agora vão para o editor (segure Esc para sair)'));
    } catch (error) {
      status(t('Tela cheia indisponível: {error}', { error: error instanceof Error ? error.message : String(error) }), 'error');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    button.setAttribute('aria-pressed', String(document.fullscreenElement !== null));
    if (!document.fullscreenElement) navigator.keyboard?.unlock();
  });
}
