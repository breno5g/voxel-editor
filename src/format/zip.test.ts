import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip.ts';

const text = (value: string) => new TextEncoder().encode(value);

describe('zipStore', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(text('hello'))).toBe(0x3610a686);
  });

  it('writes an archive unzip can read back', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zip-test-'));
    const archive = join(directory, 'frames.zip');
    writeFileSync(archive, zipStore([{ name: 'frame-000.png', data: text('first') }, { name: 'frame-001.png', data: text('second') }]));
    execFileSync('unzip', ['-q', archive, '-d', directory]);
    expect(readFileSync(join(directory, 'frame-001.png'), 'utf8')).toBe('second');
    expect(execFileSync('unzip', ['-t', archive]).toString()).toContain('No errors');
  });
});
