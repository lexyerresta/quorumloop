import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * WCAG 2.x contrast for every text pairing the stylesheet uses, read from the tokens in
 * styles.css so a token change cannot silently drop below AA (R-25). Formula as documented in
 * docs/antislop/skills/antislop-human/SKILL.md, compared unrounded.
 */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1] as string,
      (m[2] as string).toLowerCase(),
    ]),
  );
}

const themes = { light: tokens(':root'), dark: tokens(":root[data-theme='dark']") };

// [foreground, background, minimum]. 4.5 for body text; 3.0 for non-text boundaries (WCAG 1.4.11).
const PAIRS: Array<[string, string, number]> = [
  ['ink', 'paper', 4.5],
  ['ink', 'surface', 4.5],
  ['ink-muted', 'paper', 4.5],
  ['ink-muted', 'surface', 4.5],
  ['accent', 'paper', 4.5],
  ['accent', 'surface', 4.5],
  ['accent-ink', 'accent', 4.5],
  ['accent-ink', 'accent-hover', 4.5],
  ['state-pass', 'surface', 4.5],
  ['state-pass', 'paper', 4.5],
  ['state-run', 'surface', 4.5],
  ['state-run', 'paper', 4.5],
  ['state-wait', 'surface', 4.5],
  ['state-wait', 'paper', 4.5],
  ['state-fail', 'surface', 4.5],
  ['state-fail', 'paper', 4.5],
  ['state-idle', 'surface', 4.5],
  ['rule-strong', 'paper', 3.0],
  ['rule-strong', 'surface', 3.0],
  ['accent', 'surface', 3.0],
];

describe.each(Object.entries(themes))('%s theme contrast', (_name, palette) => {
  it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, minimum) => {
    const a = palette[fg];
    const b = palette[bg];
    expect(a, `token --${fg}`).toBeDefined();
    expect(b, `token --${bg}`).toBeDefined();
    expect(contrast(a as string, b as string)).toBeGreaterThanOrEqual(minimum);
  });
});

it('formula matches the reference table in the human skill', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  expect(contrast('#777777', '#070707')).toBeLessThan(4.5);
  expect(contrast('#ffffff', '#666666')).toBeGreaterThan(4.5);
});
