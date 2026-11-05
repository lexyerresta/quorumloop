import './styles.css';

const STORAGE_KEY = 'quorumloop.theme';

function setupThemeToggle(button: HTMLButtonElement): void {
  const render = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.textContent = dark ? 'Light theme' : 'Dark theme';
    button.setAttribute('aria-pressed', String(dark));
  };
  render();
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts for this page view only.
    }
    render();
  });
}

function setupCopy(button: HTMLButtonElement): void {
  const source = document.getElementById(button.dataset.copy ?? '');
  const status = document.querySelector<HTMLElement>('[data-copy-status]');
  if (!source || !status) return;
  button.addEventListener('click', async () => {
    try {
      const text = source.textContent ?? '';
      await navigator.clipboard.writeText(text);
      const count = text.split('\n').filter((line) => line.trim()).length;
      status.textContent = `Copied ${count} commands to the clipboard.`;
    } catch {
      status.textContent =
        'This browser blocked clipboard access. Select the commands and copy them.';
    }
  });
}

const toggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
if (toggle) setupThemeToggle(toggle);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  setupCopy(button);
}
