<script lang="ts">
  interface Props {
    checked: boolean;
    onchange: (on: boolean) => void;
  }
  let { checked, onchange }: Props = $props();
</script>

<label class="toggle">
  <input type="checkbox" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
  <span>
    Include metadata
    <span class="hint">Recording date and time, place (GPS), camera, pose name and a link to the app. Off: nothing but the image, for sharing.</span>
  </span>
</label>

<style>
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-height: var(--touch);
    padding: var(--space-2) 0;
    font-size: var(--text-s);
  }

  input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 2px 0 0;
    accent-color: var(--color-accent);
  }

  span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-2);
  }
</style>
