<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './screens/Home.svelte';
  import Processing from './screens/Processing.svelte';
  import SessionReview from './screens/SessionReview.svelte';
  import SessionVideos from './screens/SessionVideos.svelte';
  import SessionPoses from './screens/SessionPoses.svelte';
  import ImproveCrops from './screens/ImproveCrops.svelte';
  import AsanaProgression from './screens/AsanaProgression.svelte';
  import Catalog from './screens/Catalog.svelte';
  import TemplateEditor from './screens/TemplateEditor.svelte';
  import DetectionLab from './screens/DetectionLab.svelte';
  import { sessionOfVideo } from './state/session-data';
  import Settings from './screens/Settings.svelte';
  import Dialog from './components/Dialog.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import { app } from './state/app.svelte';
  import { router } from './state/router.svelte';
  import { pipeline } from './pipeline/controller.svelte';
  import { capture } from './state/capture.svelte';
  import { backup } from './state/backup.svelte';
  import { research } from './state/research.svelte';
  import { cropExport } from './state/crop-export.svelte';
  import { updates } from './update.svelte';
  import SignIn from './screens/SignIn.svelte';
  import { server } from './state/server.svelte';

  // Old milestone-1 links (#/video/<id>) open the session containing the video.
  $effect(() => {
    const r = router.route;
    if (r.name !== 'video' || !app.ready) return;
    const s = sessionOfVideo(app.sessions, r.id);
    router.go(s ? { name: 'session', id: s.id } : { name: 'home' }, true);
  });

  let started = false;
  async function startApp() {
    if (started) return;
    started = true;
    await app.init((db) => server.beforeSeed(db));
    if (!app.ready) return;
    // Stills cropped by an older crop version get a new automatic crop in the background.
    capture.recropStale(app.holds);
    server.start(app.db, (r) => void app.applyRemote(r.analyses));
  }

  onMount(() => {
    // Server mode needs a sign-in before the first load (the server's data comes in first).
    void server.detect().then(() => {
      if (!server.needsSignIn) void startApp();
    });
    updates.addQuietCheck(() => !pipeline.running);
    updates.addQuietCheck(() => !capture.busy);
    // A prepared backup file would be lost, e.g. while the share sheet hides the page.
    updates.addQuietCheck(() => !backup.exporting && !backup.importing && !backup.ready);
    updates.addQuietCheck(() => !research.busy && !research.ready);
    updates.addQuietCheck(() => !cropExport.preparing && !cropExport.ready);
    updates.addQuietCheck(() => !server.syncing);
    // Selected video files are lost on reload: switching to Photos to find the next file hides the page.
    updates.addHiddenCheck(() => app.files.size === 0);
    updates.start();
    void updates.check();
  });
</script>

{#if !server.checked}
  <!-- detecting the server -->
{:else if server.needsSignIn}
  <SignIn onsignedin={() => void startApp()} />
{:else if router.route.name === 'home'}
  <Home tab={router.route.tab ?? (app.holds.length ? 'asanas' : 'sessions')} />
{:else if router.route.name === 'process'}
  <Processing />
{:else if router.route.name === 'session'}
  {#key router.route.id}
    <SessionReview id={router.route.id} />
  {/key}
{:else if router.route.name === 'session-videos'}
  {#key router.route.id}
    <SessionVideos id={router.route.id} />
  {/key}
{:else if router.route.name === 'session-poses'}
  {#key router.route.id}
    <SessionPoses id={router.route.id} />
  {/key}
{:else if router.route.name === 'session-crops'}
  {#key router.route.id}
    <ImproveCrops id={router.route.id} />
  {/key}
{:else if router.route.name === 'asana'}
  {#key router.route.id}<AsanaProgression id={router.route.id} />{/key}
{:else if router.route.name === 'catalog'}
  <Catalog />
{:else if router.route.name === 'template'}
  {#key router.route.id}<TemplateEditor id={router.route.id} />{/key}
{:else if router.route.name === 'settings'}
  <Settings />
{:else if router.route.name === 'lab'}
  <DetectionLab />
{/if}

<Dialog />
<UpdateBanner />
