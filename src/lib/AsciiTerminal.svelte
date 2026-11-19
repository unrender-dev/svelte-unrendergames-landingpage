<script>
  import { onMount, onDestroy } from "svelte";

  export let src = "/json/ascii-frames.json";
  export let isActive = false;

  let frames = [];
  let currentFrameIndex = 0;
  let interval;
  let containerWidth = 0;
  let containerHeight = 0;

  // Window states
  let isClosed = false;

  $: if (isActive) {
    isClosed = false;
  }

  $: fontSize = containerWidth && containerHeight 
    ? Math.min(containerWidth / 105, containerHeight / 105) 
    : 4;

  onMount(async () => {
    try {
      const res = await fetch(src);
      frames = await res.json();
      if (frames.length > 0) {
        interval = setInterval(() => {
          currentFrameIndex = (currentFrameIndex + 1) % frames.length;
        }, 1000 / 12);
      }
    } catch (e) {
      console.error("Failed to load ascii frames", e);
    }
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });
</script>

<div class="w-full h-full relative" style="contain: layout;">
  {#if isClosed && isActive}
    <div class="absolute inset-0 flex items-center justify-center cursor-pointer z-50 pointer-events-auto" on:click={() => { isClosed = false; }}>
       <div class="flex flex-col items-center gap-3 transition-transform hover:scale-110">
          <div class="w-20 h-20 bg-black/60 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-2xl hover:bg-black/80">
            <svg class="w-10 h-10 text-[#f99126]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="square" stroke-linejoin="miter" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span class="text-white font-sans text-sm font-bold tracking-widest bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm border border-white/10 shadow-lg">Terminal.exe</span>
       </div>
    </div>
  {/if}

  {#if !isClosed && isActive}
    <div class="absolute inset-0 z-50 flex flex-col font-mono rounded-3xl overflow-hidden border border-white/20 shadow-2xl pointer-events-auto bg-transparent">
      
      <!-- Terminal Header -->
      <div class="h-8 bg-[#f99126]/90 backdrop-blur-md flex items-center px-4 space-x-2 shrink-0 border-b border-white/20 relative">
        <div class="flex space-x-2 z-10">
          <!-- Close Button Only -->
          <button class="w-3.5 h-3.5 rounded-full bg-[#ff5f56] hover:bg-red-400 transition-colors shadow-sm" on:click|stopPropagation={() => isClosed = true}></button>
        </div>
        <div class="absolute inset-0 flex items-center justify-center text-black/80 text-[11px] font-sans font-bold tracking-wide pointer-events-none drop-shadow-sm">
          <svg class="w-3 h-3 mr-1.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          root@unrender: ~/servicos
        </div>
      </div>
      
      <!-- Content -->
      <div class="flex-1 relative bg-transparent overflow-hidden">
        <div class="absolute inset-0 p-4 flex items-center justify-center" bind:clientWidth={containerWidth} bind:clientHeight={containerHeight}>
          {#if frames.length > 0}
            <pre 
              class="whitespace-pre text-center text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] font-mono" 
              style="font-size: {Math.max(2, fontSize)}px; line-height: {Math.max(2, fontSize)}px;"
            >{#each frames[currentFrameIndex] as line}{line}
{/each}</pre>
          {:else}
            <div class="text-white animate-pulse text-xs tracking-widest flex items-center justify-center h-full gap-2 drop-shadow-lg">
              <div class="w-2 h-4 bg-white animate-ping"></div>
              LOADING PROTOCOL.SH...
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
