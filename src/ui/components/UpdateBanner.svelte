<script lang="ts">
  import { updates } from '../update.svelte';
  import { app } from '../state/app.svelte';
  import { dialog } from '../state/dialog.svelte';

  let waiting = $state(false);

  async function apply() {
    if (!updates.isQuiet()) {
      waiting = true;
      return;
    }
    if (app.files.size) {
      const n = app.files.size;
      const choice = await dialog.ask({
        title: 'Update now?',
        message: `The app reloads, and the ${n === 1 ? 'selected video has' : `${n} selected videos have`} to be selected again for stills, clips and poses.`,
        options: [
          { id: 'update', label: 'Update now', kind: 'primary' },
          { id: 'cancel', label: 'Later', kind: 'quiet' },
        ],
      });
      if (choice !== 'update') return;
    }
    waiting = !updates.applyNow();
  }
</script>

{#if updates.available}
  <button class="update" type="button" onclick={apply}>
    {waiting ? 'Update after the current task finishes' : 'Update available'}
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
