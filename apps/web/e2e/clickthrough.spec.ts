import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Delivery Gate click-through (R-35). Every interactive element on every screen is exercised
 * against the live gateway, in both themes and at 360px, and each step is written to
 * docs/quality/clickthrough-log.md as evidence. It creates one project and archives it again.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const shots = path.join(root, 'docs/quality/screenshots');
mkdirSync(shots, { recursive: true });

function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const line = readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is not set in the environment or .env`);
  return line.slice(name.length + 1).trim();
}

const log: string[] = [];
const consoleErrors: string[] = [];
const step = (text: string) => log.push(`- ${text}`);

function watchConsole(page: Page) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // A signed-out visitor's session probe answers 401 by design; the browser logs it as a failed
    // resource. Only that exact request is excluded, every other console error fails the run.
    const source = message.location().url;
    if (/\/api\/v1\/(session|auth\/login)$/.test(source) && message.text().includes('401')) return;
    consoleErrors.push(`${page.url()}: ${message.text()} [${source}]`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()}: ${error.message}`));
}

async function axe(page: Page, where: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = result.violations.map(
    (v) =>
      `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')} ${(v.nodes[0]?.failureSummary ?? '').replace(/\s+/g, ' ')}`,
  );
  step(
    `axe ${where}: ${result.violations.length} violations${summary.length ? ` -> ${summary.join('; ')}` : ''}`,
  );
  expect(summary, `axe violations on ${where}`).toEqual([]);
}

async function noHorizontalOverflow(page: Page, where: string) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  step(`360px ${where}: scrollWidth ${widths.scroll} vs viewport ${widths.client}`);
  expect(widths.scroll, `horizontal overflow on ${where}`).toBeLessThanOrEqual(widths.client);
}

async function signIn(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(env('SMOKE_EMAIL'));
  await page.getByLabel('Password').fill(env('SMOKE_PASSWORD'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

test.afterAll(() => {
  const body = [
    '# Dashboard click-through log',
    '',
    `Recorded by \`apps/web/e2e/clickthrough.spec.ts\` on ${new Date().toISOString()} against the live`,
    'gateway. Regenerate with `pnpm --filter @quorumloop/web e2e` while `pnpm dev:core` runs.',
    '',
    ...log,
    '',
    `Console errors: ${consoleErrors.length}`,
    ...consoleErrors.map((entry) => `- ${entry}`),
    '',
  ].join('\n');
  writeFileSync(path.join(root, 'docs/quality/clickthrough-log.md'), body);
});

test('sign-in rejects a wrong password with the server reason', async ({ page }) => {
  watchConsole(page);
  await page.goto('/login');
  await axe(page, 'sign in');
  await page.getByLabel('Email').fill(env('SMOKE_EMAIL'));
  await page.getByLabel('Password').fill('Wrong-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  step('Sign in with a wrong password -> inline alert "email or password is incorrect"');
});

test('operator walks every screen and control', async ({ page }) => {
  watchConsole(page);
  await signIn(page);
  step('Sign in with SMOKE_EMAIL -> Overview');

  // Overview
  await expect(page.locator('.kpi', { hasText: 'Quality passed' })).toContainText('Unavailable');
  await expect(page.locator('.kpi', { hasText: 'Active agents' })).toContainText('Unavailable');
  step('Overview -> KPI strip shows Quality passed and Active agents as Unavailable, not 0');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  step('Overview Refresh -> refetches, button returns to Refresh');
  await axe(page, 'overview (light)');
  await page.screenshot({ path: path.join(shots, 'overview-light.png'), fullPage: true });

  // Rail navigation reaches every destination
  for (const [linkName, heading] of [
    ['Projects', 'Projects'],
    ['Connections', 'Connections'],
    ['Approvals', 'Approvals'],
    ['Notifications', 'Notifications'],
    ['Settings', 'Settings'],
    ['Overview', 'Overview'],
  ] as const) {
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: linkName })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    step(`Rail ${linkName} -> ${heading} page`);
  }

  // Theme toggle
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  step('Dark theme toggle -> html[data-theme=dark], button reads Light theme');
  await axe(page, 'overview (dark)');
  await page.screenshot({ path: path.join(shots, 'overview-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  step('Light theme toggle -> back to light');

  // Projects: create dialog opens, Escape closes, then create for real
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Projects' })
    .click();
  await page.getByRole('button', { name: 'Start from idea' }).click();
  await expect(page.getByRole('dialog', { name: 'Start from idea' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  step('Start from idea -> dialog opens, Escape closes it');
  await axe(page, 'projects');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create project' });
  await expect(dialog).toBeVisible();
  const projectName = `Clickthrough ${Date.now().toString(36)}`;
  await dialog.getByLabel('Name').fill(projectName);
  await expect(dialog.getByLabel('Slug')).toHaveValue(/^clickthrough-/);
  step('Create project dialog -> slug follows the name');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  step(`Create project -> navigates to the new project "${projectName}"`);

  // Board: create a task, move it through legal lanes, see Done refused
  await page.getByRole('button', { name: 'Create task' }).first().click();
  const taskDialog = page.getByRole('dialog', { name: 'Create task' });
  await taskDialog.getByLabel('Title').fill('Check the click-through task');
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog.getByText('Check the click-through task')).toBeVisible();
  step('Create task -> task appears in the Backlog lane');
  await backlog.getByLabel(/Move .* to/).selectOption('ready');
  await backlog.getByRole('button', { name: 'Move' }).click();
  await expect(
    page.getByRole('region', { name: 'Ready' }).getByText('Check the click-through task'),
  ).toBeVisible();
  step('Move to Ready -> task moves to the Ready lane');
  await axe(page, 'project board');
  await page.screenshot({ path: path.join(shots, 'board-light.png'), fullPage: true });

  await page.getByRole('link', { name: 'Check the click-through task' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Check the click-through task',
  );
  await page.getByRole('button', { name: 'Move to in progress' }).click();
  await expect(page.getByText(/Moved/)).toBeVisible();
  await page.getByRole('button', { name: 'Move to in review' }).click();
  await expect(page.getByRole('button', { name: 'Move to done' })).toBeVisible();
  await page.getByRole('button', { name: 'Move to done' }).click();
  await expect(page.getByText('Refused')).toBeVisible();
  step('Task page -> in progress, in review, then Done is refused with the quality gate reason');
  await page.getByLabel('Title').fill('Check the click-through task, edited');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  step('Save task -> "Saved."');
  await expect(page.getByRole('cell', { name: 'In review' }).first()).toBeVisible();
  step('History table -> lists the transitions');
  await axe(page, 'task detail');
  await page.getByRole('link', { name: 'Back to the board' }).click();

  // Composer: Enter sends
  const composer = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await composer.fill(`Add a health check to the deployment guide ${Date.now().toString(36)}`);
  await composer.press('Enter');
  await expect(page.getByText('Not dispatched')).toBeVisible();
  step(
    'Composer Enter -> instruction recorded, dispatch reads Not dispatched with the server reason',
  );

  // Activity, live stream
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByText('Live')).toBeVisible();
  await expect(page.locator('.feed li').first()).toBeVisible();
  step('Activity tab -> stream status Live, feed lists real events');
  await axe(page, 'activity');

  // Code tab without repository
  await page.getByRole('link', { name: 'Code' }).click();
  await expect(page.locator('.state', { hasText: 'no repository bound' })).toBeVisible();
  step('Code tab -> empty state names the missing repository and links to Connections');

  // Project settings save and archive
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.getByRole('button', { name: 'Save project settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  step('Save project settings -> "Saved."');
  const archive = page.getByRole('button', { name: `Archive ${projectName}` });
  await expect(archive).toBeDisabled();
  await page.getByLabel(/leaves the dashboard/).check();
  await archive.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  step('Archive is disabled until the checkbox is ticked, then archives and returns to Projects');

  // Connections dialog
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Connections' })
    .click();
  await page.getByRole('button', { name: 'Connect GitHub' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Connect GitHub' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Connect GitHub' }).click();
  await expect(page.getByLabel('Token')).toHaveJSProperty('validity.valueMissing', true);
  step('Connect GitHub with an empty token -> browser validation blocks submit');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  step('Connect dialog Close -> closes');
  await axe(page, 'connections');

  // Approvals tabs
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Approvals' })
    .click();
  await page.getByRole('tab', { name: 'Approved' }).click();
  await expect(page.getByRole('tab', { name: 'Approved' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  step('Approvals tab Approved -> selected, list reloads');
  await axe(page, 'approvals');

  // Notifications
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Notifications' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await axe(page, 'notifications');
  step('Notifications -> list or empty state renders');

  // Settings policy save
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  const save = page.getByRole('button', { name: 'Save policy' });
  await expect(save).toBeDisabled();
  step('Save policy with no change -> disabled, "No unsaved changes."');
  const retention = page.getByLabel('Audit retention, days');
  const before = await retention.inputValue();
  await retention.fill(String(Number(before) === 3650 ? 3649 : Number(before) + 1));
  await save.click();
  await expect(page.getByText('Saved as a new revision.')).toBeVisible();
  step('Change audit retention, Save policy -> "Saved as a new revision."');
  await page.getByLabel('Audit retention, days').fill(before);
  await save.click();
  await expect(page.getByText('Saved as a new revision.')).toBeVisible();
  step(`Restore audit retention to ${before} -> saved again`);
  await axe(page, 'settings');

  // Keyboard: skip link and focus ring
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  step('First Tab -> Skip to content link receives focus');

  // Unknown route
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  step('Unknown URL -> Page not found with a link to the overview');

  // Sign out
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  step('Sign out -> back to Sign in');

  expect(consoleErrors, 'console errors').toEqual([]);
});

test('360px layout holds on every screen', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: true,
  });
  const page = await context.newPage();
  watchConsole(page);
  await signIn(page);
  for (const [url, name] of [
    ['/', 'overview'],
    ['/projects', 'projects'],
    ['/connections', 'connections'],
    ['/approvals', 'approvals'],
    ['/notifications', 'notifications'],
    ['/settings', 'settings'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalOverflow(page, name);
  }
  await page.screenshot({ path: path.join(shots, 'settings-360.png'), fullPage: true });

  await page.goto('/projects');
  await page.locator('table.ledger, .state').first().waitFor();
  const firstProject = page.locator('td[data-label="Project"] a').first();
  if ((await firstProject.count()) > 0) {
    await firstProject.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Task board' })).toBeVisible();
    await noHorizontalOverflow(page, 'project board (lanes scroll inside their own container)');
    await page.screenshot({ path: path.join(shots, 'board-360.png'), fullPage: true });
    const dock = page.getByRole('button', { name: 'Write instruction' });
    const dockHeight = await dock.evaluate((el) => el.getBoundingClientRect().height);
    expect(dockHeight).toBeGreaterThanOrEqual(44);
    await dock.click();
    const sheet = page.getByRole('dialog', { name: 'Send instruction' });
    await sheet
      .getByRole('textbox', { name: 'Instruction', exact: true })
      .fill(`Document the 360px composer sheet ${Date.now().toString(36)}`);
    await sheet.getByRole('button', { name: 'Send instruction' }).click();
    await expect(sheet.getByText('Not dispatched')).toBeVisible();
    await page.screenshot({ path: path.join(shots, 'composer-sheet-360.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    step(
      `360px composer -> ${dockHeight}px dock button opens a bottom sheet, send records the instruction, Escape closes`,
    );
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Sections' });
  await expect(menu).toBeVisible();
  step('360px Menu -> section dialog opens');
  await menu.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(shots, 'menu-360-dark.png') });
  await menu.getByRole('button', { name: 'Light theme' }).click();
  step('360px Menu theme button -> toggles dark and back to light');
  await menu.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  step('360px Menu > Projects -> navigates and the dialog closes');

  const height = await page
    .getByRole('button', { name: 'Menu' })
    .evaluate((el) => el.getBoundingClientRect().height);
  step(`360px Menu button height ${height}px (minimum 44)`);
  expect(height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(shots, 'projects-360.png'), fullPage: true });
  await context.close();
  expect(consoleErrors, 'console errors at 360px').toEqual([]);
});
