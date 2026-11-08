// Shared theme plumbing for the WebGL layers. Deliberately decoupled from src/scripts/theme.ts:
// it reads <html data-theme> + the 'planet-theme-change' event, and tweens numeric vectors.
import { themeById, type PlanetTheme } from '../../data/themes';

export const currentTheme = (): PlanetTheme => themeById(document.documentElement.dataset.theme ?? (window as any).__planetTheme?.id);

/** Calls cb with the current theme now, then on every change (event, view-transition swap or navigation). */
export function watchTheme(cb: (t: PlanetTheme) => void, signal?: AbortSignal) {
  let id = '';
  const fire = (t: PlanetTheme) => { if (t.id !== id) { id = t.id; cb(t); } };
  fire(currentTheme());
  addEventListener('planet-theme-change', (e) => {
    const d = (e as CustomEvent).detail;
    fire(d?.theme ?? themeById(d?.id));
  }, { signal });
  const reread = () => fire(currentTheme());
  document.addEventListener('astro:after-swap', reread, { signal });
  document.addEventListener('astro:page-load', reread, { signal });
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Tweens a numeric vector to new targets with ease-in-out. A new target mid-flight starts from the current mix. */
export function createBlend(init: number[], ms = 900) {
  let from = init.slice(), to = init.slice();
  let t0 = 0, raw = 1, frozen = false;
  const b = {
    v: init.slice(),
    e: 1,
    get active() { return !frozen && raw < 1; },
    to(target: number[], instant = false) {
      from = b.v.slice(); to = target.slice(); t0 = performance.now(); frozen = false;
      raw = instant ? 1 : 0;
      b.apply();
    },
    /** Debug: pin the blend between two vectors at raw progress t (already eased by the caller if desired). */
    freeze(a: number[], c: number[], t: number) { from = a.slice(); to = c.slice(); raw = t; frozen = true; b.apply(); },
    apply() { const e = frozen ? raw : easeInOut(raw); b.e = e; for (let i = 0; i < to.length; i++) b.v[i] = from[i] + (to[i] - from[i]) * e; },
    /** Advance; returns true while still animating. */
    step(now = performance.now()) {
      if (frozen || raw >= 1) return false;
      raw = Math.min(1, (now - t0) / ms);
      b.apply();
      return raw < 1;
    },
  };
  return b;
}
