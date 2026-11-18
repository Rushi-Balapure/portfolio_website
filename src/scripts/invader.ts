// GitHub pulse invader: a ship that destroys contribution squares while the card is on screen.
// Targeting, explosions and the destroyed set live here; a Pilot (3D WebGL fighter or 2D sprite fallback) does the flying.
import { createGlPilot } from './invader3d';

/** Client-space (viewport px) position of the square to shoot, and the y the ship should hover at above the grid. */
export interface Aim { x: number; y: number; hoverY: number; }

export interface Pilot {
  /** Place the ship at its spawn point and make it visible. */
  enter(): void;
  /** Advance one frame toward `aim`, or retreat when `aim` is null. `firing` draws the beam to the aim point. */
  fly(dt: number, now: number, aim: Aim | null, firing: boolean): { arrived: boolean; visible: boolean };
  hide(): void;
}

// Module state survives ClientRouter navigations and resets on a full reload.
const destroyed = new Set<number>();

const AIM_MS = 200;
const BEAM_MS = 190;
const COOLDOWN_MS = 340;

type Mode = 'away' | 'hunting' | 'leaving';
type Phase = 'move' | 'aim' | 'fire' | 'cool';

const centerOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

function createSpritePilot(root: HTMLElement): Pilot | null {
  const ship = root.querySelector<HTMLElement>('[data-invader]');
  const beam = root.querySelector<HTMLElement>('[data-invader-beam]');
  if (!ship || !beam) return null;
  const MAX_SPEED = 320;
  let x = 0, y = 0, tilt = 0, exitY = 0;
  const origin = () => { const b = root.getBoundingClientRect(); return { left: b.left + root.clientLeft, top: b.top + root.clientTop }; };
  return {
    enter() {
      const o = origin(), s = root.querySelector('.calendar-scroll')?.getBoundingClientRect();
      x = root.clientWidth + 40;
      y = (s ? s.top - o.top : 0) - 56;
      ship.classList.add('is-active');
    },
    fly(dt, now, aim, firing) {
      const o = origin(), width = root.clientWidth;
      if (aim) exitY = aim.hoverY - o.top - 50;
      const tx = aim ? aim.x - o.left : width + 60;
      const ty = aim ? aim.hoverY - o.top : exitY;
      const dx = tx - x, dy = ty - y, distance = Math.hypot(dx, dy);
      const step = Math.min(distance, Math.max(distance * (1 - Math.exp(-6 * dt)), 40 * dt), MAX_SPEED * dt);
      const prevX = x;
      if (distance > 0) { x += (dx / distance) * step; y += (dy / distance) * step; }
      const velocity = dt ? (x - prevX) / dt : 0;
      tilt += (Math.max(-16, Math.min(16, velocity / 18)) - tilt) * Math.min(1, dt * 10);
      ship.style.transform = `translate(${x - 16.5}px, ${y - 12}px) rotate(${tilt}deg)`;
      ship.classList.toggle('is-alt', Math.floor(now / 320) % 2 === 1);
      beam.classList.toggle('is-firing', firing && !!aim);
      if (firing && aim) {
        const top = y + 12;
        beam.style.transform = `translate(${x - 1}px, ${top}px)`;
        beam.style.height = `${Math.max(0, aim.y - o.top - top)}px`;
      }
      const visible = !!aim || x <= width + 40;
      if (!visible) ship.classList.remove('is-active');
      return { arrived: distance - step < 1.5, visible };
    },
    hide() { ship.classList.remove('is-active'); beam.classList.remove('is-firing'); },
  };
}

function explode(root: HTMLElement, cell: HTMLElement) {
  cell.classList.add('is-destroyed');
  const flash = getComputedStyle(root).getPropertyValue('--link').trim() || '#fff';
  cell.animate(
    [
      { transform: 'scale(1)', background: flash, boxShadow: `0 0 10px ${flash}`, opacity: 1 },
      { transform: 'scale(1.7)', background: flash, boxShadow: `0 0 16px ${flash}`, opacity: 1, offset: 0.3 },
      { transform: 'scale(0.55)', opacity: 0.35 },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
  const box = root.getBoundingClientRect();
  const c = centerOf(cell);
  const cx = c.x - box.left - root.clientLeft, cy = c.y - box.top - root.clientTop;
  for (let i = 0; i < 7; i++) {
    const shard = document.createElement('i');
    shard.className = 'invader-debris';
    shard.style.left = `${cx}px`;
    shard.style.top = `${cy}px`;
    root.append(shard);
    const angle = (Math.PI * 2 * i) / 7 + Math.random() * 0.6;
    const reach = 12 + Math.random() * 18;
    shard
      .animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * reach}px), calc(-50% + ${Math.sin(angle) * reach}px)) scale(0.3)`, opacity: 0 },
        ],
        { duration: 480 + Math.random() * 220, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
      )
      .finished.then(() => shard.remove(), () => shard.remove());
  }
}

function initInvader(root: HTMLElement, signal: AbortSignal) {
  const scroller = root.querySelector<HTMLElement>('.calendar-scroll');
  const cells = [...root.querySelectorAll<HTMLElement>('.calendar span')];
  if (!scroller || !cells.length) return;

  destroyed.forEach((index) => cells[index]?.classList.add('is-destroyed'));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let pilot: Pilot | null = null;
  let mode: Mode = 'away';
  let phase: Phase = 'move';
  let phaseEnd = 0;
  let target = -1;
  let raf = 0;
  let last = 0;

  const isVisible = (index: number) => {
    const view = scroller.getBoundingClientRect();
    const r = cells[index].getBoundingClientRect();
    return r.left >= view.left && r.right <= view.right;
  };
  const hoverY = () => scroller.getBoundingClientRect().top - 26;
  const pickTarget = (fromX: number) => {
    const candidates: { index: number; distance: number }[] = [];
    cells.forEach((cell, index) => {
      if (!destroyed.has(index) && isVisible(index)) candidates.push({ index, distance: Math.abs(centerOf(cell).x - fromX) });
    });
    if (!candidates.length) return -1;
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[Math.floor(Math.random() * Math.min(8, candidates.length))].index;
  };

  let lastAimX = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (!pilot) return;
    let aim: Aim | null = null;

    if (mode === 'hunting') {
      if (target < 0 || destroyed.has(target) || !isVisible(target)) {
        target = pickTarget(lastAimX);
        phase = 'move';
      }
      if (target >= 0) {
        const c = centerOf(cells[target]);
        aim = { x: c.x, y: c.y, hoverY: hoverY() };
      } else if (destroyed.size === cells.length) {
        mode = 'leaving';
      } else {
        const s = scroller.getBoundingClientRect();
        aim = { x: s.left + s.width / 2, y: s.top, hoverY: hoverY() };
      }
      if (aim) lastAimX = aim.x;
    }

    const { arrived, visible } = pilot.fly(dt, now, aim, mode === 'hunting' && target >= 0 && phase === 'fire');
    if (!visible && mode === 'hunting') {
      pilot = createSpritePilot(root);
      if (!pilot) { raf = 0; return; }
      pilot.enter();
    }

    if (mode === 'hunting' && target >= 0) {
      if (!arrived) phase = 'move';
      else if (phase === 'move') { phase = 'aim'; phaseEnd = now + AIM_MS; }
      else if (now >= phaseEnd) {
        if (phase === 'aim') { phase = 'fire'; phaseEnd = now + BEAM_MS; }
        else if (phase === 'fire') {
          destroyed.add(target);
          explode(root, cells[target]);
          phase = 'cool';
          phaseEnd = now + COOLDOWN_MS;
        } else target = -1;
      }
    }

    if (mode === 'leaving' && !visible) {
      mode = 'away';
      pilot.hide();
      raf = 0;
      last = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const arrive = () => {
    if (destroyed.size === cells.length) return;
    pilot ??= createGlPilot() ?? createSpritePilot(root);
    if (!pilot) return;
    if (mode === 'away') {
      target = -1;
      lastAimX = scroller.getBoundingClientRect().right;
      pilot.enter();
    }
    mode = 'hunting';
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const retreat = () => {
    if (mode !== 'hunting') return;
    mode = 'leaving';
    phase = 'move';
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.intersectionRatio >= 0.5) arrive();
      else if (!entry.isIntersecting || entry.intersectionRatio < 0.15) retreat();
    },
    { threshold: [0, 0.15, 0.5] },
  );
  observer.observe(root);

  signal.addEventListener('abort', () => {
    observer.disconnect();
    cancelAnimationFrame(raf);
    pilot?.hide();
  });
}

let controller: AbortController | undefined;
export function initInvaders() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  document.querySelectorAll<HTMLElement>('[data-github-activity]').forEach((root) => initInvader(root, signal));
}
export const stopInvaders = () => controller?.abort();
