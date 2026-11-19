<script>
     import "../styles/global.css";
     import Nav from "$lib/Nav.svelte";
     import GlobalFabs from "$lib/GlobalFabs.svelte";
     import SplashScreen from "$lib/SplashScreen.svelte";
     import Spinner from "$lib/Spinner.svelte";
     import { hasSeenSplashScreen, globalLoading } from "$lib/modalStore.js";
     import { debugRenderer } from "$lib/debugStore.js";
     import DebugOverlay from "$lib/DebugOverlay.svelte";
     import { onMount } from "svelte";
     import { afterNavigate } from "$app/navigation";
     import { page } from "$app/stores";
     import { enviarEvento, produtoDaRota } from "$lib/rastroSga.js";
     import { browser } from "$app/environment";
     import { warmupGPU } from "$lib/threeRenderer.js";

     // Começa adapter/device WebGPU + chunk three/webgpu em paralelo com a hidratação
     // (páginas sem 3D não pagam o download do renderer)
     if (browser && !/^\/(loja|metahuman|produtos|hardware)(\/|$)/.test(location.pathname)) warmupGPU();

     // Visita e páginas de serviço abertas viram cliques no SGA Ctrl+B (lib/rastroSga.js).
     onMount(() => enviarEvento($page.data.sga, [{ tipo: "visita" }]));
     afterNavigate(({ to }) => {
          const ev = produtoDaRota(to?.url?.pathname);
          if (ev) enviarEvento($page.data.sga, [ev]);
     });
</script>

{#if !$hasSeenSplashScreen}
     <SplashScreen isLoading={$globalLoading} />
{:else if $globalLoading}
     <Spinner />
{/if}

<Nav />

<GlobalFabs />

<slot />

<DebugOverlay 
     renderer={$debugRenderer.renderer} 
     currentRenderer={$debugRenderer.currentRenderer} 
     tier={$debugRenderer.tier} 
     variant="full" 
/>
