<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { searchAsanas, nextSide, type Label, type Suggestion } from '../../labeling';
  import type { Asana, SequenceTemplate } from '../../model';

  interface Props {
    catalog: Asana[];
    suggestions: Suggestion[];
    /** Next unused template entries after this card (template-next first). */
    next: Label[];
    /** Labels already in the session (for the default side). */
    sessionLabels: Label[];
    template: SequenceTemplate | null;
    onpick: (label: Label) => void;
    onclose: () => void;
  }
  let { catalog, suggestions, next, sessionLabels, onpick, onclose }: Props = $props();

  let query = $state('');
  const byId = $derived(new Map(catalog.map((a) => [a.id, a])));
  const results = $derived(searchAsanas(catalog, query));
  const suggestedEntries = $derived(new Set(suggestions.map((s) => s.templateEntryIndex)));
  const nextOnly = $derived(next.filter((l) => !suggestedEntries.has(l.templateEntryIndex)));

  function name(l: Label): string {
    return `${byId.get(l.asanaId)?.name ?? l.asanaId}${l.side ? ` ${l.side}` : ''}`;
  }

  function pick(a: Asana, side: Label['side']) {
    onpick({ asanaId: a.id, side });
  }
</script>

<Sheet title="Label" {onclose}>
  <input class="search" type="search" placeholder="Search asanas" bind:value={query} autocomplete="off" autocapitalize="off" spellcheck="false" />

  {#if !query}
    {#if suggestions.length}
      <h4 class="section-title">Suggested</h4>
      <div class="chips">
        {#each suggestions as s (`${s.asanaId}-${s.side}-${s.templateEntryIndex}`)}
          <button class="chip" type="button" onclick={() => onpick(s)}>{name(s)}</button>
        {/each}
      </div>
    {/if}
    {#if nextOnly.length}
      <h4 class="section-title">Later in sequence</h4>
      <ul class="rows">
        {#each nextOnly as l (`${l.templateEntryIndex}`)}
          <li><button class="row" type="button" onclick={() => onpick(l)}>{name(l)}</button></li>
        {/each}
      </ul>
    {/if}
    <h4 class="section-title">All asanas</h4>
  {/if}

  <ul class="rows">
    {#each results as a (a.id)}
      <li class="row-wrap">
        {#if a.sided}
          <span class="row static">{a.name}</span>
          <span class="sides">
            {#each ['R', 'L'] as const as side (side)}
              <button
                class="side"
                class:suggested={nextSide(a, sessionLabels) === side}
                type="button"
                aria-label="{a.name} {side === 'R' ? 'right' : 'left'}"
                onclick={() => pick(a, side)}>{side}</button
              >
            {/each}
          </span>
        {:else}
          <button class="row" type="button" onclick={() => pick(a, null)}>{a.name}</button>
        {/if}
      </li>
    {:else}
      <li class="muted empty">No asana matches “{query}”.</li>
    {/each}
  </ul>
</Sheet>

<style>
  .search {
    width: 100%;
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-m);
    background: var(--color-surface);
    font-size: 16px;
    margin-bottom: var(--space-3);
  }

  h4 {
    margin: var(--space-3) 0 var(--space-2);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    color: var(--color-accent-strong);
    font-weight: var(--weight-medium);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row-wrap,
  .rows > li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--color-hairline);
  }

  .row {
    flex: 1;
    min-height: var(--touch);
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .static {
    display: flex;
    align-items: center;
  }

  .sides {
    display: flex;
    gap: var(--space-2);
  }

  .side {
    width: var(--touch);
    height: 36px;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    font-weight: var(--weight-medium);
  }

  .side.suggested {
    border-color: var(--color-accent);
    color: var(--color-accent-strong);
  }

  .empty {
    padding: var(--space-4) 0;
    border: 0;
  }
</style>
