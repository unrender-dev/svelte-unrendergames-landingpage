<script>
    import { onMount } from 'svelte';
    import { globalLoading } from '$lib/modalStore.js';
    onMount(() => {
        globalLoading.set(false);
    });
</script>

<svelte:head>
    <title>Metahuman | Unrender</title>
</svelte:head>

<main class="min-h-screen bg-[#0a0a0a] text-white pt-24 pb-12 px-4 md:px-8 flex flex-col items-center justify-center">
    <h1 class="text-4xl md:text-6xl font-bold mb-6 text-[#f99126] text-center uppercase tracking-wider">Metahuman</h1>
    <p class="text-xl text-gray-400 text-center max-w-2xl">Página em construção. Em breve mais novidades!</p>
</main>

<style>
    main {
        font-family: 'Rajdhani', sans-serif;
    }
    h1 {
        font-family: 'Montserrat', sans-serif;
    }
</style>
