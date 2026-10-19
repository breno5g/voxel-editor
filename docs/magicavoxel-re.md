# MagicaVoxel 0.99.7.2: engenharia reversa para reimplementação

- **Alvo:** `MagicaVoxel-0.99.7.2-win64/MagicaVoxel.exe` (PE32+ x86-64, 4.114.432 bytes)
- **SHA-256:** `7657e4c00de35f5272eec5b8d513b36b4e0767bb941668aa37677f3f9a3d4162`
- **Implementação de referência:** [`tools/vox_anim.py`](../tools/vox_anim.py) (parser + avaliador de animação, com self-check)
- **Escopo:** formato e comportamento observáveis, para interoperabilidade. Nenhum código do MagicaVoxel foi copiado para este projeto.

Cada afirmação traz a origem da evidência:

| Tag | Origem |
|---|---|
| **[bin]** | análise estática do binário |
| **[str]** | string ou constante embutida no binário |
| **[cfg]** | arquivos `config/*.txt` e `config/ui/*.ui` distribuídos com o programa |
| **[vox]** | inspeção dos `.vox` de exemplo em `vox/` |
| **[spec]** | spec pública do formato (github.com/ephtracy/voxel-model) |
| **[inferido]** | dedução não confirmada por execução |

---

## 1. Conclusão

O binário é pequeno e acessível: C++/MSVC com RTTI completo (292 classes nomeadas), Win32 + OpenGL legado e nenhuma dependência além do sistema. Três partes estão totalmente mapeadas e podem ser reimplementadas sem adivinhação:

1. **Formato `.vox` v200**, incluindo as extensões de animação que a spec pública não documenta (§4).
2. **Avaliação de animação**: algoritmo exato de keyframe, interpolação e arredondamento (§5), portado e testado em `tools/vox_anim.py`.
3. **Superfície de comandos**: a UI inteira é declarativa (`config/ui/*.ui`) e dispara ~90 comandos de console. Reimplementar os comandos é reimplementar o editor (§6, §9).

A parte cara e opaca é o **path tracer**: o corpo GLSL não está em texto no binário (§8). Ele é separável do editor. Para animação, recomendo não reimplementá-lo e exportar para um renderer existente.

**Escopo mínimo sugerido para animar no Linux:** ler/escrever `.vox` com round-trip das chaves de animação → viewport rasterizado (cubos por voxel, paleta 1D) → timeline com `aadd`/`adel`/`astep`/play → edição básica de voxels (attach/erase/paint) → export de frames (PNG) ou malha por frame.

---

## 2. O binário

| Aspecto | Achado | Evidência |
|---|---|---|
| Toolchain | MSVC x64, C++ com RTTI e `std::shared_ptr` em todo lugar | [str] `.?AV...@@`, `_Ref_count_obj2<MV_ShapeModel>` |
| Janela/entrada | Win32 puro: `CreateWindowExW`, `PeekMessageW`, `TrackMouseEvent`, clipboard, drag-and-drop (`DragQueryFileW`) | imports USER32/SHELL32 |
| Diálogos de arquivo | `GetOpenFileNameW`/`GetSaveFileNameW` | imports COMDLG32 |
| Gráficos | OpenGL legado (`glBegin`, `glVertexPointer`, matrizes fixas) + GLSL 1.2 (`ftransform`, `gl_FragColor`, `texture3D`). Funções modernas (shaders, FBO, texturas 3D) via `wglGetProcAddress` | imports OPENGL32, [str] shaders |
| Paralelismo | OpenMP (`VCOMP140.DLL`: `_vcomp_fork`, `_vcomp_for_static_*`) | imports |
| Timer | `timeBeginPeriod` (WINMM) | imports |
| Denoiser | Intel Open Image Denoise carregado dinamicamente (`LoadLibraryW`) | [str] `intel_oidn`, `denoise`; créditos do `readme.txt` |
| Recursos PE | apenas ícones e manifest. Fontes, UI, paletas e shaders XS ficam em arquivos ao lado do `.exe` | `llvm-readobj --coff-resources` |

**Equivalentes no Linux:** GLFW ou SDL3 (janela/entrada), OpenGL 3.3 core ou WebGL2, um diálogo nativo (portal do xdg ou `tinyfiledialogs`) e threads no lugar do OpenMP.

---

## 3. Arquitetura (nomes do RTTI)

| Camada | Classes | Papel |
|---|---|---|
| App/estado | `MV_App`, `MV_Env`, `OS_Window`, `RenderContextGL` | loop principal; `MV_Env` guarda a cena, o frame atual e a pilha de níveis do grafo |
| Grafo de cena | `MV_Node` → `MV_XformNode` (nTRN), `MV_ContentNode` → `MV_ShapeNode` (nSHP), `MV_GroupNode` (nGRP); modelo `MV_ShapeModel` | mesma topologia do arquivo `.vox` |
| Comandos (undo/redo) | ~150 `MV_CMD_*` (ex.: `MV_CMD_AddXformFrame`, `MV_CMD_StepFrame`, `MV_CMD_PackSelection`) | padrão Command; cada ação do usuário vira um objeto com execute/undo |
| Ferramentas | `MV_*Brush` (Voxel, Face, Box, Line, Center, Pattern, XS, Transform, ObjectMove, ...) | interação no viewport |
| I/O | `MV_Plugin_{VOX,QB,OBJ,PLY,MC,Cube,Iso,2D,Slice,SLAB,RAW,PCL,PNG,JPEG,HDR,ACT,Mesh}` | importação/exportação |
| Render "automata" | `MV_RA_{Anim,AnimAutoPlay,Photo,Preview,Spin,HUD}` | modos de render progressivo e playback |
| Observers | `MV_Observer_{Node,Model,Palette,Pattern,Pt,Cmd,Camera,Key}Event` | notificação UI ↔ modelo |
| UI toolkit | `UI_*` (Box, Button, Slider, TextField, Anim, SceneGraph, Palette, ...) | widgets desenhados em GL e montados a partir de `config/ui/*.ui` + `editor.sty` |

---

## 4. Formato `.vox` (versão 200)

### 4.1 Chunks

Base [spec]: `"VOX "` + `int32 version` (200) + chunk `MAIN` cujos filhos são:

| Chunk | Conteúdo | Observação |
|---|---|---|
| `SIZE` + `XYZI` | um par por modelo: dimensões (`int32 x,y,z`) e lista de voxels (`uint8 x,y,z,colorIndex`) | modelos até 256³ [str] `volume size [1-256]` |
| `PACK` | contagem de modelos (legado) | lido pelo reader [bin] |
| `nTRN` / `nGRP` / `nSHP` | grafo de cena; nós referenciados por id | §4.2 |
| `LAYR` | camadas (`_name`, `_hidden`, `_color`) | exemplos trazem 16 ou 32 [vox] |
| `RGBA` | paleta de 256 cores | índice 0 = vazio |
| `IMAP` | remapeamento de índices da paleta | presente em `room.vox` [vox] |
| `MATL` | material por índice (`_type`, `_rough`, `_ior`, `_ri`, `_d`, `_g`, `_metal`, `_emit`, `_flux`, ...) | [vox] |
| `rOBJ` | configurações de render, uma por `_type`: `_bounce`, `_env`, `_inf`, `_uni`, `_ibl`, `_atm`, `_fog_uni`, `_lens`, `_film`, `_bloom`, `_ground`, `_bg`, `_edge`, `_grid`, `_setting` | [vox] |
| `rCAM` | 10 slots de câmera (`_mode`, `_focus`, `_angle`, `_radius`, `_frustum`, `_fov`) | [vox] |
| `NOTE` | nomes das linhas da paleta | [vox] |
| **`META`** | **`_anim_range` = `"min max"`** | **não está na spec pública** [vox] [bin] |

Strings e dicionários: `int32 len` + bytes; `DICT` = `int32 n` + n pares de strings.

### 4.2 Nós e extensões de animação

Layout binário [spec, confirmado no reader]:

```
nTRN: int32 id, DICT attrs, int32 child, int32 reserved(-1), int32 layer, int32 numFrames, DICT frame[numFrames]
nGRP: int32 id, DICT attrs, int32 numChildren, int32 child[numChildren]
nSHP: int32 id, DICT attrs, int32 numModels, { int32 modelId, DICT modelAttrs }[numModels]
```

Chaves (as marcadas com ★ não aparecem na spec pública):

| Onde | Chave | Valor | Semântica | Evidência |
|---|---|---|---|---|
| frame de `nTRN` | `_f` ★ | int | frame da chave. Ausente ⇒ `-1` (só ocorre em nós de chave única) | [bin] [vox] |
| frame de `nTRN` | `_t` | `"x y z"` int | translação (escrita só quando ≠ 0,0,0) | [bin] |
| frame de `nTRN` | `_r` | byte | rotação compactada (§4.3); omitida quando identidade (4) | [bin] |
| attrs de `nTRN` | `_name`, `_hidden` | | | [spec] |
| attrs de `nTRN` | `_loop` ★ | `"1"` | loop da transformação. **Escrito pelo writer, mas o reader não o lê** (só existem 3 referências à string: 2 no writer e 1 no `nSHP` do reader). Na 0.99.7.2 o loop de transform não sobrevive a salvar e reabrir | [bin] referências à string; confirmar empiricamente |
| attrs de `nTRN` | `_frm_t` ★, `_frm_r` ★ | como `_t`/`_r` | estado editado fora de uma chave ("unrecorded"), restaurado ao abrir | [bin] |
| modelo de `nSHP` | `_f` ★ | int | frame em que esse modelo entra | [vox] [bin] |
| attrs de `nSHP` | `_loop` ★ | `"1"` | loop da troca de modelos | [bin] [vox] |
| attrs de `nSHP` | `_frm_id` ★ | int | id do modelo exibido fora de chave ("unrecorded") | [bin] |
| `META` | `_anim_range` ★ | `"min max"` | intervalo da timeline (`a_min`/`a_max`) | [vox] |

As chaves de um nó são mantidas **ordenadas por `_f`**, porque o avaliador faz busca binária.

Exemplo real, `vox/anim/T-Rex-m.vox`: o `nTRN` 2 tem chaves `f=0 t=(0,0,13)`, `f=11 t=(44,0,13)` e `f=19 t=(148,0,13) r=17`, além de `_frm_t="122 0 13"`. O `nSHP` 3 tem 8 modelos com `_f` 0..7 e `_loop=1`.

### 4.3 Rotação compactada (1 byte)

```
i0 = r & 3          // coluna do 1 na linha 0
i1 = (r >> 2) & 3   // coluna do 1 na linha 1
i2 = 3 - i0 - i1    // coluna do 1 na linha 2
sinal das linhas 0,1,2 = bits 0x10, 0x20, 0x40 (1 = negativo)
```

Identidade = `4`. O reader aplica `r & 0x7f` e, se `i0 > 2 || i1 > 2 || i0 == i1`, troca por 4 [bin].

### 4.4 Câmeras (`rCAM`)

Campos gravados [bin]:

| Chave | Campo | Formato |
|---|---|---|
| `_mode` | índice em `pers`, `free`, `orth`, `iso`, `none` (mesma ordem de `cam_mode`) | nome |
| `_focus` | ponto focado | `%g %g %g` |
| `_angle` | `(ax, ay, az)` em graus | `%g %g %g` |
| `_radius` | distância do olho ao foco | `%g` |
| `_frustum` | `tan(fov / 2)` em perspectiva; meia altura visível em `orth`/`iso` (arquivos reais: `iso` com `_radius` 2778,8 e `_frustum` 75,56) | `%g` |
| `_fov` | campo de visão em graus | `%g` |

- Orientação: `R = M0 · Ry(ay) · Rx(ax) · Rz(az)` e `olho = foco + radius · R·ẑ`, então `az` é rolagem em torno do eixo de visão e `ax`/`ay` orbitam. Com ângulo múltiplo de 90°, seno e cosseno são arredondados para inteiros.
- `iso` força `ax` a ±35,264° (`atan(1/√2)`), ou 0 se `ax` for 0; o yaw continua livre.
- `M0` vem do construtor do `UI_3DView`: as linhas `(1, 0, 0)`, `(0, 0, -1)`, `(0, 1, 0)`. Com ângulos zero o olho fica em `-y` olhando para `+y` (vista de frente) com `+z` para cima; `olho - foco = radius · (cos ax · sin ay, -cos ax · cos ay, -sin ax)`, então `ax` negativo põe o olho acima do foco, como os slots `iso` (`ax = -35,26`) mostram [bin] [vox]. Slots vazios têm `_radius` 0.
- Zoom da roda [bin]: `q = 10 × 0,01 × Δroda` (`10 × 1` na câmera livre). A posição do cursor não entra: em `pers` o foco fica parado e `radius' = max((radius + 1)·e^(−q) − 1, 0,001)` (`logf`/`expf`), então o zoom chega ao foco em poucos passos; em `orth`/`iso` o tamanho da vista vira `max(tamanho·(1 − q), 0,001)`; na `free` foco e olho andam `q` juntos ao longo da vista. A escala de `Δroda` por clique não foi confirmada (o editor usa 1 por clique).

### 4.5 Limites

| Limite | Valor | Evidência |
|---|---|---|
| frame | `[0, 360]` (clamp duro da cena) | [bin] |
| frame atual | clamp em `[a_min, a_max]` | [bin] |
| dimensão de modelo | 1..256 por eixo | [str] |
| paleta | 256 entradas, índice 0 = vazio | [spec] |

---

## 5. Avaliação da animação (algoritmo exato)

Fonte: o avaliador por frame da cena. Port fiel e testado: `eval_xform` / `eval_shape` em `tools/vox_anim.py`.

```
frame = clamp(frame, 0, 360)
para cada nó a partir da raiz (ou do grupo aberto, se "Global Time" estiver desligado [inferido]):

  nTRN com chaves K (ordenadas por f):
    t = frame
    se loop: t = K[0].f + mod_positivo(t - K[0].f, K[-1].f - K[0].f + 1)
    i = última chave com K[i].f <= t   (ou 0 se t < K[0].f)
    a = K[i]
    se existe K[i+1]: b = K[i+1]; s = clamp((t - a.f) / (b.f - a.f), 0, 1)   (s < 0 ⇒ 0)
    senão:            b = a;      s = 0
    translação = floor(a.t + (b.t - a.t) * s + 0.5)   // float32, arredonda metade pra cima
    rotação    = a.r                                   // degrau: NÃO interpola

  nSHP com chaves M:
    mesmo wrap de loop
    modelo = M[última chave com f <= t].model          // degrau
```

Detalhes confirmados no binário:

- O arredondamento é `floorf(x + 0.5f)`, em float32.
- A translação interpolada é inteira, então o objeto anda de voxel em voxel.
- A rotação só muda quando o tempo chega na chave seguinte.
- Antes da primeira chave vale a primeira; depois da última vale a última.
- No loop, o período é `último.f − primeiro.f + 1`, sem interpolação entre a última e a primeira chave.

---

## 6. Timeline e comandos de animação

| Comando | Atalho [cfg] | Comportamento | Evidência |
|---|---|---|---|
| `astep time ±n` | `,` `.` | `novo = atual + n`; se `atual ∈ [min,max]`, faz wrap modular dentro do intervalo | [bin] |
| `astep key ±1` | Ctrl+`,` `.` | busca binária da chave anterior/seguinte no nó selecionado (nTRN: 24 B/chave; nSHP: 32 B/chave) | [bin] |
| `astep key ±2` | Ctrl+Shift+`,` `.` | primeira/última chave | [bin] |
| `astep set N` | | vai para o frame N | [bin] |
| `aadd` | F5 | adiciona/substitui a chave no frame atual | [cfg] hint |
| `adel` | F6 | remove a chave | [cfg] |
| `arev` | | inverte as chaves selecionadas (`MV_CMD_Reverse{Xform,Shape}Frames`) | [cfg] [str] |
| `asel all\|inv\|none` | | seleção de chaves na timeline | [cfg] |
| `aset loop` / `aset global` | | toggles `a_loop` e "Global Time" | [cfg] [str] |
| `opack xform` / `opack loop` | | "Pack Models to Animation": vários modelos viram as chaves de um `nSHP` (`MV_CMD_PackSelection`) | [cfg] |
| `ounpack` | | inverso | [cfg] |
| `task play` | | playback; velocidade `a_speed` ∈ [0, 31] | [cfg] |
| `i "<drop>" \| opack loop` | | "Import Sprites": importa imagens e empacota em animação | [cfg] |

Mudar de frame com edição não gravada abre o diálogo *"Has unrecorded frames. Discard them?"* [bin]. É esse estado que vai para `_frm_t`/`_frm_r`/`_frm_id`.

Render de animação: painel "Anim" do renderer com `pt_anim_f0`/`pt_anim_f1` e `task anim`; turntable com `pt_spin_frames` [cfg `r_image.ui`].

---

## 7. Edição de voxels na GPU e shaders XS

Toda operação de volume é um *fragment shader* que computa `float map(vec3 v)` (novo índice de cor no voxel `v`) [str]:

- Volumes ficam em texturas: os volumes 3D são empacotados em texturas 2D ("image buffer"), com funções de conversão `convert_loc_from_voxel_to_buffer` / `convert_loc_from_buffer_to_voxel` (`mod_f`/`mod_uvs`), além de `sampler3D tex_a/tex_s/tex_t` para camadas de seleção.
- Cada operação (flip, rot90, loop, scale2x, half, shear, mirror, repeat, dilation/erosion, prim `elli/cyli/cone/pyra`, plane fill, ...) é um `map()` diferente. Os corpos estão em texto claro no binário.
- Os **shaders XS** (`shader/*.txt`) usam o mesmo mecanismo. O preâmbulo injetado define a API:

```glsl
uniform vec3  i_volume_size;   uniform float i_color_index;
uniform int   i_num_color_sels; uniform float i_color_sels[256];
uniform vec3  i_mirror, i_axis; uniform float i_args[16];
uniform float i_frame, i_num_frames; uniform vec4 i_rand; uniform float i_iter;
float voxel(vec3 v); float color_sel(float k); vec4 palette(float index);
// aliases: iVolumeSize, iColorIndex, iMirror, iAxis, iArgs, iFrame, iNumFrames, iRand, iIter
```

Argumentos de UI vêm do cabeçalho do arquivo: `// arg : { var = 'm_radius' name = 'Radius' value = '3' range = '1 128' step = '1' precision = '0' }`.

**Pincel:** o passe que aplica o traço também é um `map()` [str]. `bm` escolhe a ação: 1 só preenche vazios (attach), 2 apaga onde o pincel tem voxel (erase), 3 recolore onde ambos têm voxel (paint), 4 interseção. `brush` escolhe a fonte: 2 é um volume de pincel (`tex_t`), 3 é um padrão projetado (`project_map(tex_p)`). As demais operações de modelo (`rot90` com `degree`, `dia`, repetição com espelho, dilatação com 6/18/26 `offsets`, primitivas e seleção por planos do frustum) também estão em texto claro e servem de especificação para a v0.8.

**Operações de modelo** (`src/editor/model-ops.ts` as reimplementa na CPU com a mesma amostragem célula a célula). Cada comando é uma classe `MV_CMD_*` que interpreta os próprios argumentos:

| Comando | Semântica |
|---|---|
| `rev` | vazio vira a cor atual, cheio vira vazio |
| `x2` / `xh` | dobra cada voxel em 2×2×2 / reduz pegando o primeiro voxel cheio de cada bloco 2×2×2, na ordem x, y, z |
| `flip`, `loop`, `mir`, `dia` | espelho do volume; deslocamento com volta; metade de baixo espelhada na de cima; transposição dos dois eixos cruzados onde o primeiro é menor |
| `rot90 a` | destino `(s, t)` lê a origem `(t, tamanho_s − 1 − s)`, com `(s, t)` = `a.zxy`, `a.yzx` |
| `scale`, `shear`, `rot`, `repeat` | vizinho mais próximo; cisalhamento proporcional à camada; rotação livre; ladrilho |
| `dil` / `ero` | 26 vizinhos por padrão; argumentos `x`, `+y`, `-z` limitam eixos e sentidos; a erosão trata fora do volume como vazio |
| `prim elli\|cyli\|pyra\|cone` | a forma inscrita no volume, na cor atual |
| `flood` / `flood 0` | preenche o espaço fechado / remove os voxels sem face para o espaço externo |
| `noise semente freq min max` | Perlin melhorado (permutação de referência do Ken Perlin, tabela de 16 gradientes), preenche onde `sin(π·ruído((célula + semente)·freq))` está em (min, max); padrões 0,04, 0,2 e 0,5, semente `-1` aleatória |
| `maze largura` | árvore crescente 3D com nós a cada `largura + 2` voxels: continua do nó mais novo ou de um aleatório, prefere −x/−y/−z em 4 de 5 passos e pinta corredores de 1 voxel |

`fractal`, `mask` e `tex` dependem da biblioteca de padrões (v0.13).

**Para uma reimplementação:** expor essa mesma API faz os shaders XS existentes (inclusive os da comunidade) rodarem sem mudança. Note que `i_frame`/`i_num_frames` permitem gerar um volume por frame.

---

## 8. Renderização

**Viewport (texto claro)** [str]: paleta como `sampler1D` indexada por `(index + 0.5) / 256`, grade por face via `fwidth`, sombreamento difuso `g_light` + `g_ambient`. O picking usa um passe que escreve `info = vec4(pos, face)`, com a face codificada como `1 + dot(max(n,0),(1,3,5)) + dot(max(-n,0),(0,2,4))` (ids 1..6), e a profundidade em canal separado. Texto é renderizado por SDF (`u_sdf`).

**Path tracer (opaco):** o corpo GLSL não existe em texto. Em claro estão apenas:

- as flags de compilação: `PRIM_{CUBE,SPHR,CYLI,LEGO,CLAY,MC}`, `OPT_{ORTH,PERS,PANO,CYLI,GROUND,SG,PX,SHADOW,TR,MIS_GGX,MIS_MEDIA,SUN,SUN_DISK,ATMO,IBL,AREA,DOF,BLADE,SPIN,EMIT,METAL,DIELECTRIC,ALPHA,SCATTER,SSS,MARCH,FOG,LE,BG,HOR,GRID,SCALE,SPARSE}`;
- nomes de uniforms (`surf_mask_ggx`, `sample_rand`, `pt_ray_d`, ...).

`.rdata` contém ~228 KB de blocos de alta entropia, sem streams zlib. São o candidato a shader codificado e/ou tabelas de ruído. **Não decodificado.** A lista de features acima serve de especificação, e os parâmetros vêm de `rOBJ`/`MATL` (§4.1).

**Reimplementação (`src/render/path-tracer/`):** como o corpo não foi decodificado, o path tracer do editor segue a lista de features e os painéis `config/ui/r_*.ui`, com parâmetros do `rOBJ` (`src/format/render-settings.ts`). O que é observado e o que é inferido:

- **Observado:** faixas e padrões de cada controle (`r_light.ui`, `r_cam.ui`, `r_display.ui`, `r_sample.ui`, `r_image.ui`); `pt_fov` é separado de `cam_fov`; `pt_prim` (`cube lego mc clay sphr cyli`), `pt_bloom`, `pt_b_sw`, `pt_tr` e `pt_b_aa` não são gravados no arquivo (não há chave `_prim` no binário), `_cell` é; atalhos do mapa `renderer` do `hotkey.txt`.
- **Observado no setup de uniforms** [bin]:
  - sol: direção `(cos p·sin y, −cos p·cos y, sin p)` para `_angle "p y"`; `sun_I = (cor/255)^γ · _i · 5`, dobrado com a atmosfera; `cos θ_max = cos(_area · 20°)`;
  - gama: paleta, sol, céu uniforme e fundo (`Lb`) passam por `(c/255)^γ` com o gama do filme (a tela aplica `1/γ`);
  - céu, IBL, atmosfera, névoa e horizonte: céu uniforme `(cor)^γ·_i`, zerado fora desse modo; `ibl_I = 4π·_i / ∫lum dω` (o mapa é normalizado), `ibl_rot = yaw/360`, `ibl_total` para amostragem por CDF; `k_ray = cor·(10^(1,5·d) − 1)·0,05`, `k_mie = cor·(10^(1,5·d) − 1)/300`, ozônio `·0,05`, `k_ext = k_ray + 1,1·k_mie + k_o3`, `g_mie`, planeta de raio 10000; névoa `air_Ks = cor/255` (sem gama), `air_et = _d·0,001`, `air_eg = _g`; `hor_et = _hor·0,0005`;
  - lente: `dof_lens = (_aperture·0,03, foco, lâminas, −rotação em rad)`, e o DOF só liga com foco ≠ 0 e abertura > 0;
  - materiais: um `_emit` brilha `1 + 3·_emit·10^_flux` vezes a sua cor (`1 + 3·_ldr` numa segunda componente quando `_ldr > 0`); a potência dos emissores vai para uma CDF para amostrar faces emissivas como luz de área (`area_p/n/r/L/pdf`);
  - luz de área: a cada passada, um sorteio na CDF escolhe o grupo (índice da paleta, direção da face), outro uma face do grupo; o shader recebe o canto `area_p`, a normal `area_n`, um ponto `area_r` na face, a radiância `area_L = cor·E` e a densidade por área `area_pdf = max(area_L)/potência total`. O editor usa a mesma lista e a mesma CDF (`emitter-faces.ts`, enviadas como texturas), mas cada pixel sorteia a sua face e o seu ponto na GPU: uma face só para a imagem toda fazia a luz piscar a cada quadro enquanto a vista se refaz. A NEE é pesada por MIS contra os raios difusos que acertam o emissor;
  - tela: `expo` cru, `vig = _vig²·5`, `aces = 0,6` (a pré-escala da curva de Narkowicz) ou −1, `bloom = _mix·0,7`;
  - amostragem: `max_num_diffuse/specular/scatter` (especular e espalhamento limitados a 5 na prévia), `clamp_L`, `jitter_mult = (1, 937, 691, 719)` com `pt_jit` ligado (multiplicadores do sorteio por pixel) e zero desligado; `pt_mis_ggx` e `pt_mis_cloud` são flags.
- **Inferido (marcado `ponytail:` no código):** a convenção sem π (a NEE difusa é `albedo·sun_I·cos`, com o sol de radiância `sun_I·π/Ω` no disco); a abertura relativa à distância de foco; a profundidade da atmosfera, porque o modelo do planeta e o perfil do ar estão no shader codificado (o editor usa espalhamento simples num céu uniforme, com os coeficientes do MagicaVoxel e 5 massas de ar por unidade, o que mantém o céu padrão); a forma da vinheta; `_bloom _aspect` achatando o brilho na vertical; emissão sem o piso de 1 para mistura e meios; o `_ldr` como o brilho visto (direto ou por reflexos especulares) enquanto `E` é o que ilumina.
- **Desenho:** a cena vira uma grade de índices de paleta no espaço do mundo (textura `R8UI` 3D, com 2 células de margem) e uma grade de bricks 8³ ocupados; o raio anda num DDA de dois níveis com as células sempre em inteiros (recalcular a célula da posição em ponto flutuante perdia a fronteira longe da câmera). As formas suaves (`mc`, `clay`) marcham um campo de densidade com filtro trilinear (ocupação pura, ou borrada com `[1 2 1]` duas vezes) em bricks dilatados.

---

## 9. Superfície de comandos

Nomes de comando de console extraídos do binário [str] (a UI chama todos via `onClick`):

```
open recover saveas new dup save i o i_pal o_pal i_comp o_comp i_patt s_patt i_model
shrink zero full flip shear rot90 loop size del_col sel_col flood prim noise maze fractal rand
xs xs_load sel_none sel_all sel_inv
onew onewpatt odel osel_all osel_none osel_inv osel_layer ocopy ocut opaste oref2obj ooper
opos omove orot oflip oalign ounion ointer osub orep ogroup oungroup opack ounpack olevel
order oname ohide oexpand m_copy m_paste
pal_sel pal_set pal_add pal_mul mtl_reset mtl_copy mtl_paste
lay_sel lay_vis lay_name lay_col lay_sort
aset asel astep aadd adel arev
set cmd cam snap task info reset
```

- **Exportação** (`o <fmt>`): `vox`, `obj`, `ply`, `mc`, `cube`, `iso`, `2d`, `slice`, `slab`, `qb`, `xraw`, `pcl`.
- **Importação:** `.vox` (MagicaVoxel/Slab6), `.qb`, `.xraw`, `.png` (sprites), `.obj`.
- **Paleta:** `.png`/`.act`. **IBL:** `.hdr`.

Configurações de I/O ficam em `config/config.txt` (escala, eixo `XZ-Y`, merge de faces do OBJ, ...). Atalhos em `config/hotkey.txt`. Variáveis de estado (`set <var>`) usam os prefixos `rm_*` (viewport), `pt_*` (path tracer), `b_*` (brush) e `a_*` (animação).

---

### 9.1 Editor de mundo e materiais

- **Mundo (`config/ui/o_edit.ui`, `hotkey.txt`):** `ogroup` `Ctrl+R`, `oungroup` `Ctrl+Shift+R`, `olevel -2` `Tab` / `-1` `Shift+Tab`, `ocopy ref` `Ctrl+Shift+C`, `ocut` (recorta como referência), `oref2obj 0|1` `Ctrl+T`/`Ctrl+Shift+T`, `ooper` escolhe os operandos de `osub`/`orep`, `oalign <eixo> -1|0|+1`, `order ±2`, `m_paste [i|r|t]`. Pincel do mundo `b_obj`: `move` (`Ctrl` livre, `Ctrl+Shift` duplica), `patt`, `wrap` (`N`, `b_obj_wrap_space_*`), `msel` (`M`).
- **União (`MV_CMD_UnionSelection`):** exige dois nós ou um grupo; junta a caixa de todos (limitada a 256 em volta do centro), rasteriza cada nó na ordem da seleção e troca a seleção por um objeto novo.
- **Camadas (`o_layer.ui`):** clicar na camada a torna atual e move a seleção; menu com `lay_sel`, `lay_vis`, `lay_name`, `lay_col` (`_color` "r g b"), `lay_sort`.
- **`MATL`:** `_type` ∈ `_diffuse _emit _blend _metal _glass _media`; parâmetros: `_trans _metal _rough _ri _sp _g _d _emit _flux _ldr`; `_media_type` ∈ `_absorb _scatter _emit _sss`. Chaves antigas (`_ior _spec _alpha _weight _att _plastic`) só são lidas.
- **Paleta padrão (`palette/pal0.png`):** o cubo 6×6×6 de `ff` a `00` sem o preto, depois rampas de vermelho, verde, azul e cinza (`ee dd bb aa 88 77 55 44 22 11`); gerada por código, sem copiar o arquivo.

## 10. Lacunas conhecidas

| Item | Estado |
|---|---|
| Corpo do path tracer | não decodificado (§8); o editor reimplementa pelas features e pelos painéis, com as escalas lidas do setup de uniforms e as inferências listadas em §8 |
| `nTRN._loop` não lido pelo reader | observado pelas referências à string; confirmar abrindo um arquivo salvo com loop |
| "Global Time" | inferido: ligado avalia da raiz, desligado só o grupo aberto |
| Velocidade de playback | `a_speed` ∈ [0, 31]; a conversão para fps não foi rastreada |
| Pivô do modelo dentro do nTRN | **confirmado** = `floor(size/2)` [vox]: todo exemplo com altura ímpar tem `t.z = floor(h/2)` e assenta em z=0 (deer 27, castle 21, teapot 61, menger 81); pivô inteiro mantém os voxels no grid sob qualquer rotação |
| Integração do OIDN | só confirmada a carga dinâmica |

