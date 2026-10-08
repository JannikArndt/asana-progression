<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import { asanaNameError, asanaUsage, newId, uniqueAsanaId, type Asana, type PostureClass } from '../../model';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';

  const POSTURES: Array<{ id: PostureClass | ''; label: string }> = [
    { id: '', label: 'Not set' },
    { id: 'standing', label: 'Standing' },
    { id: 'seated', label: 'Seated' },
    { id: 'lying', label: 'Lying' },
    { id: 'inverted', label: 'Inverted' },
    { id: 'arm-balance', label: 'Arm balance' },
  ];

  interface Draft {
    id: string | null;
    name: string;
    sided: boolean;
    group: string;
    posture: PostureClass | '';
  }
  let draft = $state<Draft | null>(null);
  let error = $state<string | null>(null);

  const groups = $derived.by(() => {
    const out: Array<{ group: string; asanas: Asana[] }> = [];
    for (const a of app.asanas) {
      const g = a.group ?? 'Other';
      const last = out[out.length - 1];
      if (last && last.group === g) last.asanas.push(a);
      else out.push({ group: g, asanas: [a] });
    }
    return out;
  });
  const groupNames = $derived([...new Set(app.asanas.map((a) => a.group).filter((g): g is string => !!g))]);
  const holdCount = $derived.by(() => {
    const m = new Map<string, number>();
    for (const h of app.holds) m.set(h.asanaId, (m.get(h.asanaId) ?? 0) + 1);
    return m;
  });

  function edit(a: Asana | null) {
    error = null;
    draft = a
      ? { id: a.id, name: a.name, sided: a.sided, group: a.group ?? '', posture: a.posture ?? '' }
      : { id: null, name: '', sided: false, group: groupNames[0] ?? '', posture: '' };
  }

  async function save() {
    if (!draft) return;
    error = asanaNameError(draft.name, app.asanas, draft.id ?? undefined);
    if (error) return;
    const asana: Asana = {
      id: draft.id ?? uniqueAsanaId(draft.name, app.asanas.map((a) => a.id)),
      name: draft.name.trim(),
      sided: draft.sided,
      ...(draft.group.trim() ? { group: draft.group.trim() } : {}),
      ...(draft.posture ? { posture: draft.posture } : {}),
    };
    await app.db.asanas.put(asana);
    await app.refreshCatalog();
    draft = null;
  }

  async function remove() {
    if (!draft?.id) return;
    const id = draft.id;
    const usage = asanaUsage(id, app.holds, app.templates);
    if (usage.holds > 0) {
      error = `${usage.holds} labeled ${usage.holds === 1 ? 'hold uses' : 'holds use'} this asana. Relabel them first.`;
      return;
    }
    const inTemplates = usage.templates.map((t) => t.name).join(', ');
    const choice = await dialog.ask({
      title: `Delete ${draft.name}?`,
      ...(inTemplates ? { message: `It is also removed from: ${inTemplates}.` } : {}),
      options: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice !== 'delete') return;
    for (const t of usage.templates) await app.db.templates.put({ ...$state.snapshot(t), entries: t.entries.filter((e) => e.asanaId !== id) });
    await app.db.asanas.delete(id);
    await app.refreshCatalog();
    draft = null;
  }

  async function newTemplate() {
    const t = { id: newId('tpl'), name: 'New template', entries: [] };
    await app.db.templates.put(t);
    await app.refreshCatalog();
    router.go({ name: 'template', id: t.id });
  }
</script>

<main class="catalog">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'settings' })}>‹ Settings</button>
  </header>
  <h2>Catalog</h2>

  <section class="group">
    <div class="section-head">
      <h3 class="section-title">Templates</h3>
      <button class="btn quiet" type="button" onclick={newTemplate}>New template</button>
    </div>
    <p class="muted small">Templates only drive suggestions while labeling. Progression compares asanas, whatever the sequence.</p>
    <ul class="list">
      {#each app.templates as t (t.id)}
        <li>
          <button class="row" type="button" onclick={() => router.go({ name: 'template', id: t.id })}>
            <span>{t.name}</span>
            <span class="muted small tabular">{t.entries.length} entries ›</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <section class="group">
    <div class="section-head">
      <h3 class="section-title">Asanas</h3>
      <button class="btn quiet" type="button" onclick={() => edit(null)}>Add asana</button>
    </div>
    {#each groups as g (g.group)}
      <h4 class="group-name">{g.group}</h4>
      <ul class="list">
        {#each g.asanas as a (a.id)}
          <li>
            <button class="row" type="button" onclick={() => edit(a)}>
              <span>{a.name}{#if a.sided}<span class="badge">R/L</span>{/if}</span>
              <span class="muted small tabular">{holdCount.get(a.id) ?? 0} ›</span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </section>
</main>

{#if draft}
  <Sheet title={draft.id ? 'Edit asana' : 'Add asana'} onclose={() => (draft = null)}>
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label class="field">
        <span>Name</span>
        <input type="text" bind:value={draft.name} autocomplete="off" autocapitalize="words" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.sided} />
        <span>Performed on both sides (right and left)</span>
      </label>
      <label class="field">
        <span>Group</span>
        <input type="text" bind:value={draft.group} list="catalog-groups" autocomplete="off" />
        <datalist id="catalog-groups">
          {#each groupNames as g (g)}<option value={g}></option>{/each}
        </datalist>
      </label>
      <label class="field">
        <span>Posture (helps suggestions)</span>
        <select bind:value={draft.posture}>
          {#each POSTURES as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
        </select>
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button class="btn primary" type="submit">Save</button>
        {#if draft.id}
          <button class="btn danger" type="button" onclick={remove}>Delete</button>
        {/if}
      </div>
    </form>
  </Sheet>
{/if}

<style>
  .catalog {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .top {
    margin: 0 calc(-1 * var(--space-3));
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .small {
    font-size: var(--text-s);
  }

  .group-name {
    margin: var(--space-3) 0 0;
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--radius-m);
    background: var(--color-surface);
    overflow: hidden;
  }

  .list li + li {
    border-top: 1px solid var(--color-hairline);
  }

  .row {
    width: 100%;
    min-height: var(--touch);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .badge {
    margin-left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-accent-strong);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .field input,
  .field select {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    font-size: var(--text-l);
    color: var(--color-text);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch);
  }

  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-accent);
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-s);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
