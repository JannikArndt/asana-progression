<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    /** Keep the full height while the content changes (search sheets), so the sheet doesn't jump. */
    fill?: boolean;
  }
  let { title, onclose, children, footer, fill = false }: Props = $props();

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
</script>

<div
  class="scrim"
  role="presentation"
  style:top={viewport ? `${viewport.top}px` : null}
  style:height={viewport ? `${viewport.height}px` : null}
  onclick={(e) => e.target === e.currentTarget && onclose()}
>
  <div class="sheet" class:fill role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h3>{title}</h3>
      <button class="btn quiet" type="button" onclick={onclose}>Close</button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
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
    background: rgba(29, 28, 26, 0.28);
    animation: fade var(--duration) var(--ease);
  }

  .sheet {
    width: 100%;
    max-width: 560px;
    max-height: calc(100% - var(--safe-top) - var(--space-6));
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    animation: rise var(--duration) var(--ease);
  }

  .sheet.fill {
    height: calc(100% - var(--safe-top) - var(--space-6));
  }

  .sheet.fill .body {
    flex: 1;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-hairline);
  }

  .body {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  footer {
    padding: var(--space-3) var(--space-4) calc(var(--space-3) + var(--safe-bottom));
    border-top: 1px solid var(--color-hairline);
  }

  .body:last-child {
    padding-bottom: calc(var(--space-4) + var(--safe-bottom));
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(32px);
      opacity: 0;
    }
  }
</style>
