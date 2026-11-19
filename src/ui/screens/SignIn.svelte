<script lang="ts">
  import { server } from '../state/server.svelte';
  import { passkeysAvailable } from '../webauthn';

  let { onsignedin }: { onsignedin: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let setupToken = $state('');

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await fn();
      onsignedin();
    } catch (e) {
      const err = e as Error;
      // Cancelling the system sheet is not an error worth a red line.
      error = err.name === 'NotAllowedError' ? null : err.message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="signin">
  <div class="mark" aria-hidden="true">
    <img src="./icons/icon-192.png" alt="" width="72" height="72" />
  </div>
  <h1>Asana Progression</h1>

  {#if !passkeysAvailable()}
    <p class="muted">This browser cannot use passkeys.</p>
  {:else if server.hasPasskey}
    <p class="muted">Sign in with your passkey to see your sessions and poses on this device.</p>
    <button class="btn primary wide" type="button" disabled={busy} onclick={() => run(() => server.signIn())}>
      {busy ? 'Signing in…' : 'Sign in with passkey'}
    </button>
  {:else}
    <p class="muted">First start: create the passkey for this app. The setup token is in CapRover (Apps → asana → App Configs → SETUP_TOKEN).</p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void run(() => server.createPasskey(setupToken.trim(), 'First passkey'));
      }}
    >
      <label class="field">
        <span class="small">Setup token</span>
        <input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={setupToken} required />
      </label>
      <button class="btn primary wide" type="submit" disabled={busy || !setupToken.trim()}>{busy ? 'Creating…' : 'Create passkey'}</button>
    </form>
  {/if}
  {#if error}<p class="small error" role="alert">{error}</p>{/if}
</main>

<style>
  .signin {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    gap: var(--space-4);
    padding: calc(var(--space-6) + var(--safe-top)) calc(var(--space-5) + var(--safe-right)) calc(var(--space-6) + var(--safe-bottom))
      calc(var(--space-5) + var(--safe-left));
    max-width: 420px;
    margin: 0 auto;
    text-align: center;
  }
  .mark img {
    border-radius: 16px;
  }
  h1 {
    font-size: var(--text-xl, 1.5rem);
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    text-align: left;
  }
  input {
    min-height: var(--touch);
    font-size: 16px;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    color: inherit;
    padding: 0 var(--space-3);
  }
  .wide {
    width: 100%;
  }
  .small {
    font-size: var(--text-s);
  }
  .error {
    color: var(--color-danger);
  }
</style>
