<script lang="ts">
  import { updates } from '../update.svelte';

  let waiting = $state(false);

  function apply() {
    waiting = !updates.applyNow();
  }
</script>

{#if updates.available}
  <button class="update" type="button" onclick={apply}>
    {waiting ? 'Update after processing finishes' : 'Update available'}
  </button>
{/if}

<style>
  .update {
    position: fixed;
    left: 50%;
    bottom: calc(var(--space-4) + var(--safe-bottom));
    transform: translateX(-50%);
    z-index: 30;
    min-height: 36px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    color: var(--color-accent-strong);
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
  }
</style>
