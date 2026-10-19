/** A full-screen triangle; `main` in the fragment shader does the work. */
export const FULL_SCREEN_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1)) - 1.0;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL: não foi possível criar o shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Erro no shader: ${gl.getShaderInfoLog(shader)?.trim() ?? ''}`);
  return shader;
}

/** A program drawing `fragmentSource` over the full-screen triangle. */
export function linkFullScreenProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULL_SCREEN_VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Erro ao ligar o shader: ${gl.getProgramInfoLog(program) ?? ''}`);
  return program;
}
