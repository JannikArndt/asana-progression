<script lang="ts">
  import { dialog } from '../state/dialog.svelte';
</script>

{#if dialog.current}
  {@const d = dialog.current}
  <div class="scrim" role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">{d.title}</h2>
      {#if d.message}<p class="muted">{d.message}</p>{/if}
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
    animation: rise var(--duration) var(--ease);
  }

  .options {
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
