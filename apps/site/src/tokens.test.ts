import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The project page reuses the dashboard's colour tokens instead of importing across apps. This
 * test fails when the two copies drift, so the contrast proof in apps/web (contrast.test.ts)
 * keeps covering every colour this page uses.
 */

const site = readFileSync(path.resolve(__dirname, 'styles.css'), 'utf8');
const web = readFileSync(path.resolve(__dirname, '../../web/src/styles.css'), 'utf8');

function colours(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1] as string,
      (m[2] as string).toLowerCase(),
    ]),
  );
}

describe.each([':root', ":root[data-theme='dark']"])('%s colours', (selector) => {
  it('match the dashboard tokens', () => {
    const own = colours(site, selector);
    expect(Object.keys(own).length).toBeGreaterThanOrEqual(14);
    expect(own).toEqual(colours(web, selector));
  });
});

it('uses no colour literal outside the token blocks', () => {
  const body = site.slice(site.indexOf('*,'));
  expect(body.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
});
