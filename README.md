# Voxel Editor

Editor de voxels com animação para Linux (roda no browser), compatível com o formato `.vox` do MagicaVoxel, incluindo as chaves de animação que a spec pública não documenta. A engenharia reversa que embasa o formato e a avaliação de animação está em [`docs/magicavoxel-re.md`](docs/magicavoxel-re.md).

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # inclui round-trip dos .vox de exemplo do MagicaVoxel, se a pasta existir
pnpm build
```

## Uso

Fluxo básico de animação: desenhe no frame 0, vá para outro frame e use `Shift+F5` para criar um frame de modelo (cópia editável, com onion skin em `O`) ou `F5` + setas/`R` para animar posição e rotação. Exporte com **Salvar** (`.vox`, abre no MagicaVoxel) ou **Exportar sprite sheet** (PNG do intervalo de frames). O botão **Atalhos** (`?`) lista tudo abaixo dentro do app.

| Ação | Atalho |
|---|---|
| Girar / mover / zoom | botão direito / do meio / roda |
| Selecionar, Adicionar, Apagar, Pintar | `1` `2` `3` `4` (botão esquerdo aplica) |
| Pincel voxel / caixa (arraste para preencher uma caixa) | `B` |
| Pegar cor do voxel | `Alt` + clique |
| Mover objeto selecionado | setas (X/Y), PageUp/PageDown (Z) |
| Girar objeto 90° em Z (X/Y e espelhar no painel) | `R` / `Shift+R` |
| Duplicar / apagar objeto | `Ctrl+D` / `Delete` |
| Frame anterior / próximo | `,` `.` |
| Key anterior / próxima (primeira / última) | `Ctrl+,` `Ctrl+.` (`+Shift`) |
| Key de posição: adicionar / remover | `F5` / `F6` |
| Frame de modelo (duplica o modelo atual): adicionar / remover | `Shift+F5` / `Shift+F6` |
| Onion skin (frame de modelo anterior translúcido) | `O` |
| Play / pausa | `Espaço` |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` |
| Abrir / salvar | `Ctrl+O` / `Ctrl+S` (ou arraste um `.vox` na janela) |
| Enquadrar cena | `F` |

- Mover ou girar um objeto estático (uma key só) afeta todos os frames. Num objeto animado, cria ou atualiza a key do frame atual.
- O painel **Objeto selecionado** renomeia, redimensiona (todos os frames de modelo; a posição no mundo é mantida), gira, espelha, duplica e apaga. Na lista de objetos, `●`/`◌` mostra/oculta e `◆` marca objetos animados.
- Toda edição (inclusive de paleta) entra no desfazer. O trabalho não salvo vai para o IndexedDB a cada 3 s e é oferecido de volta ao reabrir a página.

## Estrutura

```
src/format/    .vox: tipos, reader, writer, rotação, documento padrão
src/scene/     avaliação de keyframes e do grafo de cena (port do MagicaVoxel)
src/geometry/  meshing em chunks 32³ e raycast DDA, sem dependência de three.js
src/render/    viewport three.js, material com paleta em textura, cache de malhas, sprite sheet
src/editor/    estado + eventos, histórico, ferramentas de voxel, comandos de objeto, playback
src/ui/        um módulo por painel
```
