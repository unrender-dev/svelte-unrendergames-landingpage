<script>
  import { fade } from "svelte/transition";
  import { quadOut } from "svelte/easing";

  export let sources = [];
  export let alt = "Media content";
  export let isActive = false;

  let currentIndex = 0;
  let wasActive = false;
  let hasBeenActive = false;

  $: if (isActive && !wasActive) {
    wasActive = true;
    if (hasBeenActive) {
      // Auto switch to next on re-entry
      currentIndex = (currentIndex + 1) % sources.length;
    }
    hasBeenActive = true;
  } else if (!isActive && wasActive) {
    wasActive = false;
  }

  function next(e) {
    e.stopPropagation();
    currentIndex = (currentIndex + 1) % sources.length;
  }

  function prev(e) {
    e.stopPropagation();
    currentIndex = (currentIndex - 1 + sources.length) % sources.length;
  }

  $: currentSrc = sources[currentIndex] || "";
  $: isVideo = currentSrc.endsWith('.webm') || currentSrc.endsWith('.mp4');

</script>

<div class="relative w-full h-full overflow-hidden group">
  {#key currentIndex}
    <div 
      class="absolute inset-0 w-full h-full"
      transition:fade={{ duration: 400, easing: quadOut }}
    >
      {#if isVideo}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
          src={currentSrc}
          autoplay
          loop
          muted
          playsinline
          class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        ></video>
      {:else if currentSrc}
        <img
          src={currentSrc}
          {alt}
          class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      {/if}
    </div>
  {/key}

  <!-- Navigation Arrows (only show if multiple sources) -->
  {#if sources.length > 1}
    <button
      on:click={prev}
      class="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/30 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all opacity-0 group-hover:opacity-100 shadow-lg z-10"
      aria-label="Previous media"
    >
      <svg class="w-4 h-4 md:w-5 md:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <button
      on:click={next}
      class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/30 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all opacity-0 group-hover:opacity-100 shadow-lg z-10"
      aria-label="Next media"
    >
      <svg class="w-4 h-4 md:w-5 md:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
    
    <!-- Dots Indicators -->
    <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
      {#each sources as _, idx}
        <div class="w-1.5 h-1.5 rounded-full transition-all duration-300 {idx === currentIndex ? 'bg-white scale-125' : 'bg-white/50'}"></div>
      {/each}
    </div>
  {/if}
</div>
