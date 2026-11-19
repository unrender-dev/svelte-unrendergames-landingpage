<script>
  /**
   * DebugOverlay.svelte
   *
   * Reusable Three.js performance debug panel.
   * Activated by ?debug or ?3ddebug URL search params.
   *
   * Props:
   *   renderer      — THREE.WebGLRenderer / WebGPURenderer instance
   *   currentRenderer — 'WebGPU' | 'WebGL'
   *   variant       — 'full' (Home-style, with history + benchmark) | 'simple' (compact badge)
   *
   * Usage:
   *   <DebugOverlay {renderer} {currentRenderer} variant="simple" />
   *   <DebugOverlay {renderer} {currentRenderer} variant="full"   />
   */
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';

  // ─── Props ───────────────────────────────────────────────────────────────────
  export let renderer = null;
  export let currentRenderer = 'WebGL';
  export let variant = 'simple'; // 'simple' | 'full'
  export let tier = 'high';

  // ─── State ───────────────────────────────────────────────────────────────────
  let showDebug = false;

  let rendererInfo = {
    geometries: 0,
    textures: 0,
    drawCalls: 0,
    triangles: 0,
    fps: 0,
    frameTime: 0,
    memory: 0,
    potentialFPS: 0,
  };

  let benchmarkMode = false;

  // History for WebGPU ↔ WebGL comparison (full variant only)
  let historyStats = { webgpu: null, webgl: null };
  let gpuSupported = false;

  // ─── Internal FPS tracking ───────────────────────────────────────────────────
  let _fpsFrames = 0;
  let _fpsLastTime = 0;
  let _rafId = null;
  let _lastFrameStartTime = 0;

  // ─── Lifecycle ───────────────────────────────────────────────────────────────
  onMount(() => {
    // Check URL params
    const params = new URLSearchParams(window.location.search);
    showDebug = params.has('debug') || params.has('3ddebug');
    gpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
    _fpsLastTime = performance.now();
    _lastFrameStartTime = performance.now();
    if (!showDebug) return;

    // Load history from localStorage (full variant)
    if (variant === 'full') {
      try {
        const saved = localStorage.getItem('three_debug_stats');
        if (saved) historyStats = JSON.parse(saved);
      } catch (_) {}
    }

    // Start polling renderer.info each frame
    schedulePoll();
  });

  onDestroy(() => {
    if (_rafId) cancelAnimationFrame(_rafId);
  });

  // ─── Per-frame polling (lightweight — no render overhead) ────────────────────
  function schedulePoll() {
    _rafId = requestAnimationFrame(poll);
  }

  function poll(now) {
    if (!showDebug || !renderer) {
      _rafId = requestAnimationFrame(poll);
      return;
    }

    _fpsFrames++;
    if (now - _fpsLastTime >= 1000) {
      const fps = Math.round((_fpsFrames * 1000) / (now - _fpsLastTime));
      rendererInfo = { ...rendererInfo, fps };
      _fpsFrames = 0;
      _fpsLastTime = now;

      // RAM (Chromium only)
      if (performance.memory) {
        rendererInfo = {
          ...rendererInfo,
          memory: Math.round(performance.memory.usedJSHeapSize / 1_048_576),
        };
      } else {
        rendererInfo = { ...rendererInfo, memory: 'N/A' };
      }
    }

    // Frame time (exponential moving average)
    const frameMs = now - _lastFrameStartTime;
    _lastFrameStartTime = now;
    if (frameMs > 0 && frameMs < 200) {
      const smoothed = rendererInfo.frameTime
        ? (rendererInfo.frameTime * 0.9 + frameMs * 0.1).toFixed(1)
        : frameMs.toFixed(1);
      rendererInfo = {
        ...rendererInfo,
        frameTime: smoothed,
        potentialFPS: benchmarkMode ? Math.round(1000 / frameMs) : rendererInfo.fps,
      };
    }

    // Read renderer.info (Three.js resets this every frame if you call renderer.info.reset())
    if (renderer.info) {
      rendererInfo = {
        ...rendererInfo,
        geometries: renderer.info.memory?.geometries ?? 0,
        textures: renderer.info.memory?.textures ?? 0,
        drawCalls: renderer.info.render?.calls ?? 0,
        triangles: renderer.info.render?.triangles ?? 0,
      };
    }

    // Periodically save to history (full variant — approx every 5 s)
    if (variant === 'full' && Math.floor(now / 1000) % 5 === 0) {
      saveStats();
    }

    _rafId = requestAnimationFrame(poll);
  }

  // ─── History helpers (full variant) ─────────────────────────────────────────
  function saveStats() {
    if (!rendererInfo || rendererInfo.drawCalls === 0) return;
    const key = currentRenderer.toLowerCase() === 'webgpu' ? 'webgpu' : 'webgl';
    const existing = historyStats[key];
    if (!existing || rendererInfo.drawCalls >= existing.drawCalls) {
      historyStats[key] = { ...rendererInfo, timestamp: Date.now() };
      historyStats = { ...historyStats }; // trigger reactivity
      try {
        localStorage.setItem('three_debug_stats', JSON.stringify(historyStats));
      } catch (_) {}
    }
  }

  // ─── Renderer toggle helpers (full variant) ──────────────────────────────────
  function reloadWithWebGL() {
    saveStats();
    const url = new URL(window.location.href);
    url.searchParams.set('forceWebGL', 'true');
    window.location.href = url.toString();
  }

  function reloadWithWebGPU() {
    saveStats();
    const url = new URL(window.location.href);
    url.searchParams.delete('forceWebGL');
    window.location.href = url.toString();
  }

  // Metric rows for the full comparison table
  const PERF_METRICS = [
    { key: 'fps',          label: 'FPS',          unit: '' },
    { key: 'potentialFPS', label: 'MAX THEORETICAL', unit: '' },
    { key: 'frameTime',    label: 'Frame Time',   unit: 'ms' },
    { key: 'memory',       label: 'RAM',          unit: 'MB' },
  ];

  const ENGINE_METRICS = [
    { key: 'geometries',   label: 'Geometries' },
    { key: 'textures',     label: 'Textures' },
    { key: 'drawCalls',    label: 'Draw Calls' },
    { key: 'triangles',    label: 'Triangles' },
  ];

  $: isWebGPU = currentRenderer === 'WebGPU';
</script>

{#if showDebug && browser}
  <!-- ═══════════════════════════════════════════════════════════════ SIMPLE ══ -->
  {#if variant === 'simple'}
    <div class="debug-simple">
      <!-- Engine badge -->
      <div class="simple-header">
        <span class="simple-label">Engine Status</span>
        <div class="simple-badge">
          <div class="simple-dot" class:gpu={isWebGPU} class:gl={!isWebGPU}></div>
          <span class="simple-renderer" class:gpu={isWebGPU} class:gl={!isWebGPU}>
            {currentRenderer}
          </span>
        </div>
      </div>
      <!-- Stats grid -->
      <div class="simple-grid">
        <span class="dim">Tier:</span><span style="font-weight: bold; text-transform: uppercase; color: {tier === 'low' ? '#f87171' : (tier === 'medium' ? '#fb923c' : '#4ade80')}">{tier}</span>
        <span class="dim">Geometries:</span><span>{rendererInfo.geometries}</span>
        <span class="dim">Textures:</span><span>{rendererInfo.textures}</span>
        <span class="dim">Draw Calls:</span><span>{rendererInfo.drawCalls}</span>
        <span class="dim">Triangles:</span><span>{(rendererInfo.triangles ?? 0).toLocaleString()}</span>
        <span class="dim">FPS:</span><span>{rendererInfo.fps}</span>
        <span class="dim">Frame:</span><span>{rendererInfo.frameTime}ms</span>
      </div>
    </div>

  <!-- ════════════════════════════════════════════════════════════════ FULL ══ -->
  {:else if variant === 'full'}
    <div class="debug-full">
      <!-- Header -->
      <div class="full-header">
        <div class="full-title">
          <span class="full-label-sm">Analytics</span>
          <span class="full-title-lg">Performance Comparison</span>
        </div>
        <div class="full-engine">
          <div class="full-badge">
            <div class="full-dot" class:gpu={isWebGPU} class:gl={!isWebGPU}></div>
            <span class="full-renderer" class:gpu={isWebGPU} class:gl={!isWebGPU}>
              {currentRenderer}
            </span>
          </div>
          <span class="full-active-label">Active Engine</span>
        </div>
      </div>

      <!-- Comparison Grid -->
      <div class="full-metrics">
        <!-- Column headers -->
        <div class="metric-cols-header">
          <span>Metric</span>
          <span class="col-gl">WebGL</span>
          <span class="col-gpu">WebGPU</span>
        </div>

        <div class="metric-row engine-row">
          <span class="metric-label engine-label">GPU SUPPORTED?</span>
          <div class="metric-cell"><span class="val sm">YES</span></div>
          <div class="metric-cell"><span class="val sm" class:gpu={gpuSupported} class:history={!gpuSupported}>{gpuSupported ? 'YES' : 'NO'}</span></div>
        </div>

        <div class="metric-row engine-row">
          <span class="metric-label engine-label">PERFORMANCE TIER</span>
          <div class="metric-cell" style="grid-column: 2 / -1; text-align: right; padding-right: 24px;"><span class="val sm" style="text-transform: uppercase; font-weight: 800; color: {tier === 'low' ? '#f87171' : (tier === 'medium' ? '#fb923c' : '#4ade80')}">{tier}</span></div>
        </div>

        <!-- Performance rows -->
        {#each PERF_METRICS as m}
          {@const label = m.key === 'potentialFPS' && benchmarkMode ? 'POTENTIAL FPS' : m.label}
          {@const unit  = m.key === 'potentialFPS' && benchmarkMode ? '🔥' : m.unit}
          <div class="metric-row">
            <span class="metric-label">{label}</span>
            <!-- WebGL column -->
            <div class="metric-cell">
              {#if currentRenderer === 'WebGL'}
                <span class="val gl">{rendererInfo[m.key]}<span class="unit">{unit}</span></span>
              {:else if historyStats.webgl}
                <span class="val history">{historyStats.webgl[m.key] ?? 0}<span class="unit">{unit}</span></span>
              {:else}
                <span class="val empty">-</span>
              {/if}
            </div>
            <!-- WebGPU column -->
            <div class="metric-cell">
              {#if currentRenderer === 'WebGPU'}
                <span class="val gpu">{rendererInfo[m.key]}<span class="unit">{unit}</span></span>
              {:else if historyStats.webgpu}
                <span class="val history">{historyStats.webgpu[m.key] ?? 0}<span class="unit">{unit}</span></span>
              {:else}
                <span class="val empty">-</span>
              {/if}
            </div>
          </div>
        {/each}

        <div class="divider"></div>

        <!-- Engine stat rows -->
        {#each ENGINE_METRICS as m}
          <div class="metric-row engine-row">
            <span class="metric-label engine-label">{m.label}</span>
            <div class="metric-cell">
              {#if currentRenderer === 'WebGL'}
                <span class="val gl sm">{rendererInfo[m.key] ?? 0}</span>
              {:else if historyStats.webgl}
                <span class="val history">{historyStats.webgl[m.key] ?? 0}</span>
              {:else}
                <span class="val empty">-</span>
              {/if}
            </div>
            <div class="metric-cell">
              {#if currentRenderer === 'WebGPU'}
                <span class="val gpu sm">{rendererInfo[m.key] ?? 0}</span>
              {:else if historyStats.webgpu}
                <span class="val history">{historyStats.webgpu[m.key] ?? 0}</span>
              {:else}
                <span class="val empty">-</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Actions -->
      <div class="full-actions">
        <button
          class="btn-benchmark"
          class:active={benchmarkMode}
          on:click={() => (benchmarkMode = !benchmarkMode)}
        >
          {benchmarkMode ? 'Disable Benchmark' : 'Enable Benchmark (Unlock)'}
        </button>

        {#if currentRenderer === 'WebGPU'}
          <button class="btn-toggle gl" on:click={reloadWithWebGL}>
            Force WebGL Mode
          </button>
        {:else}
          <button class="btn-toggle gpu" on:click={reloadWithWebGPU}>
            Restore WebGPU Mode
          </button>
        {/if}
      </div>

      <div class="full-footer">
        <span>Unrender Engine Diagnostics v2.1</span>
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ─── Shared ──────────────────────────────────────────────────────────────── */
  .gpu { color: #4ade80; }
  .gl  { color: #60a5fa; }
  .dim { opacity: 0.55; }
  .val { font-weight: 700; }
  .unit { font-size: 0.7em; opacity: 0.5; margin-left: 1px; }
  .val.history { color: rgba(255,255,255,0.3); font-size: 0.75em; font-weight: 400; }
  .val.empty   { color: rgba(255,255,255,0.1); font-size: 0.75em; }
  .divider { height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0; grid-column: 1 / -1; }

  /* ─── Simple variant ──────────────────────────────────────────────────────── */
  .debug-simple {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: rgba(0,0,0,0.85);
    color: #fff;
    padding: 12px 16px;
    border-radius: 1rem;
    font-family: monospace;
    font-size: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    backdrop-filter: blur(12px);
    box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    z-index: 99999;
    min-width: 180px;
    pointer-events: none;
    user-select: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .simple-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .simple-label  { font-size: 9px; text-transform: uppercase; letter-spacing: 0.25em; opacity: 0.5; }
  .simple-badge  { display: flex; align-items: center; gap: 6px; }
  .simple-dot    { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s infinite; }
  .simple-dot.gpu { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
  .simple-dot.gl  { background: #60a5fa; box-shadow: 0 0 8px #60a5fa; }
  .simple-renderer { font-weight: 700; font-size: 11px; text-transform: uppercase; }
  .simple-grid {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 12px;
    font-size: 11px;
  }
  .simple-grid span:nth-child(even) { text-align: right; }

  /* ─── Full variant ────────────────────────────────────────────────────────── */
  .debug-full {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: rgba(0,0,0,0.97);
    color: #fff;
    padding: 20px;
    border-radius: 2.5rem;
    font-family: monospace;
    font-size: 12px;
    border: 1px solid rgba(255,255,255,0.18);
    backdrop-filter: blur(24px);
    box-shadow: 0 30px 60px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.05);
    z-index: 99999;
    min-width: 300px;
    pointer-events: auto;
    user-select: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  @media (min-width: 768px) {
    .debug-full { bottom: 6rem; right: 2rem; }
  }

  /* Header */
  .full-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .full-title { display: flex; flex-direction: column; gap: 2px; }
  .full-label-sm { font-size: 9px; text-transform: uppercase; letter-spacing: 0.3em; color: #fb923c; font-weight: 700; }
  .full-title-lg { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
  .full-engine { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .full-badge  { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 3px 10px; border-radius: 999px; }
  .full-dot    { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s infinite; }
  .full-dot.gpu { background: #4ade80; box-shadow: 0 0 10px #4ade80; }
  .full-dot.gl  { background: #60a5fa; box-shadow: 0 0 10px #60a5fa; }
  .full-renderer { font-weight: 900; font-size: 11px; text-transform: uppercase; }
  .full-active-label { font-size: 8px; opacity: 0.35; text-transform: uppercase; letter-spacing: 0.1em; }

  /* Metrics */
  .full-metrics { display: flex; flex-direction: column; gap: 4px; }
  .metric-cols-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    opacity: 0.35;
    font-weight: 700;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .metric-cols-header .col-gl  { text-align: center; color: #60a5fa; }
  .metric-cols-header .col-gpu { text-align: center; color: #4ade80; }
  .metric-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: baseline;
    gap: 4px;
  }
  .metric-label { font-size: 10px; color: rgba(254,215,170,0.6); font-weight: 700; }
  .engine-label { color: rgba(255,255,255,0.4); font-weight: 400; }
  .metric-cell { text-align: center; }
  .val.gl   { color: #60a5fa; font-size: 12px; }
  .val.gpu  { color: #4ade80; font-size: 12px; }
  .val.sm   { font-size: 10px; }

  /* Actions */
  .full-actions { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
  .btn-benchmark {
    width: 100%;
    padding: 8px;
    border-radius: 12px;
    border: 1px solid rgba(251,146,60,0.3);
    color: #fb923c;
    background: transparent;
    font-family: monospace;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-benchmark:hover { background: rgba(251,146,60,0.1); }
  .btn-benchmark.active { background: rgba(251,146,60,0.2); border-color: #fb923c; }
  .btn-toggle {
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    font-family: monospace;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    cursor: pointer;
    transition: background 0.2s, box-shadow 0.2s;
  }
  .btn-toggle.gl  { background: rgba(96,165,250,0.1); border: 1px solid rgba(96,165,250,0.3); color: #60a5fa; }
  .btn-toggle.gl:hover  { background: rgba(96,165,250,0.2); box-shadow: 0 0 10px rgba(96,165,250,0.1); }
  .btn-toggle.gpu { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.3); color: #4ade80; }
  .btn-toggle.gpu:hover { background: rgba(74,222,128,0.2); box-shadow: 0 0 10px rgba(74,222,128,0.1); }

  /* Footer */
  .full-footer { text-align: center; }
  .full-footer span { font-size: 7px; opacity: 0.18; text-transform: uppercase; letter-spacing: 0.5em; font-weight: 900; }

  /* Pulse animation */
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
</style>
