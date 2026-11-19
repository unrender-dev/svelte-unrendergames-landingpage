<script>
  import { onMount, onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";

  export let src = "/images/gamificacao.mp4";
  export let active = true;

  let videoElement;
  let videoState = "playing"; // 'playing', 'waiting', 'answered'
  let selectedOption = null;
  let resetTimeout;

  const options = ["1 minuto", "15 minutos", "45 minutos", "quanto quiser"];
  const correctIndex = 3; // "quanto quiser"

  $: if (active) {
    if (videoElement && videoState === "playing") {
      videoElement.play().catch(() => {});
    }
  } else {
    resetQuiz();
  }

  onMount(() => {
    if (videoElement && active) {
      videoElement.play().catch(() => {});
    }
  });

  onDestroy(() => {
    if (resetTimeout) clearTimeout(resetTimeout);
  });

  function handleVideoEnded() {
    if (videoState === "playing") videoState = "waiting";
  }

  function handleOptionClick(index) {
    if (videoState !== "waiting") return;
    selectedOption = index;
    videoState = "answered";

    resetTimeout = setTimeout(() => {
      resetQuiz();
      setTimeout(() => {
        if (active && videoElement) {
          videoElement.currentTime = 0;
          videoElement.play().catch(() => {});
        }
      }, 500);
    }, 2500);
  }

  function resetQuiz() {
    videoState = "playing";
    selectedOption = null;
    if (resetTimeout) { clearTimeout(resetTimeout); resetTimeout = null; }
    if (videoElement) { videoElement.currentTime = 0; videoElement.pause(); }
  }
</script>

<!-- Pixel font from Google -->
<svelte:head>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
</svelte:head>

<div class="quiz-root">
  <!-- Video fills container -->
  <div class="video-wrap">
    <!-- svelte-ignore a11y-media-has-caption -->
    <video
      bind:this={videoElement}
      {src}
      class="video"
      muted
      playsinline
      on:ended={handleVideoEnded}
    ></video>
  </div>

  <!-- Options overlay -->
  {#if videoState === "waiting" || videoState === "answered"}
    <div class="options-dialog" transition:fly={{ y: 30, duration: 350 }}>
      <div class="options-grid">
        {#each options as option, index}
          <button
            class="pixel-btn"
            class:correct={videoState === "answered" && index === correctIndex && selectedOption !== null}
            class:wrong={videoState === "answered" && index === selectedOption && index !== correctIndex}
            class:dimmed={videoState === "answered" && index !== correctIndex && index !== selectedOption}
            on:click={() => handleOptionClick(index)}
            disabled={videoState === "answered"}
          >
            {#if videoState === "answered"}
              {#if index === correctIndex && selectedOption !== null}
                <span class="icon green" transition:fade={{ duration: 150 }}>✔</span>
              {:else if index === selectedOption && index !== correctIndex}
                <span class="icon red" transition:fade={{ duration: 150 }}>✖</span>
              {/if}
            {/if}
            <span class="btn-label">{option}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .quiz-root {
    position: relative;
    width: 100%;
    height: 100%;
    background: black;
    overflow: hidden;
  }

  .video-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: black;
  }

  .video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ── Pixel dialog box ── */
  .options-dialog {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: 92%;
    max-width: 520px;
    background: #0d0d1a;
    /* NES-style 3-layer border via box-shadow */
    border: 4px solid #fff;
    box-shadow:
      0 0 0 4px #0d0d1a,
      0 0 0 8px #fff,
      0 0 0 12px #0d0d1a;
    padding: 12px;
    image-rendering: pixelated;
    z-index: 20;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 8px;
  }

  /* ── Pixel button ── */
  .pixel-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 6px 8px;
    background: #1a1a3a;
    color: #fff;
    border: 3px solid #fff;
    box-shadow: inset -3px -3px 0 #000, inset 3px 3px 0 #555;
    cursor: pointer;
    image-rendering: pixelated;
    transition: background 0.1s;
    overflow: hidden;
  }

  .pixel-btn:hover:not(:disabled) {
    background: #2a2a5a;
  }

  .pixel-btn:active:not(:disabled) {
    box-shadow: inset 3px 3px 0 #000, inset -3px -3px 0 #555;
  }

  .pixel-btn.correct {
    background: #0a3a0a;
    border-color: #00ff44;
    box-shadow: inset -3px -3px 0 #000, inset 3px 3px 0 #00aa22;
  }

  .pixel-btn.wrong {
    background: #3a0a0a;
    border-color: #ff2222;
    box-shadow: inset -3px -3px 0 #000, inset 3px 3px 0 #aa0000;
  }

  .pixel-btn.dimmed {
    opacity: 0.35;
  }

  .btn-label {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(6px, 1.5vw, 11px);
    text-transform: uppercase;
    text-align: center;
    line-height: 1.4;
    letter-spacing: 0.03em;
    color: #fff;
    text-shadow: 2px 2px 0 #000;
    pointer-events: none;
  }

  .icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(14px, 3vw, 24px);
    background: rgba(0, 0, 0, 0.55);
    z-index: 10;
  }

  .icon.green { color: #00ff44; text-shadow: 0 0 8px #00ff44; }
  .icon.red   { color: #ff2222; text-shadow: 0 0 8px #ff2222; }

  /* Responsive compact scaling for smaller viewports */
  @media (max-width: 480px) {
    .options-dialog {
      bottom: 6px;
      padding: 6px;
      border-width: 2px;
      box-shadow:
        0 0 0 2px #0d0d1a,
        0 0 0 4px #fff,
        0 0 0 6px #0d0d1a;
    }
    .options-grid {
      gap: 4px;
    }
    .pixel-btn {
      min-height: 28px;
      padding: 3px 4px;
      border-width: 2px;
      box-shadow: inset -2px -2px 0 #000, inset 2px 2px 0 #555;
    }
    .btn-label {
      font-size: 7px !important;
    }
    .icon {
      font-size: 16px !important;
    }
  }
</style>
