# Roadmap até a v1 (paridade 1:1 com o MagicaVoxel 0.99.7)

Fonte da paridade: os painéis `config/ui/*.ui` e o mapa `config/hotkey.txt` do MagicaVoxel 0.99.7.2, que listam cada controle com o comando de console que ele dispara (ex.: `rot90 x`, `opack xform`). Os nomes entre crases abaixo são esses comandos. Comportamentos ambíguos são confirmados no binário (ver [`magicavoxel-re.md`](magicavoxel-re.md)).

Depois da v1 o editor diverge livremente; até lá, atalhos e semântica seguem o MagicaVoxel. Extras que não conflitam (onion skin, autosave) ficam.

## v0.5 (feito)

- [x] `.vox` v200 com chaves de animação, round-trip de chunks desconhecidos
- [x] Adicionar/apagar/pintar, pincel voxel e caixa, conta-gotas (`Alt`)
- [x] Keys de transformação e frames de modelo, timeline, playback, loop, intervalo
- [x] Objetos: novo, apagar, duplicar, renomear, ocultar, girar 90°, espelhar, redimensionar
- [x] Undo/redo, autosave, sprite sheet PNG

## v0.6: modos e mapa de atalhos

- [ ] Modo Modelo e modo Mundo (`olevel -2`, `TAB`, duplo clique)
- [ ] F5/F6 e `Ctrl+,`/`Ctrl+.` agem no frame de modelo (modo Modelo) ou na key de transformação (modo Mundo), como `***REMOVED***`
- [ ] Mapa de atalhos do `hotkey.txt` (global, model-editor, world-editor)
- [ ] Mundo: clicar seleciona, arrastar move no chão, `G` assenta no chão (`omove g`), `+`/`-` e `9`/`0` giram (`orot`)
- [ ] Modelo: objetos de fundo (`Ctrl+B`, esmaecidos), grade (`Ctrl+G`), moldura (`Ctrl+F`)
- [ ] Espelho X/Y/Z do pincel (`1` `2` `3`)
- [ ] Câmera: recentralizar (`5`), vista de face (`Ctrl+5`), perspectiva/ortogonal/isométrica, slots `7`/`8`/numpad salvos em `rCAM`, captura `6`

## v0.7: pincéis

- [ ] Voxel com tamanho 1–64, cubo/esfera, 2D/3D (`b_vox_*`)
- [ ] Face: extrusão por arrasto, cor da paleta ou do voxel, vizinhança 4/8 (`b_face_*`)
- [ ] Geometria: linha, quadrado, círculo, projetar na superfície, centro, tamanho par (`b_geo`, `b_line_proj`, `b_center_*`)
- [ ] Modo eixo X/Y/Z (`Ctrl+1/2/3`)
- [ ] Seleção por região: mesma cor ou conectada, 4/8 vizinhos; remover e substituir região

## v0.8: seleção e operações de modelo

- [ ] Seleção retangular, por pincel e por caixa; somar (`Shift`) e subtrair (`Shift+Alt`); `sel_all`/`sel_none`/`sel_inv`, `sel_col`
- [ ] Copiar/recortar/colar voxels; gizmo mover/loop, escalar, wrap, girar (`Enter`/`Esc`)
- [ ] `full`, `fill`, `zero`, `rev`, `x2`, `xh`, `rot90`, `flip`, `loop`, `mir`, `dia`
- [ ] Mover/escalar/cisalhar/girar/repetir com argumentos
- [ ] `prim elli|cyli|pyra|cone`, `maze`, `noise`, `fractal`, `mask`, `tex`
- [ ] `flood 0` (remover invisíveis), `flood` (preencher vazios internos), dilatação, erosão
- [ ] Redimensionar por gizmo e `shrink` (ajustar ao conteúdo)

## v0.9: editor de mundo

- [ ] Multisseleção, seleção por retângulo, `osel_all`/`osel_inv`/`osel_none`
- [ ] Grupos: agrupar/desagrupar (`Ctrl+R`), entrar/sair (`TAB`), contorno da cena com expandir/recolher, ordenar
- [ ] Referências: copiar como referência, `oref2obj`, `Shift+arrastar`
- [ ] Copiar/colar objetos e transformações (`m_copy`, `m_paste`), copiar no frame atual
- [ ] Booleanas: união, interseção, subtração, substituição
- [ ] Alinhar (mín/centro/máx), espelhar objetos, ordem de render
- [ ] Camadas: 8 camadas com nome, cor, visibilidade, selecionar objetos da camada
- [ ] Wrap e padrões no mundo

## v0.10: paleta e materiais

- [ ] Seletor HSV/RGB, hex, copiar/colar cor e região da paleta, gradiente (`Ctrl+Alt`), trocar (`Ctrl`)
- [ ] Ordenar, marcar, mascarar cores não usadas, cores aleatórias, nota da paleta (`NOTE`)
- [ ] Importar/exportar paleta `.png`/`.act`; paleta padrão do MagicaVoxel
- [ ] Materiais `MATL`: difuso, emissivo, mistura, metal, vidro, nuvem; copiar/colar/resetar

## v0.11: animação

- [ ] Multisseleção de keys na timeline, duplicar arrastando, `arev`, `asel all|inv|none`
- [ ] Tempo global (`aset global`), velocidade `a_speed`
- [ ] Empacotar modelos em animação e desempacotar (`opack`, `ounpack`), importar sprites

## v0.12: importar e exportar

- [ ] Exportar `obj`, `ply`, `mc` (marching cubes), `xraw`, `slab`, `qb`, `iso`, `2d`, `slice`, `pcl`, `cube`; só selecionados; espaço local
- [ ] Importar `.qb`, `.xraw`, `.png` (sprites), Slab6 `.vox`
- [ ] Lista de projetos, duplicar projeto, salvar como, recuperar (só modelos e paleta)

## v0.13: shaders XS e padrões

- [ ] Executar shaders XS na GPU com a API do MagicaVoxel (`map()`, `voxel()`, `i_args`, `i_iter`, ...), argumentos lidos do cabeçalho
- [ ] Biblioteca de padrões: criar da seleção, pincel de padrão, colocar no mundo

## v1.0: renderizador

- [ ] Path tracer WebGL2 progressivo com materiais, sol, céu uniforme/atmosférico/IBL `.hdr`, névoa
- [ ] Câmera: FOV, projeções, profundidade de campo, exposição, vinheta, ACES, bloom
- [ ] Display: chão, grade, arestas, fundo transparente, escala do voxel, primitivas (cubo, lego, MC, argila, esfera, cilindro)
- [ ] Imagem final, turntable e animação; amostragem (`pt_bounce_*`, `pt_spp`, ...)
- [ ] Opções do viewport: AO, sombreamento constante, cores de fundo/grade/aresta/seleção
