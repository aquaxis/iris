import { describe, expect, it } from 'vitest';
import { formatLabel } from './layout.js';

describe('merged edge labels', () => {
  it('spells out a few ports in full', () => {
    expect(formatLabel(['a'])).toBe('a');
    expect(formatLabel(['op', 'a', 'b'])).toBe('op, a, b');
  });

  it('summarises the rest rather than overflowing the box', () => {
    // This is the RegFile case: five ports on one line ran over the box.
    expect(formatLabel(['we', 'waddr', 'wdata', 'raddr1', 'raddr2'])).toBe(
      'we, waddr, wdata +2',
    );
  });
});
