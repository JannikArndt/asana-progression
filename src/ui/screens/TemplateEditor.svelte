<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import { copyName, entriesFor, moveItem, newId, type Asana, type SequenceTemplate } from '../../model';
  import { searchAsanas } from '../../labeling';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const template = $derived(app.templates.find((t) => t.id === id));
  const nameOf = $derived(new Map(app.asanas.map((a) => [a.id, a.name])));
  let selected = $state<number | null>(null);
  let adding = $state(false);
  let query = $state('');
  let sides = $state<'both' | 'R' | 'L'>('both');
  const results = $derived(searchAsanas(app.asanas, query).slice(0, 40));

  async function save(next: SequenceTemplate) {
    await app.db.templates.put($state.snapshot(next) as SequenceTemplate);
    await app.refreshCatalog();
  }

  async function rename(name: string) {
    const n = name.trim();
    if (!template || !n || n === template.name) return;
    await save({ ...template, name: n });
  }

  async function move(i: number, delta: number) {
    if (!template) return;
    const entries = moveItem(template.entries, i, i + delta);
    if (entries === template.entries) return;
    selected = i + delta;
    await save({ ...template, entries });
  }

  async function removeAt(i: number) {
    if (!template) return;
    selected = null;
    await save({ ...template, entries: template.entries.filter((_, j) => j !== i) });
  }

  async function add(a: Asana) {
    if (!template) return;
    const at = selected === null ? template.entries.length : selected + 1;
    const added = entriesFor(a, sides);
    const entries = [...template.entries.slice(0, at), ...added, ...template.entries.slice(at)];
    selected = at + added.length - 1;
    await save({ ...template, entries });
  }

  async function duplicate() {
    if (!template) return;
    const copy = { ...template, id: newId('tpl'), name: copyName(template.name, app.templates.map((t) => t.name)) };
    await save(copy);
    router.go({ name: 'template', id: copy.id }, true);
  }

  async function remove() {
    if (!template) return;
    const used = app.sessions.filter((s) => s.templateId === template.id).length;
    const choice = await dialog.ask({
      title: `Delete ${template.name}?`,
      message: used
        ? `${used} ${used === 1 ? 'session uses' : 'sessions use'} it; they keep their labels and get suggestions without a template.`
        : 'Labels are not affected.',
      options: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice !== 'delete') return;
    await app.db.templates.delete(template.id);
    await app.refreshCatalog();
    router.go({ name: 'catalog' }, true);
  }
</script>

<main class="template">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'catalog' })}>‹ Catalog</button>
  </header>
  {#if template}
    <label class="name">
      <span class="visually-hidden">Template name</span>
      <input type="text" value={template.name} onchange={(e) => rename(e.currentTarget.value)} />
    </label>
    <p class="muted small">{template.entries.length} entries · tap an entry to insert after it.</p>

    <ol class="entries">
      {#each template.entries as e, i (i)}
        <li class:on={selected === i}>
          <button class="entry" type="button" onclick={() => (selected = selected === i ? null : i)} aria-pressed={selected === i}>
            <span class="num tabular">{i + 1}</span>
            <span class="label">{nameOf.get(e.asanaId) ?? e.asanaId}{e.side ? ` ${e.side}` : ''}</span>
          </button>
          {#if selected === i}
            <span class="tools">
              <button class="icon" type="button" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button class="icon" type="button" onclick={() => move(i, 1)} disabled={i === template.entries.length - 1} aria-label="Move down">↓</button>
              <button class="icon" type="button" onclick={() => removeAt(i)} aria-label="Remove entry">✕</button>
            </span>
          {/if}
        </li>
      {:else}
        <li class="muted">No entries yet.</li>
      {/each}
    </ol>

    <div class="actions">
      <button class="btn primary" type="button" onclick={() => (adding = true)}>{selected === null ? 'Add asanas' : `Insert after ${selected + 1}`}</button>
      <button class="btn" type="button" onclick={duplicate}>Duplicate</button>
      <button class="btn danger" type="button" onclick={remove}>Delete</button>
    </div>
  {:else if app.ready}
    <p class="muted">Unknown template.</p>
  {/if}
</main>

{#if adding && template}
  <Sheet title="Add asanas" onclose={() => (adding = false)}>
    <div class="picker">
      <input type="search" placeholder="Search asanas" bind:value={query} autocomplete="off" />
      <div class="segmented" role="radiogroup" aria-label="Sides for sided asanas">
        {#each [['both', 'R then L'], ['R', 'R only'], ['L', 'L only']] as const as [value, text] (value)}
          <button type="button" role="radio" aria-checked={sides === value} class:on={sides === value} onclick={() => (sides = value)}>{text}</button>
        {/each}
      </div>
      <ul class="results">
        {#each results as a (a.id)}
          <li>
            <button class="row" type="button" onclick={() => add(a)}>
              <span>{a.name}</span>
              <span class="muted small">{a.sided ? (sides === 'both' ? '+ R, L' : `+ ${sides}`) : '+'}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </Sheet>
{/if}

<style>
  .template {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .top {
    margin: 0 calc(-1 * var(--space-3));
  }

  .name input {
    width: 100%;
    min-height: var(--touch);
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: transparent;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .name input:focus {
    border-color: var(--color-hairline);
    background: var(--color-surface);
  }

  .small {
    font-size: var(--text-s);
  }

  .entries,
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--radius-m);
    background: var(--color-surface);
    overflow: hidden;
  }

  .entries li {
    display: flex;
    align-items: center;
  }

  .entries li + li,
  .results li + li {
    border-top: 1px solid var(--color-hairline);
  }

  .entries li.on {
    background: var(--color-accent-tint);
  }

  .entries li.muted {
    padding: var(--space-3) var(--space-4);
  }

  .entry,
  .row {
    flex: 1;
    width: 100%;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .row {
    justify-content: space-between;
  }

  .num {
    min-width: 2em;
    color: var(--color-text-3);
    font-size: var(--text-s);
  }

  .tools {
    display: flex;
  }

  .icon {
    min-width: var(--touch);
    min-height: var(--touch);
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-l);
  }

  .icon:disabled {
    opacity: 0.3;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .picker input {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    font-size: var(--text-l);
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .segmented button {
    min-height: 40px;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .segmented button.on {
    background: var(--color-surface);
    color: var(--color-text);
  }
</style>
