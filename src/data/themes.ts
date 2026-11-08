/**
 * Planet themes: the single source of truth for the site palette AND the WebGL worlds.
 *
 * Every palette was contrast-checked (WCAG relative luminance):
 *   text/bg ≥ 17.5:1 · muted/surface ≥ 8.3:1 · bg-on-primary (button label) ≥ 6.4:1
 *   text-on-secondary ≥ 6.8:1 · accent/bg (links, focus) ≥ 11:1 · primary/surface ≥ 5.8:1
 *
 * Facts are kept short and sourced; real-planet looks are artist's interpretations of
 * published observations, and Pandora is fictional (Avatar-inspired, original rendering).
 */

export type ThemeId = 'pandora' | 'hd189733b' | 'cancri55e' | 'gj504b';
export type RGB = readonly [number, number, number]; // linear-ish 0..1 for shaders

export interface PlanetTheme {
  id: ThemeId;
  name: string;
  /** Short kind label for the slider, e.g. "Hot Jupiter". */
  kind: string;
  /** One-line, factual caption shown in the slider. */
  fact: string;
  fictional: boolean;
  source?: { label: string; url: string };
  /** CSS custom-property values applied on <html data-theme="…">. */
  palette: {
    paper: string;      // page background
    surface: string;    // cards, menus
    raised: string;     // hover / elevated
    ink: string;        // primary text
    muted: string;      // supporting text
    line: string;       // decorative borders only
    primary: string;    // brand: primary buttons, active nav, eyebrows (dark text on it)
    secondary: string;  // secondary buttons (light text on it, accent boundary)
    accent: string;     // links, focus ring
    glow: string;       // rgba() soft brand glow
  };
  /** WebGL art direction consumed by planet.ts / starfield.ts / astronaut.ts. */
  gl: {
    /** Which surface model the planet uber-shader emphasises. */
    world: 'biolum-ocean' | 'cobalt-giant' | 'lava-world' | 'magenta-giant';
    surfaceA: RGB;   // dominant surface colour
    surfaceB: RGB;   // secondary surface colour (land / bands / crust)
    highlight: RGB;  // day-side highlights (clouds, band crests, molten day side)
    emissive: RGB;   // night-side self-light (bioluminescence, magma, thermal glow)
    atmosphere: RGB; // limb / rim scattering colour
    ring?: RGB;      // optional ring tint (omit for no ring)
    nebulaA: RGB;    // starfield nebula cloud 1
    nebulaB: RGB;    // starfield nebula cloud 2
    warp: RGB;       // warp streak tint (stay near-white)
    astronautAccent: RGB; // visor reflection, chest light, rim light
  };
}

export const THEMES: readonly PlanetTheme[] = [
  {
    id: 'pandora',
    name: 'Pandora',
    kind: 'Fictional moon world',
    fact: 'Fictional, Avatar-inspired: a lush ocean world whose night side glows with bioluminescence.',
    fictional: true,
    palette: {
      paper: '#060d10', surface: '#0d1a1f', raised: '#12242a', ink: '#eef7f6', muted: '#9fb8b8',
      line: '#1e3a40', primary: '#3ee6c4', secondary: '#5b2fd6', accent: '#9df3ff', glow: 'rgba(62, 230, 196, 0.08)',
    },
    gl: {
      world: 'biolum-ocean',
      surfaceA: [0.02, 0.18, 0.22], surfaceB: [0.06, 0.32, 0.18], highlight: [0.92, 0.97, 0.98],
      emissive: [0.25, 0.95, 0.85], atmosphere: [0.35, 0.80, 1.00],
      nebulaA: [0.20, 0.90, 0.78], nebulaB: [0.42, 0.25, 0.95], warp: [0.88, 1.0, 0.98],
      astronautAccent: [0.30, 0.95, 0.85],
    },
  },
  {
    id: 'hd189733b',
    name: 'HD 189733 b',
    kind: 'Hot Jupiter · 64 light-years',
    fact: 'The first exoplanet whose colour was measured (Hubble, 2013): a deep cobalt blue, likely from silicate haze.',
    fictional: false,
    source: { label: 'NASA', url: 'https://science.nasa.gov/missions/hubble/nasa-hubble-finds-a-true-blue-planet/' },
    palette: {
      paper: '#05070f', surface: '#0d1428', raised: '#131c36', ink: '#eef2ff', muted: '#a3aed0',
      line: '#1f2a4d', primary: '#5b8cff', secondary: '#1f3a99', accent: '#a9c6ff', glow: 'rgba(91, 140, 255, 0.08)',
    },
    gl: {
      world: 'cobalt-giant',
      surfaceA: [0.03, 0.10, 0.42], surfaceB: [0.08, 0.22, 0.70], highlight: [0.55, 0.72, 1.00],
      emissive: [0.15, 0.05, 0.02], atmosphere: [0.40, 0.62, 1.00],
      nebulaA: [0.30, 0.45, 1.00], nebulaB: [0.12, 0.20, 0.65], warp: [0.90, 0.95, 1.0],
      astronautAccent: [0.45, 0.62, 1.00],
    },
  },
  {
    id: 'cancri55e',
    name: '55 Cancri e',
    kind: 'Lava super-Earth · 41 light-years',
    fact: 'A super-Earth so close to its star that its day side is likely molten; Spitzer mapped a scorching hot spot.',
    fictional: false,
    source: { label: 'NASA/JPL', url: 'https://www.jpl.nasa.gov/images/pia20068-hot-lava-world-illustration/' },
    palette: {
      paper: '#0c0806', surface: '#1a110c', raised: '#241811', ink: '#f7efe8', muted: '#c4b2a4',
      line: '#3a2618', primary: '#ff7a1a', secondary: '#8a2f0e', accent: '#ffc27a', glow: 'rgba(255, 122, 26, 0.08)',
    },
    gl: {
      world: 'lava-world',
      surfaceA: [0.05, 0.035, 0.03], surfaceB: [0.14, 0.08, 0.05], highlight: [1.00, 0.55, 0.15],
      emissive: [1.00, 0.36, 0.06], atmosphere: [1.00, 0.45, 0.18],
      nebulaA: [1.00, 0.42, 0.10], nebulaB: [0.55, 0.12, 0.05], warp: [1.0, 0.94, 0.86],
      astronautAccent: [1.00, 0.52, 0.18],
    },
  },
  {
    id: 'gj504b',
    name: 'GJ 504 b',
    kind: 'Young gas giant · 57 light-years',
    fact: 'A directly imaged young giant; NASA described its colour as a dull magenta, like a dark cherry blossom.',
    fictional: false,
    source: { label: 'NASA', url: 'https://exoplanets.nasa.gov/news/116/magenta-mystery' },
    palette: {
      paper: '#0d070c', surface: '#1c1019', raised: '#261623', ink: '#f8eef5', muted: '#c9b3c3',
      line: '#3d2236', primary: '#e866b2', secondary: '#7a2263', accent: '#f7a8d8', glow: 'rgba(232, 102, 178, 0.08)',
    },
    gl: {
      world: 'magenta-giant',
      surfaceA: [0.32, 0.08, 0.22], surfaceB: [0.55, 0.20, 0.42], highlight: [0.95, 0.62, 0.82],
      emissive: [0.45, 0.06, 0.20], atmosphere: [0.95, 0.50, 0.78], ring: [0.70, 0.52, 0.64],
      nebulaA: [0.92, 0.35, 0.70], nebulaB: [0.42, 0.12, 0.45], warp: [1.0, 0.92, 0.97],
      astronautAccent: [0.95, 0.45, 0.75],
    },
  },
] as const;

export const DEFAULT_THEME: ThemeId = 'pandora';
export const THEME_STORAGE_KEY = 'planet-theme';
export const themeById = (id: string | null | undefined): PlanetTheme =>
  THEMES.find((t) => t.id === id) ?? THEMES[0];
