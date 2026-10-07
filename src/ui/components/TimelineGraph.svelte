<script lang="ts">
  import { onMount } from 'svelte';
  import {
    clampView,
    envelope,
    fitView,
    formatTime,
    hitSpan,
    isFit,
    panBy,
    revealSpan,
    robustMax,
    ticks,
    timeToX,
    zoomAt,
    type Span,
    type View,
  } from './timeline';

  interface Props {
    durationS: number;
    sampleHz: number;
    /** C(t) values, one per sample. */
    values: Float32Array;
    /** Number of valid leading samples (live mode). */
    available?: number;
    /** Bump to redraw after mutating `values` in place. */
    version?: number;
    threshold?: number | null;
    spans?: Span[];
    selectedId?: string | null;
    /** Processed media time (s) shown as a playhead while processing. */
    playheadS?: number | null;
    height?: number;
    onselect?: (id: string) => void;
  }

  let {
    durationS,
    sampleHz,
    values,
    available = values.length,
    version = 0,
    threshold = null,
    spans = [],
    selectedId = null,
    playheadS = null,
    height = 168,
    onselect,
  }: Props = $props();

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let view = $state<View>({ startS: 0, pxPerS: 1, widthPx: 0, durationS: 1 });
  let colors = {
    text: '#1d1c1a',
    text2: '#67645e',
    text3: '#9b978f',
    hairline: 'rgba(29,28,26,0.1)',
    neutral: 'rgba(29,28,26,0.07)',
    accent: '#5c7d71',
    accentTint: 'rgba(92,125,113,0.18)',
    font: 'system-ui',
  };
  let hatch: CanvasPattern | null = null;
  let raf = 0;
  let yMaxCache = { version: -1, available: -1, value: 1 };

  const LABEL_BAND = 20;
  const AXIS = 20;

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    colors = {
      text: v('--color-text', colors.text),
      text2: v('--color-text-2', colors.text2),
      text3: v('--color-text-3', colors.text3),
      hairline: v('--color-hairline', colors.hairline),
      neutral: v('--color-neutral-tint', colors.neutral),
      accent: v('--color-accent', colors.accent),
      accentTint: v('--color-accent-tint', colors.accentTint),
      font: v('--font', colors.font),
    };
  }

  function makeHatch(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const c = document.createElement('canvas');
    c.width = 6;
    c.height = 6;
    const g = c.getContext('2d');
    if (!g) return null;
    g.strokeStyle = colors.hairline;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 6);
    g.lineTo(6, 0);
    g.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function yMax(): number {
    if (yMaxCache.version !== version || Math.abs(yMaxCache.available - available) > 40 || yMaxCache.available > available) {
      yMaxCache = { version, available, value: robustMax(values, available) };
    }
    return yMaxCache.value;
  }

  function draw() {
    if (!canvas || view.widthPx <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = view.widthPx;
    const h = height;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    hatch ??= makeHatch(ctx);

    const top = LABEL_BAND;
    const bottom = h - AXIS;
    const plotH = bottom - top;
    const max = yMax();
    const y = (c: number) => bottom - Math.min(1, Math.max(0, c / max)) * plotH;

    // Spans
    for (const s of spans) {
      const x0 = timeToX(view, s.startS);
      const x1 = timeToX(view, s.endS);
      if (x1 < 0 || x0 > w) continue;
      const bw = Math.max(1, x1 - x0);
      if (s.status === 'dismissed') {
        ctx.fillStyle = hatch ?? colors.neutral;
      } else {
        ctx.fillStyle = s.status === 'labeled' ? colors.accentTint : colors.neutral;
      }
      ctx.fillRect(x0, top, bw, plotH);
      if (s.id === selectedId) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.75, top + 0.75, Math.max(0, bw - 1.5), plotH - 1.5);
      }
    }

    // Threshold
    if (threshold !== null && Number.isFinite(threshold)) {
      ctx.save();
      ctx.strokeStyle = colors.text3;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      const ty = Math.round(y(threshold)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(w, ty);
      ctx.stroke();
      ctx.restore();
    }

    // C(t)
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    const pxPerSample = view.pxPerS / sampleHz;
    ctx.beginPath();
    if (pxPerSample >= 1.5) {
      const a = Math.max(0, Math.floor(view.startS * sampleHz) - 1);
      const b = Math.min(available, Math.ceil((view.startS + w / view.pxPerS) * sampleHz) + 1);
      let pen = false;
      for (let i = a; i < b; i++) {
        const c = values[i]!;
        if (!Number.isFinite(c)) {
          pen = false;
          continue;
        }
        const x = timeToX(view, i / sampleHz);
        if (pen) ctx.lineTo(x, y(c));
        else ctx.moveTo(x, y(c));
        pen = true;
      }
    } else {
      const env = envelope(values, sampleHz, view, available);
      let pen = false;
      for (let x = 0; x < env.max.length; x++) {
        const lo = env.min[x]!;
        const hi = env.max[x]!;
        if (!Number.isFinite(hi)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x + 0.5, y(hi));
        else ctx.moveTo(x + 0.5, y(hi));
        ctx.lineTo(x + 0.5, y(lo));
        pen = true;
      }
    }
    ctx.stroke();

    // Best-frame markers
    for (const s of spans) {
      const draws: Array<[number, boolean]> = [[s.bestS, true], ...(s.alternatesS ?? []).map((t) => [t, false] as [number, boolean])];
      for (const [t, main] of draws) {
        const x = timeToX(view, t);
        if (x < -4 || x > w + 4) continue;
        const c = values[Math.round(t * sampleHz)];
        const cy = c !== undefined && Number.isFinite(c) ? y(c) : bottom - 4;
        ctx.beginPath();
        ctx.arc(x, cy, main ? 3 : 2.25, 0, Math.PI * 2);
        if (main) {
          ctx.fillStyle = s.status === 'labeled' ? colors.accent : colors.text;
          ctx.fill();
        } else {
          ctx.strokeStyle = colors.text2;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Labels
    ctx.font = `500 11px ${colors.font}`;
    ctx.textBaseline = 'middle';
    for (const s of spans) {
      if (!s.label || s.status !== 'labeled') continue;
      const x0 = timeToX(view, s.startS);
      const x1 = timeToX(view, s.endS);
      if (x1 < 0 || x0 > w) continue;
      const bw = x1 - x0;
      const tw = ctx.measureText(s.label).width;
      ctx.fillStyle = colors.accent;
      if (bw >= tw + 8) {
        ctx.textAlign = 'left';
        ctx.fillText(s.label, Math.max(x0 + 4, 4), top / 2 + 1);
      } else if (bw >= 11) {
        ctx.save();
        ctx.translate(x0 + bw / 2, top + 4);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'left';
        const maxLen = plotH - 8;
        let text = s.label;
        while (text.length > 1 && ctx.measureText(text).width > maxLen) text = text.slice(0, -1);
        if (text !== s.label) text = `${text.slice(0, -1)}…`;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }

    // Playhead (live)
    if (playheadS !== null) {
      const px = Math.round(timeToX(view, playheadS)) + 0.5;
      if (px >= 0 && px <= w) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.stroke();
      }
    }

    // Axis
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bottom + 0.5);
    ctx.lineTo(w, bottom + 0.5);
    ctx.stroke();
    ctx.fillStyle = colors.text3;
    ctx.font = `11px ${colors.font}`;
    ctx.textBaseline = 'top';
    for (const t of ticks(view)) {
      const x = Math.round(timeToX(view, t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + 4);
      ctx.stroke();
      const label = formatTime(t);
      ctx.textAlign = x < 16 ? 'left' : x > w - 16 ? 'right' : 'center';
      ctx.fillText(label, x, bottom + 6);
    }
  }

  // ----- interaction -----
  const pointers = new Map<number, { x: number; y: number }>();
  type Gesture =
    | { kind: 'pan'; startX: number; startView: View; moved: boolean; t0: number }
    | { kind: 'pinch'; startView: View; startDist: number; startMid: number };
  let gesture: Gesture | null = null;
  let velocity = 0; // px per ms
  let lastMove = { t: 0, x: 0 };
  let inertia = 0;
  let animation = 0;

  function stopMotion() {
    cancelAnimationFrame(inertia);
    cancelAnimationFrame(animation);
    inertia = 0;
    animation = 0;
  }

  function localX(clientX: number): number {
    return clientX - canvas.getBoundingClientRect().left;
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    gesture = {
      kind: 'pinch',
      startView: view,
      startDist: Math.max(10, Math.abs(a.x - b.x)),
      startMid: localX((a.x + b.x) / 2),
    };
  }

  function onPointerDown(e: PointerEvent) {
    stopMotion();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { kind: 'pan', startX: e.clientX, startView: view, moved: false, t0: performance.now() };
      lastMove = { t: performance.now(), x: e.clientX };
      velocity = 0;
    } else if (pointers.size === 2) {
      startPinch();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.startX;
      if (Math.abs(dx) > 6) gesture.moved = true;
      if (!gesture.moved) return;
      view = panBy(gesture.startView, dx);
      const now = performance.now();
      const dt = now - lastMove.t;
      if (dt > 0) velocity = 0.8 * ((e.clientX - lastMove.x) / dt) + 0.2 * velocity;
      lastMove = { t: now, x: e.clientX };
    } else {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const dist = Math.max(10, Math.abs(a.x - b.x));
      const mid = localX((a.x + b.x) / 2);
      const zoomed = zoomAt(gesture.startView, dist / gesture.startDist, gesture.startMid);
      view = panBy(zoomed, mid - gesture.startMid);
    }
  }

  function onPointerUp(e: PointerEvent, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g?.kind === 'pan' && pointers.size === 0) {
      gesture = null;
      if (!g.moved && !cancelled && performance.now() - g.t0 < 500) {
        const hit = hitSpan(spans, view, localX(e.clientX));
        if (hit) onselect?.(hit.id);
      } else if (g.moved && !cancelled && Math.abs(velocity) > 0.05 && performance.now() - lastMove.t < 80) {
        let v = velocity;
        let last = performance.now();
        const step = () => {
          const now = performance.now();
          const dt = now - last;
          last = now;
          view = panBy(view, v * dt);
          v *= Math.pow(0.995, dt);
          if (Math.abs(v) > 0.02) inertia = requestAnimationFrame(step);
        };
        inertia = requestAnimationFrame(step);
      }
    } else if (g?.kind === 'pinch') {
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        gesture = { kind: 'pan', startX: p!.x, startView: view, moved: true, t0: 0 };
        lastMove = { t: performance.now(), x: p!.x };
      } else if (pointers.size === 0) {
        gesture = null;
      }
    }
  }

  function onWheel(e: WheelEvent) {
    const x = localX(e.clientX);
    if (e.ctrlKey) {
      e.preventDefault();
      view = zoomAt(view, Math.exp(-e.deltaY * 0.01), x);
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      view = panBy(view, -(e.deltaX || e.deltaY));
    }
  }

  function fit() {
    stopMotion();
    view = fitView(durationS, view.widthPx);
  }

  function animateTo(target: View) {
    stopMotion();
    const from = view;
    const t0 = performance.now();
    const dur = 250;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      view = clampView({ ...target, startS: from.startS + (target.startS - from.startS) * e });
      if (k < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  onMount(() => {
    readColors();
    view = fitView(durationS, wrap.clientWidth);
    const ro = new ResizeObserver(() => {
      const width = wrap.clientWidth;
      if (width === view.widthPx) return;
      view = isFit(view) ? fitView(durationS, width) : clampView({ ...view, widthPx: width });
    });
    ro.observe(wrap);
    const prevent = (e: Event) => e.preventDefault();
    canvas.addEventListener('gesturestart', prevent);
    canvas.addEventListener('gesturechange', prevent);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      stopMotion();
      cancelAnimationFrame(raf);
      canvas.removeEventListener('gesturestart', prevent);
      canvas.removeEventListener('gesturechange', prevent);
      canvas.removeEventListener('wheel', onWheel);
    };
  });

  // Refit when the duration changes.
  $effect(() => {
    const d = durationS;
    if (view.widthPx > 0 && d !== view.durationS) view = fitView(d, view.widthPx);
  });

  // Reveal the selected span (selection from the list).
  let lastSelected: string | null = null;
  $effect(() => {
    const id = selectedId;
    if (id === lastSelected) return;
    lastSelected = id;
    const s = spans.find((x) => x.id === id);
    if (!s || view.widthPx <= 0) return;
    const target = revealSpan(view, s.startS, s.endS);
    if (target !== view) animateTo(target);
  });

  // Redraw on any input change.
  $effect(() => {
    void [view, values, available, version, threshold, spans, selectedId, playheadS, height];
    schedule();
  });

  const zoomed = $derived(view.widthPx > 0 && !isFit(view));
</script>

<div class="timeline" bind:this={wrap} style:height="{height}px">
  <span class="visually-hidden">Posture change over time with {spans.length} hold candidates</span>
  <canvas
    bind:this={canvas}
    style:height="{height}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={(e) => onPointerUp(e)}
    onpointercancel={(e) => onPointerUp(e, true)}
    onlostpointercapture={(e) => onPointerUp(e, true)}
  ></canvas>
  {#if zoomed}
    <button class="fit" type="button" onclick={fit} aria-label="Show whole video">Fit</button>
  {/if}
</div>

<style>
  .timeline {
    position: relative;
    width: 100%;
    user-select: none;
    -webkit-user-select: none;
  }

  canvas {
    display: block;
    width: 100%;
    touch-action: pan-y;
  }

  .fit {
    position: absolute;
    top: 0;
    right: 0;
    min-height: var(--touch);
    min-width: var(--touch);
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    color: var(--color-accent-strong);
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
  }
</style>
