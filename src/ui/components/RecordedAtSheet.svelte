<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import type { Video } from '../../model';
  import { app } from '../state/app.svelte';
  import { datetimeInputValue, recordedAtFromInput } from '../state/session-data';

  interface Props {
    video: Video;
    onclose: () => void;
  }
  let { video, onclose }: Props = $props();

  /**
   * Sets a video's recording time by hand, e.g. when the file only carries an export or re-encode
   * time: Photos searches by the recording date (the one Photos shows for the video).
   */
  let value = $state(untrack(() => datetimeInputValue(video.recordedAt)));
  const next = $derived(recordedAtFromInput(value, video.recordedAt));

  async function save() {
    const at = next;
    const id = video.id;
    if (!at) return;
    await app.setRecordedAt(id, at, 'manual');
    onclose();
  }
</script>

<Sheet title="Recording time" {onclose} action={{ label: 'Save', form: 'recorded-at-form', disabled: !next }}>
  <form
    id="recorded-at-form"
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <label class="field">
      <span>{video.fileName}</span>
      <input type="datetime-local" bind:value required />
    </label>
    <p class="muted small">The date Photos shows for this video. Searching Photos for it finds the video; the session takes it too.</p>
  </form>
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .field input {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-m);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-m);
  }

  .small {
    font-size: var(--text-s);
  }

  .form p {
    margin: 0;
  }
</style>
