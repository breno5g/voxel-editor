# Roadmap até a v1 (paridade 1:1 com o MagicaVoxel 0.99.7)

Fonte da paridade: os painéis `config/ui/*.ui` e o mapa `config/hotkey.txt` do MagicaVoxel 0.99.7.2, que listam cada controle com o comando de console que ele dispara (ex.: `rot90 x`, `opack xform`). Os nomes entre crases abaixo são esses comandos. Comportamentos ambíguos são confirmados no binário (ver [`magicavoxel-re.md`](magicavoxel-re.md)).

Depois da v1 o editor diverge livremente; até lá, atalhos e semântica seguem o MagicaVoxel. Extras que não conflitam (onion skin, autosave) ficam.

## v0.5 (feito)

- [x] `.vox` v200 com chaves de animação, round-trip de chunks desconhecidos
- [x] Adicionar/apagar/pintar, pincel voxel e caixa, conta-gotas (`Alt`)
- [x] Keys de transformação e frames de modelo, timeline, playback, loop, intervalo
- [x] Objetos: novo, apagar, duplicar, renomear, ocultar, girar 90°, espelhar, redimensionar
- [x] Undo/redo, autosave, sprite sheet PNG

## v0.6: modos e mapa de atalhos (feito)

- [x] Modo Modelo e modo Mundo (`olevel -2`, `Tab` com o viewport focado, duplo clique)
- [x] F5/F6 e `Ctrl+,`/`Ctrl+.` agem no frame de modelo (modo Modelo) ou na key de transformação (modo Mundo), como `***REMOVED***`
- [x] Mapa de atalhos do `hotkey.txt` (global, model-editor, world-editor, camera-control)
- [x] Mundo: clicar seleciona, arrastar move no plano, `G` assenta no chão (`omove g`), `+`/`-` e `9`/`0` giram (`orot`), `Ctrl+H` oculta
- [x] Modelo: objetos de fundo esmaecidos (`Ctrl+B`), grade (`Ctrl+G`), moldura (`Ctrl+F`), arestas (`Ctrl+E`)
- [x] Espelho X/Y/Z do pincel (`1` `2` `3`); `full` (`U`), `fill` (`I`), `zero` (`Delete`)
- [x] Câmera: recentralizar (`5`), vista de face (`Ctrl+5`), perspectiva/livre/ortogonal/isométrica, `Espaço`/`Z`/`K` + arrastar, slots `7`/`8`/numpad, captura `6`
- [x] Zoom da roda como no MagicaVoxel (no foco) ou, como opção, no voxel sob o cursor
- [x] Layout do MagicaVoxel: paleta e pincel à esquerda, objetos e edição à direita

Pendências da v0.6:

- [x] Slots de câmera lidos e gravados em `rCAM` (matriz base `M0` confirmada, ver [RE §4.4](magicavoxel-re.md))
- [x] Câmera livre girando em torno do olho; `X` + clique centraliza a órbita num voxel
- [x] Sombra (`Ctrl+W`), contornos dos objetos (`Ctrl+M`), AO, sombreamento constante, esmaecer o fundo, cores de fundo/grade/aresta/seleção e grade do chão do modelo (`rm_space`), com os padrões do MagicaVoxel
- [x] Painel da câmera (`cam.ui`): centro, distância, pitch, yaw, FOV, velocidade da câmera livre e sensibilidade do mouse
- [x] Cubo de vista (`ui/scene.cube`, clique numa face) e régua da câmera (`ui/scene.ruler`, arrastar gira; aparência inferida)
- [x] Rolagem da câmera (`cam rz`, `_angle` z no `rCAM`)
- [x] Desfazer/refazer do gizmo (`undo_brush`): cada arrasto da sessão já é um passo do `Ctrl+Z`
- [ ] `Ctrl+N`, `Ctrl+T` e `Ctrl+W` são reservados pelo navegador: só chegam ao editor numa janela própria (PWA ou app desktop)

## v0.7: pincéis (feito)

- [x] Voxel com tamanho 1–64 (`-`/`+`), cubo/esfera, 2D/3D (`b_vox_*`); adicionar arrastando desenha no plano onde começou, sem buracos
- [x] Face (`F`): extrusão e escavação por arrasto, pintura da região, cor da paleta ou do voxel, conexão por geometria ou cor, 4/8 vizinhos (`b_face_*`)
- [x] Geometria (`L`): linha, quadrado, círculo, projetar linha na superfície, preencher centro, tamanho par (`b_geo`, `b_line_proj`, `b_center_*`)
- [x] Caixa com preview ao vivo
- [x] Modo eixo X/Y/Z (`Ctrl+1/2/3`): o traço atravessa o modelo (semântica inferida, ver o comentário em `brush-shapes.ts`)
- [x] Remover e substituir região, conta-gotas (`b_type` `remove`, `replace`, `pick`): mesma cor ou conectada, por geometria ou cor, 6/26 vizinhos

Pendências da v0.7:

- [x] Redimensionar o pincel com `Ctrl+Alt+arrastar`
- [x] Contorno da região de face no hover
- [x] Modos `code` (`C`, o shader XS roda na caixa arrastada) e `pattern` (`P`)

## v0.8: seleção e operações de modelo

- [x] Seleção retangular (atravessa o modelo), por pincel e por caixa; somar (`Shift`) e subtrair (`Shift+Alt`); `sel_all`/`sel_none`/`sel_inv`, `sel_col`
- [x] Seleção por região (`b_type asel`, `N`), reaproveitando a busca de região da v0.7
- [x] Operações de modelo agem só na caixa da seleção, e a seleção acompanha o resultado
- [x] Copiar/recortar/colar voxels (`Ctrl+C`/`X`/`V`); mover/loop arrastando (`Ctrl` trava um eixo)
- [x] Gizmo de escalar, wrap e girar com `Enter`/`Esc`
- [x] `full`, `fill`, `zero`, `rev`, `x2`, `xh`, `rot90`, `flip`, `loop`, `mir`, `dia`
- [x] Mover/escalar/cisalhar/girar/repetir com argumentos
- [x] `prim elli|cyli|pyra|cone`, `maze`, `noise`; `fractal`, `mask` e `tex` com o padrão atual
- [x] `flood 0` (remover invisíveis), `flood` (preencher vazios internos), dilatação, erosão
- [x] `shrink` (ajustar ao conteúdo de todos os frames)
- [x] Redimensionar arrastando a moldura (`Shift`: dos dois lados)

## v0.9: editor de mundo

- [x] Multisseleção (`Shift`), seleção por retângulo (`M`), `osel_all`/`osel_inv`/`osel_none`; mover, girar, espelhar, apoiar, ocultar, apagar e duplicar a seleção inteira (`Ctrl` move na vertical, `Ctrl+Shift` duplica arrastando)
- [x] Grupos: agrupar/desagrupar (`Ctrl+R`), entrar/sair (`TAB`), contorno da cena com expandir/recolher, ordenar
- [x] Referências: copiar como referência (`Ctrl+Shift+C`), recortar como referência, `oref2obj` (`Ctrl+T`)
- [x] Copiar/colar objetos e transformações (`m_copy`, `m_paste`), copiar no frame atual, posição (`opos`) e `omove` por texto
- [x] Booleanas: união, interseção, operandos (`ooper`), subtração, substituição
- [x] Alinhar (mín/centro/máx), espelhar objetos
- [x] Ordem de render (`order`)
- [x] `osel_all 1`/`osel_inv 1` (`Ctrl+Shift+A`/`I`) incluem os nós ocultos; sem o argumento, só os visíveis
- [x] Camadas: 8 camadas com nome, cor, visibilidade, selecionar objetos da camada, mover a seleção para a camada, ordenar por nome
- [x] Wrap no mundo (`N`, `b_obj_wrap_space`), cópias como referência; ferramenta padrão (`P`) coloca o padrão no chão

## v0.10: paleta e materiais

- [x] Seletor HSV/RGB, hex, somar a canais da seleção (`pal_add`), copiar/colar cor e região da paleta, gradiente (`Ctrl+Alt`), trocar (`Ctrl`, os voxels acompanham), cor da tela (`Alt`)
- [x] Ordenar, marcar, mascarar cores não usadas, cores aleatórias; paleta nova (`pal fill 75`) e rampa de cinza (`pal bw`)
- [x] Nota da paleta (`NOTE`), uma por linha de 8 cores
- [x] Importar/exportar paleta `.png`/`.act` (também soltando o arquivo); paleta padrão do MagicaVoxel
- [x] Materiais `MATL`: difuso, emissivo, mistura, metal, vidro, nuvem, meio; copiar/colar/resetar (na cor atual ou na seleção da paleta). O efeito visual chega com o path tracer da v0.14

## v0.11: animação

- [x] Multisseleção de keys na timeline (clique, `Shift`), mover e duplicar arrastando (`Ctrl`), apagar (`F6`/`Delete`), `arev`, `asel all|inv|none` no menu do botão direito
- [x] Tempo global (`aset global`); a velocidade (`a_speed`) é o FPS da timeline
- [x] Frames não gravados (opção "Auto key" desligada): editar fora de uma key fica pendente até `F5`; trocar de frame descarta com aviso (desfazível)
- [x] Empacotar modelos em animação e desempacotar (`opack`, `ounpack`), importar sprites `.png` (em pé, 1 voxel de profundidade; `Shift` monta a animação)

## v0.12: importar e exportar

- [x] Exportar `obj` (+ `mtl` e paleta PNG, faces unidas), `ply`, `mc` (malha suavizada por surface nets), `cube`, `pcl`, `qb`, `xraw`, `slab`, `iso`, `2d`, `slice`; só selecionados; espaço local; escala e eixo
- [x] Importar `.qb`, `.xraw`, `.png` (sprites), Slab6 `.vox`
- [x] Lista de projetos no navegador (IndexedDB): abrir, salvar como, duplicar, apagar; recuperar pelo autosave
- [x] Exportar `vox` (só os objetos); componentes do arquivo (`i_comp`/`o_comp`/`save_*`): paleta, materiais, render, câmeras e notas, importados de outro `.vox`, exportados sozinhos ou deixados de fora ao salvar

## v0.13: shaders XS e padrões

- [x] Executar shaders XS na GPU (WebGL2) com a API do MagicaVoxel (`map()`, `voxel()`, `palette()`, `color_sel()`, `i_args`, `i_iter`, ...), argumentos lidos do cabeçalho, iterações, comando `xs [-n iter] nome args`; os 7 shaders de exemplo do MagicaVoxel rodam sem mudança
- [x] Padrões: criar da seleção de voxels ou de objetos, pincel de padrão (`P`, girar com `-`/`+`/`9`/`0`, cores do padrão ou da paleta), colocar no mundo, biblioteca no navegador com cores casadas à paleta atual

## v1.0: renderizador

- [ ] Path tracer WebGL2 progressivo com materiais, sol, céu uniforme/atmosférico/IBL `.hdr`, névoa
- [ ] Câmera: FOV, projeções, profundidade de campo, exposição, vinheta, ACES, bloom
- [ ] Display: chão, grade, arestas, fundo transparente, escala do voxel, primitivas (cubo, lego, MC, argila, esfera, cilindro)
- [ ] Imagem final, turntable e animação; amostragem (`pt_bounce_*`, `pt_spp`, ...)
