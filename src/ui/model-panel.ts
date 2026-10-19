import type { ModelCommands } from '../editor/model-commands.ts';

/**
 * MagicaVoxel's model edit panel: each button carries its console command in `data-command`
 * (`rot90 x`, `prim cone`), and each argument field the command its text completes (`loop` + `z 2`).
 */
export function bindModelPanel(models: ModelCommands): void {
  document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) =>
    button.addEventListener('click', () => models.run(button.dataset.command ?? '')),
  );
  document.querySelectorAll<HTMLInputElement>('[data-command-args]').forEach((input) =>
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      models.run(`${input.dataset.commandArgs} ${input.value}`);
    }),
  );
}
