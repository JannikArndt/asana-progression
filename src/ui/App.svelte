<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './screens/Home.svelte';
  import Processing from './screens/Processing.svelte';
  import VideoAnalysis from './screens/VideoAnalysis.svelte';
  import Settings from './screens/Settings.svelte';
  import Dialog from './components/Dialog.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import { app } from './state/app.svelte';
  import { router } from './state/router.svelte';
  import { pipeline } from './pipeline/controller.svelte';
  import { updates } from './update.svelte';

  onMount(() => {
    void app.init();
    updates.addQuietCheck(() => !pipeline.running);
    updates.start();
    void updates.check();
  });
</script>

{#if router.route.name === 'home'}
  <Home />
{:else if router.route.name === 'process'}
  <Processing />
{:else if router.route.name === 'video'}
  <VideoAnalysis id={router.route.id} />
{:else if router.route.name === 'settings'}
  <Settings />
{/if}

<Dialog />
<UpdateBanner />
