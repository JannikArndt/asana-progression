<script lang="ts">
  /** − n + for grid columns on the desktop, where pinching is not at hand. */
  interface Props {
    value: number;
    min: number;
    max: number;
    onchange: (n: number) => void;
  }
  let { value, min, max, onchange }: Props = $props();
</script>

<div class="stepper" role="group" aria-label="Columns">
  <button type="button" aria-label="Fewer columns (larger photos)" title="Fewer columns" disabled={value <= min} onclick={() => onchange(value - 1)}>−</button>
  <span class="tabular" aria-live="polite">{value} columns</span>
  <button type="button" aria-label="More columns (smaller photos)" title="More columns" disabled={value >= max} onclick={() => onchange(value + 1)}>+</button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
    font-size: var(--text-s);
  }
  span {
    min-width: 6.5em;
    text-align: center;
  }
  button {
    width: 36px;
    min-height: 36px;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--color-raised);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
