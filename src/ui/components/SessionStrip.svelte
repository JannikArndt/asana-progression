<script lang="ts" module>
  import type { Session } from '../../model';

  export interface StripItem {
    key: string;
    /** Accessible name (date, or First / Latest). */
    label: string;
    /** Shown in the cell when there is no session (First / Latest). */
    text?: string;
    session?: Session;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    items: StripItem[];
    selected: string;
    onselect: (key: string) => void;
    thumb: Snippet<[Session]>;
  }
  let { items, selected, onselect, thumb }: Props = $props();

  /** Cell (48 px) + gap (8 px). The padding centres cell i at scrollLeft = i × STEP. */
  const STEP = 56;
  let el = $state<HTMLDivElement>();
  let programmatic = false;
  let idle = 0;
  let animate = false;

  const index = $derived(Math.max(0, items.findIndex((i) => i.key === selected)));

  function nearest(): number {
    return el ? Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / STEP))) : 0;
  }

  function settle() {
    clearTimeout(idle);
    idle = window.setTimeout(() => (programmatic = false), 160);
  }

  // Follow the selection (taps, the toolbar arrows, the list); the finger's own scrolling already is there.
  $effect(() => {
    const i = index;
    void items.length;
    if (!el) return;
    if (nearest() === i) {
      animate = true;
      return;
    }
    programmatic = true;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * STEP, behavior: animate && !reduced ? 'smooth' : 'instant' });
    animate = true;
    settle();
  });

  let gone = false;
  $effect(() => () => {
    gone = true;
    clearTimeout(idle);
  });

  /** Scrubbing: the cell in the middle is the selection, live while the strip moves. */
  function onscroll() {
    // Tearing the strip down clamps scrollLeft to 0: that is no choice of "First".
    if (gone || !el?.isConnected) return;
    if (programmatic) return settle();
    const item = items[nearest()];
    if (item && item.key !== selected) onselect(item.key);
  }
</script>

<div class="strip" bind:this={el} {onscroll} role="group" aria-label="Show photos from">
  {#each items as item (item.key)}
    <button
      type="button"
      class="cell"
      class:on={item.key === selected}
      class:text={!item.session}
      aria-pressed={item.key === selected}
      aria-label={item.label}
      title={item.label}
      onclick={() => onselect(item.key)}
    >
      {#if item.session}{@render thumb(item.session)}{:else}{item.text ?? item.label}{/if}
    </button>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    padding: 6px calc(50% - 24px);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  }

  .strip::-webkit-scrollbar {
    display: none;
  }

  .cell {
    flex: none;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--color-neutral-tint);
    scroll-snap-align: center;
    transition:
      transform var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .cell.text {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-2);
  }

  .cell.on {
    transform: scale(1.08);
    box-shadow:
      0 0 0 2px var(--color-bg),
      0 0 0 4px var(--color-accent);
  }

  .cell :global(.lazy),
  .cell :global(.frame),
  .cell :global(.tiny) {
    height: 100%;
    border-radius: 0;
  }

  .cell :global(.tiny canvas) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (prefers-reduced-motion: reduce) {
    .cell {
      transition: none;
    }
  }
</style>
