import { describe, expect, it } from 'vitest';
import { createXsShader, MAX_XS_ARGS, parseXsArgs, xsFragmentSource } from './xs-shader.ts';

describe('XS shaders', () => {
  it('reads the arguments of the header', () => {
    const args = parseXsArgs(`// xs_begin
// arg : { var = 'm_degree' name = 'Degree' value = '3'   range = '3 64'    step = '1'    precision = '0' }
// arg : { var = 'bad name' name = 'Ignored' value = '1' }
// xs_end`);
    expect(args).toEqual([{ name: 'm_degree', label: 'Degree', value: 3, min: 3, max: 64, step: 1, precision: 0 }]);
  });

  it('defines each argument on i_args and wraps the user map()', () => {
    const shader = createXsShader('t', "// arg : { var = 'm_a' name = 'A' value = '1' range = '0 2' step = '1' precision = '0' }\nfloat map(vec3 v) { return m_a; }");
    const source = xsFragmentSource(shader);
    expect(source).toContain('#define m_a i_args[0]');
    expect(source).toContain(`uniform float i_args[${MAX_XS_ARGS}];`);
    expect(source).toContain('float map(vec3 v) { return m_a; }');
    expect(source.indexOf('#define m_a')).toBeLessThan(source.indexOf('float map'));
  });
});
