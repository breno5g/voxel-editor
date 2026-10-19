# Voxel Editor

Editor de voxels com animação para Linux (roda no browser), compatível com o formato `.vox` do MagicaVoxel, incluindo as chaves de animação que a spec pública não documenta. A engenharia reversa que embasa o formato e a avaliação de animação está em [`docs/magicavoxel-re.md`](docs/magicavoxel-re.md).

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # inclui round-trip dos .vox de exemplo do MagicaVoxel, se a pasta existir
pnpm build
```

## Uso

Os atalhos seguem o `config/hotkey.txt` do MagicaVoxel 0.99.7. O botão **Atalhos** (`?`) lista tudo dentro do app.

Como no MagicaVoxel, o editor tem dois modos. O **Modelo** edita os voxels do objeto selecionado, com os demais esmaecidos ao fundo. O **Mundo** organiza e anima os objetos. Para alternar, use `Tab` com o viewport focado, os botões do topo ou um duplo clique (no objeto entra no modelo; no vazio volta ao mundo).

Fluxo básico de animação:

1. Desenhe no modo Modelo.
2. Vá para outro frame e aperte `F5`. No modo Modelo isso cria um frame de modelo, uma cópia editável (`O` liga o onion skin). No modo Mundo cria uma key de posição: mova com as setas ou arrastando, gire com `+`/`-`.
3. Salve com **Salvar** (`.vox`, que abre no MagicaVoxel) ou exporte com **Exportar sprite sheet** (PNG do intervalo de frames).

| Ação | Atalho |
|---|---|
| Girar / mover / zoom | botão direito / do meio / roda, ou `Espaço`/`Z`/`K` + arrastar com o esquerdo |
| Recentralizar / vista de face / salvar imagem | `5` / `Ctrl+5` / `6` |
| Câmera: salvar / carregar / slot | `7` / `8` / teclado numérico; perspectiva, livre (`WASDQE`), ortogonal e isométrica no canto do viewport |
| Exibir grade / arestas / fundo / moldura | `Ctrl+G` / `Ctrl+E` / `Ctrl+B` / `Ctrl+F` |
| Key: adicionar / remover | `F5` / `F6` (frame de modelo no modo Modelo, posição no modo Mundo) |
| Frame anterior / próximo; key anterior / próxima | `,` `.`; `Ctrl+,` `Ctrl+.` (`+Shift` vai à primeira/última) |
| **Modelo:** pincel voxel / face / caixa / geometria | `V` / `F` / `B` / `L` |
| **Modelo:** tamanho do pincel voxel | `-` / `+` |
| **Modelo:** adicionar / apagar / pintar | `T` / `R` / `G` |
| **Modelo:** espelho X / Y / Z | `1` / `2` / `3` |
| **Modelo:** modo eixo X / Y / Z (o traço atravessa o modelo) | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| **Modelo:** encher / pintar tudo / limpar | `U` / `I` / `Delete` |
| **Modelo:** pegar cor | `Alt` + clique |
| **Mundo:** mover objeto | arrastar, setas, `PageUp`/`PageDown` |
| **Mundo:** girar 90° em Z / em X | `+` `-` / `9` `0` |
| **Mundo:** apoiar no chão / ocultar / desmarcar | `G` / `Ctrl+H` / `Ctrl+D` |
| **Mundo:** novo / apagar objeto | `Ctrl+N` (só em janela própria; o navegador reserva) / `Delete` |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` |
| Novo / abrir / salvar / salvar como | `Ctrl+P` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` (ou arraste um `.vox`) |

- O painel **Pincel**, à esquerda, tem as opções de cada modo: tamanho e forma do voxel; cor e conexão da face; linha, quadrado ou círculo da geometria. Também tem as ações de região: conta-gotas, remover e substituir região.
- O painel à direita renomeia, redimensiona (todos os frames de modelo; a posição no mundo é mantida), gira, espelha, duplica e apaga o objeto selecionado. Na lista, `●`/`◌` mostra/oculta e `◆` marca objetos animados.
- Toda edição (inclusive de paleta) entra no desfazer. O trabalho não salvo vai para o IndexedDB a cada 3 s e é oferecido de volta ao reabrir a página.
- O caminho até a paridade com o MagicaVoxel está em [`docs/roadmap-v1.md`](docs/roadmap-v1.md).

## Estrutura

```
src/format/    .vox: tipos, reader, writer, rotação, documento padrão
src/scene/     avaliação de keyframes e do grafo de cena (port do MagicaVoxel)
src/geometry/  meshing em chunks 32³ e raycast DDA, sem dependência de three.js
src/render/    viewport three.js, câmeras, material com paleta em textura, cache de malhas, exportação de imagem
src/editor/    estado + eventos, histórico, ferramentas de voxel, comandos de objeto, playback
src/ui/        um módulo por painel
```
