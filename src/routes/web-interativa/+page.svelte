<script>
  import WebInterativaPage from "$lib/WebInterativaPage.svelte";
  import { onMount } from 'svelte';
  import { globalLoading } from '$lib/modalStore.js';

  onMount(() => {
    globalLoading.set(false);
  });
</script>

<WebInterativaPage />
