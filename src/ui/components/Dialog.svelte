<script lang="ts">
  import Sheet from './Sheet.svelte';
  import TinyFrame from './TinyFrame.svelte';
  import { dialog, dismissOf } from '../state/dialog.svelte';
</script>

<!-- Questions are sheets too: a "cancel" option becomes the header's ✕ (and backdrop tap, swipe down, Escape). -->
{#if dialog.current}
  {@const d = dialog.current}
  {@const dismiss = dismissOf(d)}
  {#key d}
    <Sheet title={d.title} layer="dialog" dismissible={dismiss !== null} onclose={() => dismiss !== null && dialog.answer(dismiss)}>
      <div class="content">
        {#if d.message}<p class="muted message">{d.message}</p>{/if}
        {#if d.frames}
          {@const f = d.frames}
          {@const tileW = Math.round(Math.min(96, Math.max(44, (56 * f.width) / f.height)))}
          <ol class="frames" aria-label="Frames of this hold">
            {#each f.items as item, i (i)}
              <li style:width="{tileW}px">
                <TinyFrame videoId={item.videoId ?? f.videoId} frameWidth={f.width} frameHeight={f.height} index={item.index} alt="Frame at {item.label}" />
                <span class="tabular">{item.label}</span>
              </li>
            {/each}
          </ol>
        {/if}
        <div class="options">
          {#each d.options.filter((o) => o.id !== 'cancel') as o (o.id)}
            <button type="button" class="btn option {o.kind ?? ''}" onclick={() => dialog.answer(o.id)}>
              <span class="label">{o.label}</span>
              {#if o.detail}<span class="detail">{o.detail}</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    </Sheet>
  {/key}
{/if}

<style>
  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .message {
    margin: 0;
    white-space: pre-line;
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
</style>
