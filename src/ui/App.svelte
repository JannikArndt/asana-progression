<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './screens/Home.svelte';
  import Processing from './screens/Processing.svelte';
  import SessionReview from './screens/SessionReview.svelte';
  import AsanaHolds from './screens/AsanaHolds.svelte';
  import { sessionOfVideo } from './state/session-data';
  import Settings from './screens/Settings.svelte';
  import Dialog from './components/Dialog.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import { app } from './state/app.svelte';
  import { router } from './state/router.svelte';
  import { pipeline } from './pipeline/controller.svelte';
  import { updates } from './update.svelte';

  // Old milestone-1 links (#/video/<id>) open the session containing the video.
  $effect(() => {
    const r = router.route;
    if (r.name !== 'video' || !app.ready) return;
    const s = sessionOfVideo(app.sessions, r.id);
    router.go(s ? { name: 'session', id: s.id } : { name: 'home' }, true);
  });

  onMount(() => {
    void app.init();
    updates.addQuietCheck(() => !pipeline.running);
    updates.start();
    void updates.check();
  });
</script>

{#if router.route.name === 'home'}
  <Home tab={router.route.tab ?? (app.holds.length ? 'asanas' : 'sessions')} />
{:else if router.route.name === 'process'}
  <Processing />
{:else if router.route.name === 'session'}
  {#key router.route.id}
    <SessionReview id={router.route.id} />
  {/key}
{:else if router.route.name === 'asana'}
  <AsanaHolds id={router.route.id} />
{:else if router.route.name === 'settings'}
  <Settings />
{/if}

<Dialog />
<UpdateBanner />
