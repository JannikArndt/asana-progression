<script lang="ts" module>
  /** Open sheets, innermost last: Escape and the focus trap only act on the top one. */
  const stack: symbol[] = [];
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { dragOffset, releaseAction, releaseVelocity, settleMs, startsDrag, type DragSample, type DragZone } from './sheet-gesture';

  interface Props {
    title: string;
    /** Dismiss (= cancel): the ✕ / Cancel button, a tap on the backdrop, swiping down or Escape. */
    onclose: () => void;
    children: Snippet;
    /** Confirming action, top-right; the dismiss button then reads "Cancel". With `form`, it submits that form. */
    action?: { label: string; onclick?: () => void; form?: string; disabled?: boolean };
    /** Keep the full height while the content changes (search sheets), so the sheet doesn't jump. */
    fill?: boolean;
    /** False for questions that need an answer: no ✕, backdrop tap, swipe or Escape. */
    dismissible?: boolean;
    /** Dialogs stack above sheets and full-screen overlays. */
    layer?: 'sheet' | 'dialog';
  }
  let { title, onclose, children, action, fill = false, dismissible = true, layer = 'sheet' }: Props = $props();

  const titleId = $props.id();
  const token = Symbol('sheet');
  let sheet: HTMLDivElement;
  let body: HTMLDivElement;
  let backdrop: HTMLDivElement;

  // iOS Safari: with the keyboard up, the layout viewport (what `position: fixed` uses) extends
  // behind the keyboard, and the page scrolls when the content shrinks. Pin the scrim to the
  // visual viewport instead, so the sheet's bottom edge stays on top of the keyboard.
  let viewport = $state<{ top: number; height: number } | null>(null);
  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      viewport = { top: vv.offsetTop, height: vv.height };
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  });

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cssMs = (name: string, fallback: number) => parseFloat(getComputedStyle(sheet).getPropertyValue(name)) || fallback;
  const easing = () => getComputedStyle(sheet).getPropertyValue('--ease').trim() || 'ease-out';

  // Swipe to dismiss. Pointer events track the finger; a non-passive touchmove stops native
  // scrolling (iOS rubber band) once the content zone has turned into a sheet drag.
  let press: { id: number; zone: DragZone; x0: number; y0: number; dragging: boolean; samples: DragSample[] } | null = null;
  let offset = 0;
  let closing = false;
  let swallowClick = false;

  function place(dy: number) {
    offset = dragOffset(dy);
    sheet.style.transform = offset ? `translateY(${offset}px)` : '';
    backdrop.style.opacity = String(Math.min(1, Math.max(0, 1 - offset / sheet.offsetHeight)));
  }

  /** Decides a pending press at (x, y); true once it drags the sheet. */
  function decide(x: number, y: number): boolean {
    if (!press) return false;
    if (press.dragging) return true;
    const go = startsDrag(press.zone, x - press.x0, y - press.y0, body.scrollTop);
    if (go === false) press = null;
    if (!go || !press) return false;
    press.dragging = true;
    swallowClick = true;
    for (const a of sheet.getAnimations()) a.cancel();
    try {
      sheet.setPointerCapture(press.id);
    } catch {
      // the pointer is gone
    }
    return true;
  }

  function onDown(e: PointerEvent) {
    swallowClick = false;
    if (closing || !dismissible || !e.isPrimary || e.button !== 0) return;
    const target = e.target as Element;
    const zone: DragZone | null = target.closest('.handle') ? 'handle' : target.closest('.body') ? 'content' : null;
    if (!zone) return;
    // Content drags are a touch gesture; sliders keep their own drag.
    if (zone === 'content' && (e.pointerType === 'mouse' || target.closest('input[type=range], [data-sheet-no-drag]'))) return;
    press = { id: e.pointerId, zone, x0: e.clientX, y0: e.clientY, dragging: false, samples: [] };
  }

  function onMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id || !decide(e.clientX, e.clientY)) return;
    const dy = e.clientY - press.y0;
    press.samples.push({ t: e.timeStamp, y: e.clientY });
    if (press.samples.length > 12) press.samples.shift();
    place(dy);
  }

  function onUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (!p.dragging) return;
    const v = releaseVelocity(p.samples);
    if (e.type === 'pointerup' && releaseAction(offset, sheet.offsetHeight, v) === 'dismiss') close(v);
    else settle(0);
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (press && t && e.cancelable && decide(t.clientX, t.clientY)) e.preventDefault();
  }

  function onClickCapture(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Animates the sheet to `to` (px below its resting place) and the backdrop with it. */
  function settle(to: number, ms?: number): Promise<void> {
    const from = offset;
    offset = to;
    sheet.style.transform = to ? `translateY(${to}px)` : '';
    const dim = String(to ? 0 : 1);
    if (reducedMotion() || from === to) {
      backdrop.style.opacity = dim;
      return Promise.resolve();
    }
    const opts = { duration: ms ?? cssMs('--duration', 250), easing: easing() };
    const fromDim = backdrop.style.opacity || '1';
    backdrop.style.opacity = dim;
    backdrop.animate([{ opacity: fromDim }, { opacity: dim }], opts);
    const a = sheet.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], opts);
    return a.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Slides the sheet out, then lets the owner remove it. */
  function close(velocity = 0) {
    if (closing || !dismissible) return;
    closing = true;
    const h = sheet.offsetHeight + 16;
    void settle(h, settleMs(h - offset, velocity, cssMs('--duration', 250))).then(onclose);
  }

  function onKey(e: KeyboardEvent) {
    if (stack[stack.length - 1] !== token) return;
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Keep focus inside the sheet.
      const items = [...sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.matches(':disabled') && el.offsetParent !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !sheet.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  onMount(() => {
    const before = document.activeElement;
    stack.push(token);
    sheet.focus({ preventScroll: true });
    sheet.addEventListener('pointerdown', onDown);
    sheet.addEventListener('pointermove', onMove);
    sheet.addEventListener('pointerup', onUp);
    sheet.addEventListener('pointercancel', onUp);
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(token), 1);
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  });
</script>

<div
  class="scrim"
  class:dialog={layer === 'dialog'}
  style:top={viewport ? `${viewport.top}px` : null}
  style:height={viewport ? `${viewport.height}px` : null}
>
  <div class="backdrop" role="presentation" bind:this={backdrop} onclick={() => close()}></div>
  <div class="sheet" class:fill role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" bind:this={sheet}>
    <div class="handle">
      <div class="grabber" aria-hidden="true"></div>
      <header>
        <div class="lead">
          {#if dismissible && action}
            <button class="btn quiet text" type="button" onclick={() => close()}>Cancel</button>
          {:else if dismissible}
            <button class="close" type="button" aria-label="Close" onclick={() => close()}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                ><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg
              >
            </button>
          {/if}
        </div>
        <h2 id={titleId}>{title}</h2>
        <div class="trail">
          {#if action}
            <button class="btn quiet text strong" type={action.form ? 'submit' : 'button'} form={action.form} disabled={action.disabled} onclick={action.onclick}>
              {action.label}
            </button>
          {/if}
        </div>
      </header>
    </div>
    <div class="body" bind:this={body}>{@render children()}</div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    bottom: auto;
    height: 100%;
    z-index: 45;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .scrim.dialog {
    z-index: 50;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--color-scrim);
    touch-action: none;
  }

  .sheet {
    position: relative;
    width: 100%;
    max-width: 560px;
    max-height: calc(100% - var(--safe-top) - var(--space-6));
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    outline: none;
  }

  .sheet.fill {
    height: calc(100% - var(--safe-top) - var(--space-6));
  }

  @media (prefers-reduced-motion: no-preference) {
    .backdrop {
      animation: fade var(--duration) var(--ease);
    }

    .sheet {
      animation: rise var(--duration) var(--ease);
    }
  }

  /* Grabber and header: dragging here always moves the sheet. */
  .handle {
    flex: none;
    touch-action: none;
    border-bottom: 1px solid var(--color-hairline);
  }

  .grabber {
    width: 36px;
    height: 5px;
    margin: 6px auto 0;
    border-radius: var(--radius-pill);
    background: var(--color-text-3);
    opacity: 0.5;
  }

  header {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) auto minmax(max-content, 1fr);
    align-items: center;
    gap: var(--space-1);
    min-height: var(--touch);
    padding: 0 var(--space-2) var(--space-1);
  }

  h2 {
    font-size: var(--text-l);
    text-align: center;
    overflow-wrap: anywhere;
  }

  .lead {
    justify-self: start;
  }

  .trail {
    justify-self: end;
  }

  .text {
    padding: 0 var(--space-2);
  }

  .strong {
    font-weight: var(--weight-semibold);
  }

  .close {
    display: grid;
    place-items: center;
    width: var(--touch);
    height: var(--touch);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-2);
  }

  .close svg {
    box-sizing: content-box;
    padding: 8px;
    border-radius: 50%;
    background: var(--color-neutral-tint);
  }

  .close:active svg {
    background: var(--color-hairline);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: var(--space-3) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }
</style>
