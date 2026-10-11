<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { searchAsanas, nextSide, type Label, type Suggestion } from '../../labeling';
  import { asanaFamilies, familyLetter, type Asana, type SequenceTemplate } from '../../model';

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
  /** Lettered variants among the results read as one asana with letters (like R/L). */
  const families = $derived(asanaFamilies(results));
  const suggestedEntries = $derived(new Set(suggestions.map((s) => s.templateEntryIndex)));
  const nextOnly = $derived(next.filter((l) => !suggestedEntries.has(l.templateEntryIndex)));

  function name(l: Label): string {
    return `${byId.get(l.asanaId)?.name ?? l.asanaId}${l.side ? ` ${l.side}` : ''}`;
  }

  function pick(a: Asana, side: Label['side']) {
    onpick({ asanaId: a.id, side });
  }
</script>

{#snippet sides(a: Asana, text: string)}
  <span class="row static">{text}</span>
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
{/snippet}

<Sheet title="Label" {onclose} fill>
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
    {#each families as f (f.members[0]!.id)}
      {#if f.members.length > 1}
        <li class="row-wrap family"><span class="row static">{f.base}</span></li>
        {#each f.members as a (a.id)}
          <li class="row-wrap member">
            {#if a.sided}
              {@render sides(a, familyLetter(f, a) ?? a.name)}
            {:else}
              <button class="row" type="button" aria-label={a.name} onclick={() => pick(a, null)}>{familyLetter(f, a)}</button>
            {/if}
          </li>
        {/each}
      {:else}
        {@const a = f.members[0]!}
        <li class="row-wrap">
          {#if a.sided}
            {@render sides(a, a.name)}
          {:else}
            <button class="row" type="button" onclick={() => pick(a, null)}>{a.name}</button>
          {/if}
        </li>
      {/if}
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

  /* A family: the base name, then one indented row per letter (no divider in between). */
  .rows > li.family {
    border-bottom: 0;
  }

  .member {
    padding-left: var(--space-5);
  }

  .member .row {
    font-weight: var(--weight-medium);
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
