<script>
  import { spring } from "svelte/motion";
  import { scale, blur, fly } from "svelte/transition";
  import { onMount } from "svelte";

  let isToggled = false;
  let isVisible = true;
  let isStaggerOpen = false;
  let isExploded = false;
  let voxelOffset = 6;
  let voxelSize = 5;

  // Wait 1.5s then respawn ghost
  $: if (!isVisible) {
    setTimeout(() => {
      isVisible = true;
    }, 1500);
  }

  // Handle window resize for voxelOffset
  function handleResize() {
    if (window.innerWidth <= 400) {
      voxelOffset = 4;
      voxelSize = 3;
    } else if (window.innerWidth <= 600) {
      voxelOffset = 5;
      voxelSize = 4;
    } else {
      voxelOffset = 6;
      voxelSize = 5;
    }
  }

  onMount(() => {
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  });

  import VoxelCube from "./VoxelCube.svelte";

  // For the slider (gear)
  let sliderX = spring(0, { stiffness: 0.1, damping: 0.5 });
  let trackRef;
  let gearRef;
  let isDragging = false;
  let startX = 0;
  let startSliderX = 0;

  function onPointerDown(e) {
    isDragging = true;
    startX = e.clientX;
    startSliderX = $sliderX;
    gearRef.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    let dx = e.clientX - startX;
    let newX = startSliderX + dx;
    // clamp between -60 and 60 roughly
    if (newX < -60) newX = -60;
    if (newX > 60) newX = 60;
    sliderX.set(newX, { hard: true });
  }

  function onPointerUp(e) {
    isDragging = false;
    gearRef.releasePointerCapture(e.pointerId);
    // snap back to 0 or leave it?
    // sliderX.set(0); 
  }

  // Free drag object (arrows)
  let dragXY = spring({ x: 0, y: 0 }, { stiffness: 0.1, damping: 0.5 });
  let isFreeDragging = false;
  let startFreeX = 0;
  let startFreeY = 0;
  let startDragXY = { x: 0, y: 0 };
  let freeDragRef;

  function onFreePointerDown(e) {
    isFreeDragging = true;
    startFreeX = e.clientX;
    startFreeY = e.clientY;
    startDragXY = { ...$dragXY };
    freeDragRef.setPointerCapture(e.pointerId);
  }
  function onFreePointerMove(e) {
    if (!isFreeDragging) return;
    let dx = e.clientX - startFreeX;
    let dy = e.clientY - startFreeY;
    dragXY.set({ x: startDragXY.x + dx, y: startDragXY.y + dy }, { hard: true });
  }
  function onFreePointerUp(e) {
    isFreeDragging = false;
    freeDragRef.releasePointerCapture(e.pointerId);
    dragXY.set({ x: 0, y: 0 }); // snap back
  }

  // Derived styling for the slider
  $: sliderColor = $sliderX < 0 
    ? interpolateColor("#7700ff", "#ff0088", $sliderX / -60)
    : interpolateColor("#7700ff", "#00ccff", $sliderX / 60);

  $: sliderRotate = ($sliderX / 60) * 180;

  // Simple hex interpolator
  function interpolateColor(c1, c2, factor) {
    let hex1 = parseInt(c1.slice(1), 16);
    let hex2 = parseInt(c2.slice(1), 16);
    let r1 = (hex1 >> 16) & 255, g1 = (hex1 >> 8) & 255, b1 = hex1 & 255;
    let r2 = (hex2 >> 16) & 255, g2 = (hex2 >> 8) & 255, b2 = hex2 & 255;
    let r = Math.round(r1 + (r2 - r1) * factor);
    let g = Math.round(g1 + (g2 - g1) * factor);
    let b = Math.round(b1 + (b2 - b1) * factor);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
</svelte:head>

<div class="web-interativa-root">
  <div class="container">
    <div class="buttons-grid">
      <!-- 1. Hover, Tap, Rotate -->
      <div class="shape hover-rotate" style="background-color: #ff0088;">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
      </div>

      <!-- 2. Free Drag -->
      <div 
        class="shape free-drag" 
        style="background-color: #00ccff; border-radius: 50%; transform: translate({$dragXY.x}px, {$dragXY.y}px) scale({isFreeDragging ? 1.1 : 1}); cursor: {isFreeDragging ? 'grabbing' : 'grab'}; z-index: {isFreeDragging ? 100 : 1};"
        bind:this={freeDragRef}
        on:pointerdown|preventDefault={onFreePointerDown}
        on:pointermove|preventDefault={onFreePointerMove}
        on:pointerup|preventDefault={onFreePointerUp}
      >
        <i class="fa-solid fa-arrows-up-down-left-right"></i>
      </div>

      <!-- 3. Wobble Keyframes -->
      <div class="shape wobble" style="background-color: #ffaa00;">
        <i class="fa-solid fa-bell"></i>
      </div>

      <!-- 4. Bouncing Toggle -->
      <div class="toggle-container" style="justify-content: {isToggled ? 'flex-end' : 'flex-start'}; background-color: {isToggled ? 'rgba(0, 255, 170, 0.85)' : 'rgba(255,255,255,0.1)'};" on:click={() => isToggled = !isToggled}>
        <div class="toggle-handle">
          {#if isToggled}
            <i class="fa-solid fa-check" in:scale out:scale></i>
          {:else}
            <i class="fa-solid fa-minus" in:scale out:scale></i>
          {/if}
        </div>
      </div>

      <div class="flex-break"></div>

      <!-- 5. Enter / Exit Component -->
      <div class="exit-wrapper">
        {#if isVisible}
          <div 
            class="shape exit-shape" 
            style="background-color: #8800ff;"
            in:fly={{ y: 20, duration: 400 }}
            out:blur={{ amount: 10, duration: 400 }}
            on:click={() => isVisible = false}
          >
            <i class="fa-solid fa-ghost"></i>
          </div>
        {/if}
      </div>

      <!-- 7. Interactive 3D Voxel Cube -->
      <div class="shape voxel-container" on:click={() => { if (!isExploded) { isExploded = true; setTimeout(() => isExploded = false, 1500); }}}>
        <VoxelCube {voxelOffset} {voxelSize} {isExploded} />
      </div>

      <!-- 7.5 Hamburger Menu -->
      <div class="stagger-wrapper">
        {#if isStaggerOpen}
          <div class="stagger-container">
            <div class="stagger-item" in:fly={{ y: 20, delay: 0 }} out:fly={{ y: 20, delay: 100 }}><i class="fa-solid fa-gamepad"></i></div>
            <div class="stagger-item" in:fly={{ y: 20, delay: 50 }} out:fly={{ y: 20, delay: 50 }}><i class="fa-solid fa-headphones"></i></div>
            <div class="stagger-item" in:fly={{ y: 20, delay: 100 }} out:fly={{ y: 20, delay: 0 }}><i class="fa-solid fa-music"></i></div>
          </div>
        {/if}

        <div class="shape burger {isStaggerOpen ? 'open' : ''}" style="background-color: {isStaggerOpen ? '#cc0000' : '#ff0000'};" on:click={() => isStaggerOpen = !isStaggerOpen}>
          <svg width="65%" height="65%" viewBox="0 0 50 50">
            <path stroke="white" stroke-width="4" stroke-linecap="round" d={isStaggerOpen ? "M 15 15 L 35 35" : "M 10 15 L 40 15"} class="burger-path" />
            <path stroke="white" stroke-width="4" stroke-linecap="round" d={isStaggerOpen ? "M 25 25 L 25 25" : "M 10 25 L 40 25"} style="opacity: {isStaggerOpen ? 0 : 1};" class="burger-path" />
            <path stroke="white" stroke-width="4" stroke-linecap="round" d={isStaggerOpen ? "M 15 35 L 35 15" : "M 10 35 L 40 35"} class="burger-path" />
          </svg>
        </div>
      </div>
    </div>

    <!-- 8. Fixed Dynamic Drag Slider -->
    <div class="drag-track" bind:this={trackRef}>
      <div 
        class="shape gear"
        style="
          width: var(--gear-size); height: var(--gear-size); border-radius: 50%;
          transform: translateX({$sliderX}px) rotate({sliderRotate}deg) scale({isDragging ? 1.1 : 1});
          background-color: {sliderColor};
          font-size: calc(var(--shape-font-size) * 0.8);
          box-shadow: 0 2px 10px rgba(0,0,0,0.5);
          cursor: {isDragging ? 'grabbing' : 'grab'};
        "
        bind:this={gearRef}
        on:pointerdown|preventDefault={onPointerDown}
        on:pointermove|preventDefault={onPointerMove}
        on:pointerup|preventDefault={onPointerUp}
      >
        <i class="fa-solid fa-gear"></i>
      </div>
    </div>
  </div>
</div>

<style>
  .web-interativa-root {
    --container-gap: 24px;
    --shape-size: 60px;
    --shape-border-radius: 16px;
    --shape-font-size: 24px;
    --toggle-w: 90px;
    --toggle-h: 46px;
    --toggle-handle-size: 38px;
    --exit-size: 70px;
    --stagger-item-size: 40px;
    --stagger-top: -60px;
    --stagger-gap: 16px;
    --drag-track-w: 160px;
    --drag-track-h: 52px;
    --gear-size: 44px;
    --voxel-size: 5px;
    --voxel-translate: 2.5px;

    /* Padding and animation offset variables to prevent clipped content */
    --container-padding-top: 32px;
    --container-padding-bottom: 20px;
    --container-padding-side: 20px;
    --wobble-translate: -20px;

    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    box-sizing: border-box;
  }

  @media (max-width: 600px) {
    .web-interativa-root {
      --container-gap: 16px;
      --shape-size: 44px;
      --shape-border-radius: 12px;
      --shape-font-size: 18px;
      --toggle-w: 72px;
      --toggle-h: 38px;
      --toggle-handle-size: 30px;
      --exit-size: 55px;
      --stagger-item-size: 32px;
      --stagger-top: -50px;
      --stagger-gap: 10px;
      --drag-track-w: 130px;
      --drag-track-h: 44px;
      --gear-size: 36px;
      --voxel-size: 4px;
      --voxel-translate: 2px;

      --container-padding-top: 24px;
      --container-padding-bottom: 16px;
      --container-padding-side: 16px;
      --wobble-translate: -15px;
    }
  }

  @media (max-width: 400px) {
    .web-interativa-root {
      --container-gap: 10px;
      --shape-size: 34px;
      --shape-border-radius: 8px;
      --shape-font-size: 14px;
      --toggle-w: 58px;
      --toggle-h: 30px;
      --toggle-handle-size: 24px;
      --exit-size: 42px;
      --stagger-item-size: 26px;
      --stagger-top: -42px;
      --stagger-gap: 8px;
      --drag-track-w: 100px;
      --drag-track-h: 34px;
      --gear-size: 28px;
      --voxel-size: 3px;
      --voxel-translate: 1.5px;

      --container-padding-top: 20px;
      --container-padding-bottom: 12px;
      --container-padding-side: 12px;
      --wobble-translate: -10px;
    }
  }

  .container {
    display: flex;
    flex-direction: column;
    gap: var(--container-gap);
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    padding: var(--container-padding-top, 32px) var(--container-padding-side, 20px) var(--container-padding-bottom, 20px);
    box-sizing: border-box;
  }

  .buttons-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--container-gap);
    justify-content: center;
    align-items: center;
    width: 100%;
    max-width: 100%;
  }

  .flex-break {
    flex-basis: 100%;
    height: 0;
  }

  @media (max-width: 600px) {
    .buttons-grid {
      display: grid;
      grid-template-columns: repeat(4, auto);
      grid-template-rows: repeat(2, auto);
    }
    .flex-break {
      display: none;
    }
  }

  .shape {
    width: var(--shape-size);
    height: var(--shape-size);
    border-radius: var(--shape-border-radius);
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
    font-size: var(--shape-font-size);
    transition: transform 0.2s, border-radius 0.2s;
    user-select: none;
    -webkit-user-select: none;
  }

  /* 1. Hover, Rotate */
  .hover-rotate:hover {
    transform: scale(1.2) rotate(90deg);
  }
  .hover-rotate:active {
    transform: scale(0.8) rotate(-90deg);
    border-radius: 50%;
  }

  /* 3. Wobble */
  @keyframes wobble {
    0% { transform: rotate(0deg) translateY(0px); }
    20% { transform: rotate(-20deg) translateY(var(--wobble-translate, -25px)); }
    50% { transform: rotate(20deg) translateY(0px); }
    80% { transform: rotate(-20deg) translateY(var(--wobble-translate, -25px)); }
    100% { transform: rotate(0deg) translateY(0px); }
  }
  .wobble {
    animation: wobble 2s ease-in-out infinite;
  }

  /* 4. Toggle */
  .toggle-container {
    width: var(--toggle-w);
    height: var(--toggle-h);
    border-radius: 50px;
    display: flex;
    align-items: center;
    padding: 4px;
    cursor: pointer;
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.5);
    transition: background-color 0.3s ease;
  }
  .toggle-handle {
    width: var(--toggle-handle-size);
    height: var(--toggle-handle-size);
    background-color: white;
    border-radius: 50%;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
    display: flex;
    justify-content: center;
    align-items: center;
    color: #333;
    font-size: calc(var(--shape-font-size) * 0.8);
    position: relative;
  }
  .toggle-handle i {
    position: absolute;
  }

  /* 5. Exit wrapper */
  .exit-wrapper {
    width: var(--exit-size);
    height: var(--exit-size);
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .exit-shape:active {
    transform: scale(0.9);
  }



  /* 7. Voxel Cube */
  .voxel-container {
    position: relative;
    background-color: #222;
    border: 2px solid #555;
    perspective: 300px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .voxel-container:hover {
    transform: scale(1.15);
    border-color: #f99126;
    box-shadow: 0 0 20px rgba(249, 145, 38, 0.5);
  }
  .voxel-container:active {
    transform: scale(0.95);
  }

  /* 7.5 Hamburger Stagger */
  .stagger-wrapper {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .stagger-container {
    position: absolute;
    top: var(--stagger-top);
    display: flex;
    gap: var(--stagger-gap);
    pointer-events: none;
    z-index: 50;
  }
  .stagger-item {
    width: var(--stagger-item-size);
    height: var(--stagger-item-size);
    background: rgba(0, 255, 170, 0.85);
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    color: #121212;
    font-size: calc(var(--shape-font-size) * 0.8);
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
  }
  .burger {
    transition: background-color 0.3s;
  }
  .burger:active {
    transform: scale(0.9);
  }
  .burger-path {
    transition: d 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
  }

  /* 8. Drag track */
  .drag-track {
    width: var(--drag-track-w);
    height: var(--drag-track-h);
    background: rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: inset 0 5px 15px rgba(0, 0, 0, 0.3);
    touch-action: none;
  }
</style>
