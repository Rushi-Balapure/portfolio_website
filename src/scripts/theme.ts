import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, themeById, type PlanetTheme, type ThemeId } from '../data/themes';

declare global {
  interface Window {
    __planetTheme?: PlanetTheme;
  }
}

type Listener = (theme: PlanetTheme) => void;

const listeners = new Set<Listener>();
let switchTimer: number | undefined;

const isThemeId = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);

/** Current theme, derived from <html data-theme> (falls back to the default). */
export function getTheme(): PlanetTheme {
  if (typeof document === 'undefined') return themeById(DEFAULT_THEME);
  return window.__planetTheme ?? themeById(document.documentElement.dataset.theme ?? DEFAULT_THEME);
}

function apply(theme: PlanetTheme, animate: boolean) {
  const root = document.documentElement;
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-switching');
    window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => root.classList.remove('theme-switching'), 500);
  }
  root.dataset.theme = theme.id;
  window.__planetTheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.palette.paper);
}

/** Switch theme, persist it, and notify listeners + `planet-theme-change`. */
export function setTheme(id: ThemeId | string): PlanetTheme {
  const theme = themeById(isThemeId(id) ? id : DEFAULT_THEME);
  const changed = getTheme().id !== theme.id || document.documentElement.dataset.theme !== theme.id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    /* storage unavailable */
  }
  if (!changed) return theme;
  apply(theme, true);
  listeners.forEach((cb) => cb(theme));
  window.dispatchEvent(new CustomEvent('planet-theme-change', { detail: { id: theme.id, theme } }));
  return theme;
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readSaved(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

/** Re-sync <html> and window.__planetTheme from storage without animating or emitting. */
function sync() {
  const theme = themeById(readSaved());
  const prev = window.__planetTheme?.id;
  apply(theme, false);
  if (prev && prev !== theme.id) {
    listeners.forEach((cb) => cb(theme));
    window.dispatchEvent(new CustomEvent('planet-theme-change', { detail: { id: theme.id, theme } }));
  }
}

if (typeof window !== 'undefined') {
  const w = window as Window & { __themeRuntime?: boolean };
  if (!w.__themeRuntime) {
    w.__themeRuntime = true;
    sync();
    // The swapped-in document's <html> replaces ours, so re-apply the chosen theme.
    document.addEventListener('astro:after-swap', sync);
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_STORAGE_KEY) sync();
    });
  }
}
