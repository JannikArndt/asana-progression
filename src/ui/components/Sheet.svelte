<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, onclose, children, footer }: Props = $props();
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
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
    max-height: calc(100dvh - var(--safe-top) - var(--space-6));
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    animation: rise var(--duration) var(--ease);
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
