<script lang="ts">
  import { formatTime } from './timeline';
  import type { OverviewSegment, Range } from './session-timeline';

  interface Props {
    durationS: number;
    /** Labeled holds grouped by catalog group. */
    segments: OverviewSegment[];
    /** Open (unlabeled) candidates. */
    open: Range[];
    /** Range of the detail graph; hidden when it is the whole video. */
    window: Range | null;
    /** Dragging: the time under the finger (window follows without animation). */
    onscrub?: (t: number) => void;
    /** Tap or end of a drag at time `t`. */
    onpick?: (t: number, dragged: boolean) => void;
  }
  let { durationS, segments, open, window: win, onscrub, onpick }: Props = $props();

  let width = $state(0);
  let el: HTMLDivElement;
  const pct = (t: number) => `${(Math.min(durationS, Math.max(0, t)) / Math.max(1e-3, durationS)) * 100}%`;
  const px = (s: number) => (s / Math.max(1e-3, durationS)) * width;
  const showWindow = $derived(!!win && win.endS - win.startS < durationS * 0.98);
  const centre = $derived(win ? (win.startS + win.endS) / 2 : 0);

  let drag: { pointerId: number; x0: number; moved: boolean } | null = null;

  function timeAt(clientX: number): number {
    const r = el.getBoundingClientRect();
    return (Math.min(r.width, Math.max(0, clientX - r.left)) / Math.max(1, r.width)) * durationS;
  }

  function down(e: PointerEvent) {
    if (drag) return;
    el.setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, x0: e.clientX, moved: false };
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 6) return;
    drag.moved = true;
    onscrub?.(timeAt(e.clientX));
  }

  function up(e: PointerEvent, cancelled = false) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!cancelled || d.moved) onpick?.(timeAt(e.clientX), d.moved);
  }

  function key(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -60 : e.key === 'ArrowRight' ? 60 : 0;
    if (!step) return;
    e.preventDefault();
    onpick?.(Math.min(durationS, Math.max(0, centre + step)), false);
  }
</script>

<div
  class="overview"
  bind:this={el}
  bind:clientWidth={width}
  role="slider"
  tabindex="0"
  aria-label="Session overview"
  aria-valuemin={0}
  aria-valuemax={Math.round(durationS)}
  aria-valuenow={Math.round(centre)}
  aria-valuetext={formatTime(centre)}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={(e) => up(e)}
  onpointercancel={(e) => up(e, true)}
  onkeydown={key}
>
  {#if !segments.length}<span class="empty">Labeled sections appear here</span>{/if}
  {#each segments as s, i (i)}
    <div class="segment" style:left={pct(s.startS)} style:width={pct(s.endS - s.startS)} title="{s.group || 'Other'} · {s.holds} {s.holds === 1 ? 'hold' : 'holds'}">
      {#if px(s.endS - s.startS) >= 26}<span>{s.label}</span>{/if}
    </div>
  {/each}
  {#each open as o, i (i)}
    <div class="open" style:left={pct(o.startS)} style:width={pct(o.endS - o.startS)}></div>
  {/each}
  {#if showWindow && win}
    <div class="window" style:left={pct(win.startS)} style:width={pct(win.endS - win.startS)}></div>
  {/if}
</div>

<style>
  .overview {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 36px;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    overflow: hidden;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
  }

  .overview:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .segment {
    position: absolute;
    top: 3px;
    bottom: 9px;
    display: flex;
    align-items: center;
    border-left: 1px solid var(--color-surface);
    border-radius: 3px;
    background: var(--color-accent-tint);
    overflow: hidden;
  }

  .segment span {
    padding: 0 var(--space-1);
    overflow: hidden;
    color: var(--color-accent-strong);
    font-size: 11px;
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .empty {
    position: absolute;
    inset: 0 0 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-3);
    font-size: 11px;
  }

  .open {
    position: absolute;
    bottom: 3px;
    height: 4px;
    min-width: 2px;
    border-radius: 1px;
    background: var(--color-text-3);
    opacity: 0.6;
  }

  .window {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 6px;
    border: 1.5px solid var(--color-accent);
    border-radius: var(--radius-s);
    pointer-events: none;
  }
</style>
