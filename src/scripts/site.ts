/*
 * Site-wide interactions. Bundled once; every page load (including client-side
 * route swaps) re-binds through `astro:page-load` and tears down on swap.
 */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ─── Reveal on scroll, with batch stagger ─────────────────────────── */
function initReveal(signal: AbortSignal) {
  const items = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-visible)');
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    let batch = 0;
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target as HTMLElement;
      el.style.setProperty('--reveal-delay', `${Math.min(batch, 5) * 45}ms`);
      batch += 1;
      el.classList.add('is-visible');
      observer.unobserve(el);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  items.forEach((item) => observer.observe(item));
  document.documentElement.classList.add('reveal-ready');
  signal.addEventListener('abort', () => observer.disconnect());
}

/* ─── Header state + scroll progress ───────────────────────────────── */
function initScrollChrome(signal: AbortSignal) {
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  const bar = document.querySelector<HTMLElement>('[data-scroll-progress]');
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (bar) bar.style.transform = `scaleX(${progress})`;
    header?.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', schedule, { passive: true, signal });
  window.addEventListener('resize', schedule, { passive: true, signal });
  signal.addEventListener('abort', () => cancelAnimationFrame(frame));
  update();
}

/* ─── Scroll-spy for the home page sections ───────────────────────── */
function initScrollSpy(signal: AbortSignal) {
  const links = document.querySelectorAll<HTMLAnchorElement>('.desktop-nav a[data-spy]');
  const sections = [...links]
    .map((link) => document.getElementById(link.dataset.spy ?? ''))
    .filter((section): section is HTMLElement => section !== null);
  if (sections.length === 0 || !('IntersectionObserver' in window)) return;
  const setActive = (id?: string) => links.forEach((link) => link.classList.toggle('is-active', link.dataset.spy === id));
  const visible = new Map<string, boolean>();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting));
    const current = sections.find((section) => visible.get(section.id));
    setActive(current?.id);
  }, { rootMargin: '-40% 0px -55% 0px' });
  sections.forEach((section) => observer.observe(section));
  signal.addEventListener('abort', () => observer.disconnect());
}

/* ─── Magnetic buttons ─────────────────────────────────────────────── */
function initMagnetic(signal: AbortSignal) {
  if (!finePointer() || reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const y = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      el.classList.add('is-magnet');
      el.style.setProperty('--mx', `${(x * 6).toFixed(2)}px`);
      el.style.setProperty('--my', `${(y * 5).toFixed(2)}px`);
    }, { signal });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-magnet');
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    }, { signal });
  });
}

/* ─── Tilt (portrait, cards) ───────────────────────────────────────── */
function initTilt(signal: AbortSignal) {
  if (!finePointer() || reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    const strength = Number(el.dataset.tilt) || 6;
    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty('--tilt-x', `${(-y * strength).toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${(x * strength).toFixed(2)}deg`);
      el.style.setProperty('--spot-x', `${(x + 0.5) * 100}%`);
      el.style.setProperty('--spot-y', `${(y + 0.5) * 100}%`);
      el.classList.add('is-tilting');
    }, { signal });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    }, { signal });
  });
}

/* ─── Spotlight on cards ───────────────────────────────────────────── */
function initSpotlight(signal: AbortSignal) {
  if (!finePointer() || reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('[data-spotlight]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    }, { signal });
  });
}

/* ─── Live clock ───────────────────────────────────────────────────── */
function initClock(signal: AbortSignal) {
  const clocks = document.querySelectorAll<HTMLElement>('[data-clock]');
  if (clocks.length === 0) return;
  const render = () => clocks.forEach((clock) => {
    try {
      const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: clock.dataset.clock || 'Asia/Kolkata' }).format(new Date());
      clock.textContent = time;
    } catch { /* keep server fallback */ }
  });
  render();
  const timer = window.setInterval(render, 30_000);
  signal.addEventListener('abort', () => window.clearInterval(timer));
}

/* ─── Toast ────────────────────────────────────────────────────────── */
let toastTimer = 0;
function toast(message: string) {
  const el = document.querySelector<HTMLElement>('[data-toast]');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 2200);
}

/* ─── Copy email ───────────────────────────────────────────────────── */
function initCopyEmail(signal: AbortSignal) {
  document.querySelectorAll<HTMLButtonElement>('[data-copy-email]').forEach((button) => {
    button.addEventListener('click', async () => {
      const email = button.dataset.copyEmail;
      if (!email) return;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(email);
        toast(`Copied ${email}`);
      } catch {
        toast(`Email: ${email}`);
      }
    }, { signal });
  });
}

/* ─── Animated dialogs (command menu + drawer) ────────────────────── */
const returnFocus = new WeakMap<HTMLDialogElement, HTMLElement>();

function openDialog(dialog: HTMLDialogElement, focusTarget?: HTMLElement | null) {
  if (dialog.open) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement) returnFocus.set(dialog, active);
  dialog.classList.remove('is-closing');
  dialog.showModal();
  requestAnimationFrame(() => focusTarget?.focus());
}

function closeDialog(dialog: HTMLDialogElement, restoreFocus = true) {
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  const finish = () => {
    dialog.classList.remove('is-closing');
    dialog.close();
    if (!restoreFocus) return;
    const target = returnFocus.get(dialog);
    const fallback = document.querySelector<HTMLElement>('[data-command-open]');
    (target?.isConnected && target.offsetParent !== null ? target : fallback)?.focus();
  };
  if (reducedMotion()) { finish(); return; }
  dialog.classList.add('is-closing');
  window.setTimeout(finish, 180);
}

function initDrawer(signal: AbortSignal) {
  const drawer = document.querySelector<HTMLDialogElement>('[data-drawer]');
  if (!drawer) return;
  document.querySelectorAll<HTMLElement>('[data-drawer-open]').forEach((trigger) => {
    trigger.addEventListener('click', () => openDialog(drawer, drawer.querySelector<HTMLElement>('[data-drawer-close]')), { signal });
  });
  drawer.querySelectorAll<HTMLElement>('[data-drawer-close]').forEach((button) => {
    button.addEventListener('click', () => {
      // If this button also opens search, hand over immediately without focus bounce.
      if (button.hasAttribute('data-command-open')) { drawer.classList.remove('is-closing'); drawer.close(); return; }
      closeDialog(drawer);
    }, { signal });
  });
  drawer.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(drawer); }, { signal });
  drawer.addEventListener('click', (event) => { if (event.target === drawer) closeDialog(drawer); }, { signal });
  drawer.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', () => { drawer.close(); }, { signal }));
  window.matchMedia('(min-width: 1061px)').addEventListener('change', (event) => { if (event.matches && drawer.open) drawer.close(); }, { signal });
}

function initCommandMenu(signal: AbortSignal) {
  const dialog = document.querySelector<HTMLDialogElement>('[data-command-menu]');
  const input = dialog?.querySelector<HTMLInputElement>('[data-command-input]');
  if (!dialog || !input) return;
  const options = [...dialog.querySelectorAll<HTMLElement>('[data-command-option]')];
  const groups = [...dialog.querySelectorAll<HTMLElement>('[data-command-group]')];
  const empty = dialog.querySelector<HTMLElement>('[data-command-empty]');
  const queryEcho = dialog.querySelector<HTMLElement>('[data-command-query]');
  const count = dialog.querySelector<HTMLElement>('[data-command-count]');
  const status = dialog.querySelector<HTMLElement>('[data-command-status]');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll<HTMLElement>('[data-command-kbd]').forEach((kbd) => { kbd.textContent = isMac ? '⌘ K' : 'Ctrl K'; });

  let active = -1;
  const visibleOptions = () => options.filter((option) => !option.closest('li')?.hidden);

  const setActive = (index: number) => {
    const list = visibleOptions();
    options.forEach((option) => option.setAttribute('aria-selected', 'false'));
    if (list.length === 0) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
    active = (index + list.length) % list.length;
    const current = list[active];
    current.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  };

  const filter = () => {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    options.forEach((option) => {
      const haystack = option.dataset.search ?? '';
      const match = terms.every((term) => haystack.includes(term));
      const row = option.closest('li');
      if (row) row.hidden = !match;
      if (match) shown += 1;
    });
    groups.forEach((group) => { group.hidden = !group.querySelector('li:not([hidden]) [data-command-option]'); });
    if (empty) empty.hidden = shown > 0;
    if (queryEcho) queryEcho.textContent = input.value.trim();
    const label = `${shown} result${shown === 1 ? '' : 's'}`;
    if (count) count.textContent = label;
    if (status) status.textContent = label;
    setActive(0);
  };

  const open = () => {
    input.value = '';
    filter();
    openDialog(dialog, input);
  };

  const run = (option: HTMLElement) => {
    const action = option.dataset.commandAction;
    if (action?.startsWith('theme:')) {
      const theme = action.slice(6);
      closeDialog(dialog);
      window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-theme-option="${theme}"]`)?.click(), reducedMotion() ? 0 : 190);
      toast(`Theme: ${theme}`);
      return;
    }
    // Links navigate natively (ClientRouter intercepts same-origin); close without animation.
    dialog.classList.remove('is-closing');
    dialog.close();
  };

  document.querySelectorAll<HTMLElement>('[data-command-open]').forEach((trigger) => trigger.addEventListener('click', open, { signal }));

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target?.closest('input, textarea, [contenteditable="true"]') && target !== input;
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (dialog.open) closeDialog(dialog); else open();
    } else if (event.key === '/' && !typing && !dialog.open && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      open();
    }
  }, { signal });

  input.addEventListener('input', filter, { signal });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
    else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === 'Enter') {
      const current = visibleOptions()[active];
      if (!current) return;
      event.preventDefault();
      current.click();
    }
  }, { signal });

  options.forEach((option) => {
    option.addEventListener('click', () => run(option), { signal });
    option.addEventListener('pointermove', () => {
      const index = visibleOptions().indexOf(option);
      if (index !== active) setActive(index);
    }, { signal });
  });

  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); }, { signal });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); }, { signal });
}

/* ─── Boot ─────────────────────────────────────────────────────────── */
let controller: AbortController | undefined;

function boot() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const steps = [initReveal, initScrollChrome, initScrollSpy, initMagnetic, initTilt, initSpotlight, initClock, initCopyEmail, initDrawer, initCommandMenu];
  steps.forEach((step) => {
    try { step(signal); } catch (error) { console.error(error); }
  });
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', () => {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => dialog.close());
  controller?.abort();
});
