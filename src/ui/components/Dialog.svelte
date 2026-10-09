<script lang="ts">
  import TinyFrame from './TinyFrame.svelte';
  import { dialog } from '../state/dialog.svelte';
</script>

{#if dialog.current}
  {@const d = dialog.current}
  <div class="scrim" role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">{d.title}</h2>
      {#if d.message}<p class="muted">{d.message}</p>{/if}
      {#if d.frames}
        {@const f = d.frames}
        {@const tileW = Math.round(Math.min(96, Math.max(44, (56 * f.width) / f.height)))}
        <ol class="frames" aria-label="Frames of this hold">
          {#each f.items as item, i (i)}
            <li style:width="{tileW}px">
              <TinyFrame videoId={f.videoId} frameWidth={f.width} frameHeight={f.height} index={item.index} alt="Frame at {item.label}" />
              <span class="tabular">{item.label}</span>
            </li>
          {/each}
        </ol>
      {/if}
      <div class="options">
        {#each d.options as o (o.id)}
          <button type="button" class="btn option {o.kind ?? ''}" onclick={() => dialog.answer(o.id)}>
            <span class="label">{o.label}</span>
            {#if o.detail}<span class="detail">{o.detail}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(29, 28, 26, 0.28);
    animation: fade var(--duration) var(--ease);
  }

  .sheet {
    width: 100%;
    max-width: 520px;
    padding: var(--space-5) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
    background: var(--color-bg);
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: calc(100% - var(--safe-top) - var(--space-6));
    overflow-y: auto;
    overscroll-behavior: contain;
    animation: rise var(--duration) var(--ease);
  }

  .frames {
    flex: none;
    display: flex;
    gap: var(--space-1);
    margin: 0 calc(-1 * var(--space-4));
    padding: 0 var(--space-4);
    list-style: none;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scroll-padding-inline: var(--space-4);
    scrollbar-width: none;
  }

  .frames li {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scroll-snap-align: start;
    font-size: var(--text-xs);
    color: var(--color-text-3);
    text-align: center;
  }

  .options {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .option {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-m);
    text-align: center;
  }

  .detail {
    font-size: var(--text-s);
    font-weight: var(--weight-regular);
    opacity: 0.8;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
</style>
