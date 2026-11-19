<script>
    import { onMount, onDestroy, tick } from "svelte";
    import gsap from "gsap";
    import { portfolioModalState } from "$lib/modalStore.js";
    import * as THREE from "three";
    import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
    import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
    import { registerRenderer, unregisterRenderer } from "./debugStore.js";
    import { createRenderer } from "./threeRenderer.js";

    import {
        gameProjects,
        models3D,
        avProjects,
        fortniteProjects,
        robloxProjects,
    } from "./portfolioData.js";
    import { page } from "$app/stores";

    let overlayEl;
    let panelEl;

    // Tabs
    const BASE_TABS = [
        { id: "jogos", label: "Jogos", icon: "fas fa-gamepad" }
    ];

    $: isJogosPage = $page.url.pathname.startsWith("/jogos");
    $: tabs = isJogosPage
        ? [{ id: "welcome", label: "Bem Vindo", icon: "fas fa-info-circle" }, ...BASE_TABS]
        : BASE_TABS;

    $: isOpen = $portfolioModalState.isOpen;
    $: activeTab = $portfolioModalState.activeTab || (isJogosPage ? "welcome" : "jogos");

    $: if (isOpen) {
        tick().then(() => {
            if (overlayEl && panelEl) openModal();
        });
    }

    function openModal() {
        gsap.killTweensOf([overlayEl, panelEl]);
        gsap.set(overlayEl, { display: "flex" });
        gsap.fromTo(
            overlayEl,
            { opacity: 0 },
            { opacity: 1, duration: 0.25, ease: "power2.out" },
        );
        gsap.fromTo(
            panelEl,
            { opacity: 0, scale: 0.94, y: 16 },
            {
                opacity: 1,
                scale: 1,
                y: 0,
                duration: 0.3,
                ease: "back.out(1.2)",
            },
        );
    }

    function close() {
        disposeViewer();
        portfolioModalState.update((s) => ({ ...s, isOpen: false }));
    }

    function handleKeydown(e) {
        if (e.key === "Escape") close();
    }

    // ── Tab switching ───────────────────────────────────────────────
    function setTab(tabId) {
        if (activeTab === tabId) return;
        // Dispose viewer if leaving 3D tab
        if (activeTab === "modelos" && tabId !== "modelos") {
            disposeViewer();
        }
        portfolioModalState.update(s => ({ ...s, activeTab: tabId }));
        // Init viewer if entering 3D tab
        if (tabId === "modelos") {
            // Wait one tick for DOM
            setTimeout(() => initViewer(), 50);
        }
    }

    let selectedModelIndex = 0;
    let viewerCanvas;
    let viewerLoading = false;
    let viewerScene, viewerCamera, viewerRenderer;
    let viewerModel = null;
    let viewerAnimFrameId;
    let viewerMixer = null;
    let viewerClock = new THREE.Clock();
    let isDragging = false;
    let prevPointer = { x: 0, y: 0 };
    let spherical = { theta: 0, phi: Math.PI / 4 };
    let viewerRadius = 5;
    let viewerInited = false;

    // Animation clips tracking
    let viewerClips = []; // all AnimationClip[] for current model
    let viewerClipNames = []; // display names
    let selectedClipIndex = 0; // currently playing clip index

    async function initViewer() {
        if (viewerInited || !viewerCanvas) return;
        viewerInited = true;

        viewerScene = new THREE.Scene();
        viewerScene.background = new THREE.Color(0x0d0d1a);

        const w = viewerCanvas.offsetWidth || 600;
        const h = viewerCanvas.offsetHeight || 400;

        viewerCamera = new THREE.PerspectiveCamera(45, w / h, 0.01, 200);
        updateViewerCamera();

        const result = await createRenderer({
            canvas: viewerCanvas,
            antialias: true,
            alpha: false,
        });
        viewerRenderer = result.renderer;
        const currentRenderer = result.currentRenderer;

        viewerRenderer.setSize(w, h);
        viewerRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        viewerRenderer.outputColorSpace = THREE.SRGBColorSpace;
        viewerRenderer.shadowMap.enabled = true;

        // Register renderer for global debug overlay
        registerRenderer(viewerRenderer, currentRenderer);

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 1.5);
        viewerScene.add(ambient);
        const dir1 = new THREE.DirectionalLight(0xffffff, 2.0);
        dir1.position.set(3, 6, 4);
        dir1.castShadow = true;
        viewerScene.add(dir1);
        const dir2 = new THREE.DirectionalLight(0x8888ff, 0.8);
        dir2.position.set(-4, 3, -2);
        viewerScene.add(dir2);
        const rim = new THREE.DirectionalLight(0xffa07a, 0.5);
        rim.position.set(0, -2, -5);
        viewerScene.add(rim);

        // Pointer controls
        viewerCanvas.addEventListener("pointerdown", onViewerPointerDown);
        viewerCanvas.addEventListener("pointermove", onViewerPointerMove);
        viewerCanvas.addEventListener("pointerup", onViewerPointerUp);
        viewerCanvas.addEventListener("pointercancel", onViewerPointerUp);
        viewerCanvas.addEventListener("wheel", onViewerWheel, {
            passive: true,
        });

        animateViewer();

        // Load first model
        loadModel(selectedModelIndex);
    }

    function updateViewerCamera() {
        if (!viewerCamera) return;
        const x =
            viewerRadius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
        const y = viewerRadius * Math.cos(spherical.phi);
        const z =
            viewerRadius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
        viewerCamera.position.set(x, y, z);
        viewerCamera.lookAt(0, 0, 0);
    }

    function onViewerPointerDown(e) {
        isDragging = true;
        prevPointer = { x: e.clientX, y: e.clientY };
        viewerCanvas.setPointerCapture(e.pointerId);
    }
    function onViewerPointerMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - prevPointer.x;
        const dy = e.clientY - prevPointer.y;
        spherical.theta -= dx * 0.008;
        spherical.phi = Math.max(
            0.1,
            Math.min(Math.PI * 0.85, spherical.phi + dy * 0.008),
        );
        prevPointer = { x: e.clientX, y: e.clientY };
        updateViewerCamera();
    }
    function onViewerPointerUp() {
        isDragging = false;
    }
    function onViewerWheel(e) {
        viewerRadius = Math.max(
            1.5,
            Math.min(20, viewerRadius + e.deltaY * 0.01),
        );
        updateViewerCamera();
    }

    function animateViewer() {
        if (viewerAnimFrameId) cancelAnimationFrame(viewerAnimFrameId);
        viewerAnimFrameId = requestAnimationFrame(animateViewer);
        if (!isDragging) {
            spherical.theta += 0.003;
            updateViewerCamera();
        }
        const delta = viewerClock.getDelta();
        if (viewerMixer) viewerMixer.update(delta);
        if (viewerRenderer && viewerScene && viewerCamera) {
            viewerRenderer.render(viewerScene, viewerCamera);
        }
    }

    function selectModel(index) {
        if (index === selectedModelIndex && viewerModel) return;
        selectedModelIndex = index;
        loadModel(index);
    }

    function loadModel(index) {
        if (!viewerInited) return;
        viewerLoading = true;

        // Dispose previous model
        if (viewerModel) {
            viewerScene.remove(viewerModel);
            viewerModel.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    const mats = Array.isArray(child.material)
                        ? child.material
                        : [child.material];
                    mats.forEach((m) => {
                        for (const k of Object.keys(m)) {
                            if (m[k]?.isTexture) m[k].dispose();
                        }
                        m.dispose();
                    });
                }
            });
            viewerModel = null;
        }
        if (viewerMixer) {
            viewerMixer.stopAllAction();
            viewerMixer = null;
        }

        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath(
            "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
        );
        loader.setDRACOLoader(draco);

        loader.load(
            models3D[index].path,
            (gltf) => {
                const model = gltf.scene;

                // Normalize size
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const targetSize = 3.0;
                const scale = targetSize / maxDim;

                model.scale.setScalar(scale);
                model.position.set(
                    -center.x * scale,
                    -center.y * scale,
                    -center.z * scale,
                );

                // Shadows
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Reset camera distance
                viewerRadius = size.y * scale * 2.2 + 2;
                spherical.phi = Math.PI / 3.5;
                updateViewerCamera();

                viewerScene.add(model);
                viewerModel = model;

                // Animations — store all clips for the selector
                viewerClips = gltf.animations || [];
                viewerClipNames = viewerClips.map((c, i) =>
                    c.name ? c.name : `Animation ${i + 1}`,
                );

                if (viewerClips.length > 0) {
                    viewerMixer = new THREE.AnimationMixer(model);

                    // Low Poly Rabbit: default to second clip if it exists
                    const modelName = models3D[index].name;
                    const defaultIdx =
                        modelName === "Low Poly Rabbit" &&
                        viewerClips.length > 1
                            ? 1
                            : 0;
                    selectedClipIndex = defaultIdx;
                    viewerMixer.clipAction(viewerClips[defaultIdx]).play();
                } else {
                    selectedClipIndex = 0;
                }

                viewerLoading = false;
            },
            undefined,
            (err) => {
                console.error("Model load error:", err);
                viewerLoading = false;
            },
        );
    }

    function changeAnimation(clipIdx) {
        if (!viewerMixer || !viewerClips.length) return;
        if (clipIdx < 0 || clipIdx >= viewerClips.length) return;
        viewerMixer.stopAllAction();
        selectedClipIndex = clipIdx;
        viewerMixer.clipAction(viewerClips[clipIdx]).reset().play();
    }

    function disposeViewer() {
        if (!viewerInited) return;
        viewerInited = false;

        if (viewerAnimFrameId) cancelAnimationFrame(viewerAnimFrameId);

        if (viewerCanvas) {
            viewerCanvas.removeEventListener(
                "pointerdown",
                onViewerPointerDown,
            );
            viewerCanvas.removeEventListener(
                "pointermove",
                onViewerPointerMove,
            );
            viewerCanvas.removeEventListener("pointerup", onViewerPointerUp);
            viewerCanvas.removeEventListener(
                "pointercancel",
                onViewerPointerUp,
            );
            viewerCanvas.removeEventListener("wheel", onViewerWheel);
        }

        if (viewerMixer) {
            viewerMixer.stopAllAction();
            viewerMixer = null;
        }
        if (viewerModel) {
            viewerScene?.remove(viewerModel);
            viewerModel.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => {
                            for (const k of Object.keys(m)) {
                                if (m[k]?.isTexture) m[k].dispose();
                            }
                            m.dispose();
                        });
                    }
                }
            });
            viewerModel = null;
        }
        if (viewerRenderer) {
            viewerRenderer.dispose?.();
            viewerRenderer.forceContextLoss?.();
            viewerRenderer = null;
        }
        viewerScene = null;
        viewerCamera = null;
        unregisterRenderer();
    }

    // ── Shared Data ──────────────────────────────────────────────────
    // Centralized data imported from portfolioData.js

    function portal(node) {
        document.body.appendChild(node);
        node.hidden = false;
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }

    // Init viewer when tab becomes active after open
    $: if (isOpen && activeTab === "modelos") {
        setTimeout(() => initViewer(), 80);
    }

    onDestroy(() => {
        disposeViewer();
    });
</script>

<svelte:window on:keydown={(e) => isOpen && handleKeydown(e)} />

{#if isOpen}
    <div
        use:portal
        bind:this={overlayEl}
        class="pf-overlay"
        on:click|self={close}
        on:keydown={handleKeydown}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="relative z-[10000] w-full max-w-6xl max-h-[95vh] lg:max-h-[90vh] bg-gradient-to-br from-unrender-purple to-[#0a0a1a] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col"
            bind:this={panelEl}
        >
            <!-- Close Button (Top Right) -->
            <button
                type="button"
                class="absolute top-2 right-2 md:top-4 md:right-4 p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors z-20"
                on:click={close}
                aria-label="Fechar modal"
            >
                <i class="fas fa-times text-xl"></i>
            </button>

            <!-- Header Section (Matching Contact style) -->
            <div class="p-3 md:p-4 lg:p-6 bg-black/20 border-b border-white/10 shrink-0">
                <h2
                    class="text-lg md:text-xl lg:text-3xl font-bold text-white font-['Montserrat'] mb-0.5"
                >
                    Portfólio
                </h2>
                <p class="text-[10px] md:text-xs md:text-sm text-white/70">
                    Conheça nossos projetos e criações
                </p>
            </div>

            <!-- Tab Bar -->
            <div
                class="flex overflow-x-auto md:flex-wrap md:justify-center border-b border-white/10 bg-black/10 no-scrollbar"
            >
                {#each tabs as tab}
                    <button
                        class="px-3 md:px-4 lg:px-6 py-2.5 md:py-3 lg:py-4 text-xs md:text-sm font-bold transition-all border-b-2 whitespace-nowrap flex items-center gap-1.5 md:gap-2 {activeTab ===
                        tab.id
                            ? 'text-unrender-accent border-unrender-accent bg-white/5'
                            : 'text-white/50 border-transparent hover:text-white'}"
                        on:click={() => setTab(tab.id)}
                    >
                        <i class="{tab.icon} scale-90 md:scale-100"></i>
                        <span>{tab.label}</span>
                    </button>
                {/each}
            </div>

            <!-- Tab Content -->
            <div class="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar no-scrollbar">
                <!-- ── WELCOME TAB ────────────────────────────────────── -->
                {#if activeTab === "welcome"}
                    <div class="space-y-4 md:space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div class="bg-white/5 p-4 md:p-6 rounded-xl border border-white/10">
                            <p class="text-sm md:text-base lg:text-lg text-white/90 leading-relaxed">
                                <strong class="text-unrender-accent">Explore o nosso mundo!</strong> Descubra nosso portfólio
                                de jogos interagindo com os <strong>Cartuchos</strong> espalhados pelo
                                mapa e converse com os personagens para conhecer mais.
                            </p>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 lg:gap-6">
                            <div class="bg-white/5 p-4 md:p-6 rounded-xl border border-white/10 hover:border-unrender-accent/30 transition-colors">
                                <h3 class="text-base md:text-lg lg:text-xl font-bold text-white mb-2 md:mb-4 flex items-center gap-2 md:gap-3">
                                    <i class="fas fa-gamepad text-unrender-accent"></i> Movimentação
                                </h3>
                                <p class="text-xs md:text-sm lg:text-base text-white/70">
                                    Use <strong class="text-white">W, A, S, D</strong> ou <strong class="text-white">Clique</strong> para se mover.
                                    <strong class="text-white">Espaço</strong> pula e <strong class="text-white">Shift</strong> corre.
                                </p>
                            </div>

                            <div class="bg-white/5 p-4 md:p-6 rounded-xl border border-white/10 hover:border-unrender-accent/30 transition-colors">
                                <h3 class="text-base md:text-lg lg:text-xl font-bold text-white mb-2 md:mb-4 flex items-center gap-2 md:gap-3">
                                    <i class="fas fa-hand-pointer text-unrender-accent"></i> Interação
                                </h3>
                                <p class="text-xs md:text-sm lg:text-base text-white/70">
                                    Pressione <strong class="text-white">E</strong> ou <strong class="text-white">Enter</strong> para interagir quando estiver próximo. Clique nos <strong class="text-white">Cartuchos</strong> para abrir detalhes dos projetos.
                                </p>
                            </div>

                            <div class="bg-white/5 p-4 md:p-6 rounded-xl border border-white/10 hover:border-unrender-accent/30 transition-colors">
                                <h3 class="text-base md:text-lg lg:text-xl font-bold text-white mb-2 md:mb-4 flex items-center gap-2 md:gap-3">
                                    <i class="fas fa-magic text-unrender-accent"></i> Poderes & Menu
                                </h3>
                                <p class="text-xs md:text-sm lg:text-base text-white/70">
                                    Teclas <strong class="text-white">1</strong> e <strong class="text-white">2</strong> ativam magias.
                                    <strong class="text-white">ESC</strong> cancela ataques ou abre as configurações.
                                </p>
                            </div>

                            <div class="bg-white/5 p-4 md:p-6 rounded-xl border border-white/10 hover:border-unrender-accent/30 transition-colors">
                                <h3 class="text-base md:text-lg lg:text-xl font-bold text-white mb-2 md:mb-4 flex items-center gap-2 md:gap-3">
                                    <i class="fas fa-code text-unrender-accent"></i> Tecnologias
                                </h3>
                                <p class="text-xs md:text-sm lg:text-base text-white/70">
                                    Este jogo foi desenvolvido com <strong class="text-white">Three.js</strong> (renderização 3D), <strong class="text-white">Svelte</strong> (interface e estado) e <strong class="text-white">WebGL</strong> para o processamento gráfico.
                                </p>
                            </div>
                        </div>


                    </div>
                {/if}
                <!-- ── JOGOS TAB ─────────────────────────────────────── -->
                {#if activeTab === "jogos"}
                    <div class="pf-grid !gap-2">
                        {#each gameProjects as p}
                            <div class="pcard">
                                <div class="pcard-img !aspect-[16/8]">
                                    {#if p.image && p.image.endsWith('.mp4')}
                                        <!-- svelte-ignore a11y-media-has-caption -->
                                        <video src={p.image} autoplay loop muted playsinline class="w-full h-full object-cover"></video>
                                    {:else if p.image}
                                        <img
                                            src={p.image}
                                            alt={p.name}
                                            loading="lazy"
                                        />
                                    {:else}
                                        <div class="w-full h-full flex items-center justify-center bg-black/50">
                                            <i class="fas fa-gamepad text-4xl text-white/20"></i>
                                        </div>
                                    {/if}
                                    <div class="pcard-overlay">
                                        {#each p.links as link}
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="pcard-link !w-8 !h-8 !text-sm"
                                                aria-label="Link para o projeto"
                                            >
                                                <i class={link.icon}></i>
                                            </a>
                                        {/each}
                                    </div>
                                </div>
                                <div class="pcard-info !p-2 !gap-0.5">
                                    <h3 class="pcard-name !text-[13px]">{p.name}</h3>
                                    <p class="pcard-desc !text-[11px] !leading-tight">{p.description}</p>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- ── MODELOS 3D TAB ────────────────────────────────── -->
                {#if activeTab === "modelos"}
                    <div class="viewer-layout">
                        <!-- Left: model list -->
                        <div class="model-list">
                            <p class="model-list-title">
                                <i class="fas fa-layer-group"></i> Modelos
                            </p>
                            {#each models3D as model, i}
                                <button
                                    class="model-item"
                                    class:selected={selectedModelIndex === i}
                                    on:click={() => selectModel(i)}
                                >
                                    <div class="model-thumb">
                                        {#if model.thumb}
                                            <img
                                                src={model.thumb}
                                                alt={model.name}
                                            />
                                        {:else}
                                            <div
                                                class="model-thumb-placeholder"
                                            >
                                                <i class="fas fa-cube"></i>
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="model-item-name"
                                        >{model.name}</span
                                    >
                                </button>
                            {/each}
                        </div>

                        <!-- Right: 3D viewer -->
                        <div class="viewer-area">
                            <div class="viewer-canvas-wrap">
                                {#if viewerLoading}
                                    <div class="viewer-loading">
                                        <div class="spinner-ring"></div>
                                        <p>Carregando modelo…</p>
                                    </div>
                                {/if}
                                <canvas
                                    bind:this={viewerCanvas}
                                    on:contextmenu|preventDefault
                                    class="viewer-canvas"
                                ></canvas>
                            </div>
                            <div class="viewer-bottom-bar">
                                <div class="viewer-info-row">
                                    <div class="viewer-model-name">
                                        <i class="fas fa-cube"></i>
                                        {models3D[selectedModelIndex].name}
                                    </div>
                                    {#if viewerClipNames.length > 1}
                                        <div class="anim-selector">
                                            <label for="anim-select"
                                                ><i class="fas fa-play-circle"
                                                ></i> Animação:</label
                                            >
                                            <select
                                                id="anim-select"
                                                bind:value={selectedClipIndex}
                                                on:change={() =>
                                                    changeAnimation(
                                                        selectedClipIndex,
                                                    )}
                                            >
                                                {#each viewerClipNames as name, i}
                                                    <option value={i}
                                                        >{name}</option
                                                    >
                                                {/each}
                                            </select>
                                        </div>
                                    {:else if viewerClipNames.length === 1}
                                        <div class="anim-selector">
                                            <span class="anim-single"
                                                ><i class="fas fa-play-circle"
                                                ></i>
                                                {viewerClipNames[0]}</span
                                            >
                                        </div>
                                    {:else}
                                        <div class="anim-selector">
                                            <span class="anim-single"
                                                ><i class="fas fa-pause-circle"
                                                ></i> Sem animação</span
                                            >
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}

                <!-- ── AUDIOVISUAL TAB ────────────────────────────────── -->
                {#if activeTab === "audiovisual"}
                    <div class="av-header !mb-3">
                        <h3 class="av-title !text-base">Produção Audiovisual</h3>
                    </div>
                    <div class="av-grid !gap-2">
                        {#each avProjects as p}
                            <div class="av-card !p-2 !flex !items-center !gap-3" style="--accent: {p.color}">
                                <div class="av-icon !text-lg !mb-0 shrink-0">
                                    <i class={p.icon} style="color: {p.color}"
                                    ></i>
                                </div>
                                <div>
                                    <h4 class="av-name !text-[13px] !mb-0">{p.name}</h4>
                                    <p class="av-desc !text-[11px] !mb-0 line-clamp-1">{p.description}</p>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- ── FORTNITE TAB ───────────────────────────────────── -->
                {#if activeTab === "fortnite"}
                    <div class="fn-header !mb-3">
                        <h3 class="fn-title !text-base">Fortnite Creative</h3>
                    </div>
                    <div class="fn-grid !gap-2">
                        {#each fortniteProjects as p}
                            <div class="fn-card !flex !items-center !h-14 md:!h-auto md:!block">
                                {#if p.image}
                                    <div class="fn-card-img !aspect-square !w-16 !shrink-0 md:!w-auto md:!aspect-[16/7]">
                                        <img
                                            src={p.image}
                                            alt={p.name}
                                            loading="lazy"
                                        />
                                    </div>
                                {:else}
                                    <div class="fn-card-no-img !w-16 !shrink-0 !aspect-square !text-xl md:!w-auto md:!aspect-[16/7] md:!text-2xl">
                                        <i class="fas fa-bolt"></i>
                                    </div>
                                {/if}
                                <div class="fn-card-info !p-2 !gap-0">
                                    <h4 class="fn-card-name !text-[13px]">{p.name}</h4>
                                    <p class="fn-card-desc !text-[11px] !leading-tight line-clamp-1 md:line-clamp-2">{p.description}</p>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- ── ROBLOX TAB ─────────────────────────────────────── -->
                {#if activeTab === "roblox"}
                    <div class="rb-header !mb-3">
                        <h3 class="rb-title !text-base !text-white !font-bold">Roblox Studio</h3>
                    </div>
                    <div class="rb-grid !gap-2">
                        {#each robloxProjects as p}
                            <div class="rb-card !p-2 !gap-3 !items-center" style="--accent: {p.color}">
                                <div
                                    class="rb-icon !w-10 !h-10 !text-xl !shrink-0"
                                    style="background: {p.color}20; border-color: {p.color}40"
                                >
                                    <i class={p.icon} style="color: {p.color}"
                                    ></i>
                                </div>
                                <div class="rb-info !gap-0">
                                    <h4 class="rb-name !text-[13px]">{p.name}</h4>
                                    <p class="rb-desc !text-[11px] !leading-tight line-clamp-1 md:line-clamp-2">{p.description}</p>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
            <!-- /pf-body -->
        </div>
    </div>
{/if}

<style>
    /* ── Overlay & Panel ────────────────────────── */
    .pf-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
    }
    @media (min-width: 768px) {
        .pf-overlay {
            padding: 1rem;
        }
    }

    /* Container, Header and Tabs handled by Tailwind classes in HTML */

    .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
    }

    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }

    /* ── JOGOS: Game cards grid ─────────────────── */
    .pf-grid {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.75rem;
    }
    @media (min-width: 768px) {
        .pf-grid {
            gap: 1.25rem;
        }
    }

    .pcard {
        flex: 0 1 320px;
        width: 100%;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 1rem;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
    }

    .pcard:hover {
        transform: translateY(-5px);
        border-color: var(--unrender-accent, #f5a623);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .pcard-img {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
    }

    .pcard-img img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.5s;
    }

    .pcard:hover .pcard-img img {
        transform: scale(1.08);
    }

    .pcard-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.8rem;
        opacity: 0;
        transition: opacity 0.3s;
    }

    .pcard-img:hover .pcard-overlay {
        opacity: 1;
    }

    .pcard-link {
        width: 2.8rem;
        height: 2.8rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1.1rem;
        text-decoration: none;
        transition: all 0.2s;
    }

    .pcard-link:hover {
        background: var(--unrender-accent, #ffa500);
        border-color: var(--unrender-accent, #ffa500);
        transform: scale(1.1);
    }

    .pcard-info {
        padding: 1rem;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .pcard-name {
        font-size: 1rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    .pcard-desc {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.6;
        margin: 0;
        flex: 1;
    }

    .pcard-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 0.75rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .pcard-year {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.4);
    }

    .pcard-tags {
        display: flex;
        gap: 0.35rem;
    }

    .pcard-tag {
        font-size: 0.7rem;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.6);
        padding: 0.2rem 0.5rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    /* ── MODELOS 3D: viewer layout ──────────────── */
    .viewer-layout {
        display: flex;
        gap: 0.75rem;
        min-height: 300px;
        max-height: 420px;
        height: auto;
        flex: 1;
    }

    /* Left panel: model list */
    .model-list {
        width: 180px;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .model-list::-webkit-scrollbar {
        width: 4px;
    }
    .model-list::-webkit-scrollbar-track {
        background: transparent;
    }
    .model-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.08);
        border-radius: 10px;
    }
    .model-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.15);
    }

    .model-list-title {
        font-size: 0.75rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.4);
        padding: 0.75rem 0.75rem 0.5rem;
        margin: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
    }

    .model-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.6rem;
        background: transparent;
        border: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        transition:
            background 0.2s,
            color 0.2s;
        text-align: left;
        width: 100%;
    }

    .model-item:hover {
        background: rgba(255, 255, 255, 0.05);
        color: white;
    }

    .model-item.selected {
        background: rgba(255, 255, 255, 0.1);
        color: var(--unrender-accent, #ffa500);
        border-left: 2px solid var(--unrender-accent, #ffa500);
    }

    .model-thumb {
        width: 28px;
        height: 28px;
        border-radius: 0.3rem;
        overflow: hidden;
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.05);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .model-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .model-thumb-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.2);
        font-size: 0.85rem;
    }

    .model-item-name {
        font-size: 0.75rem;
        line-height: 1.2;
    }

    /* Right panel: viewer */
    .viewer-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-width: 0;
    }

    .viewer-canvas-wrap {
        flex: 1;
        position: relative;
        background: #0d0d1a;
        border-radius: 0.75rem;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
        min-height: 0;
    }

    .viewer-canvas {
        width: 100%;
        height: 100%;
        display: block;
    }

    .viewer-loading {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        background: rgba(10, 10, 26, 0.85);
        backdrop-filter: blur(4px);
    }

    .viewer-loading p {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
    }

    .spinner-ring {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.1);
        border-top-color: var(--unrender-accent, #ffa500);
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .viewer-controls-hint {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
    }



    .viewer-model-name {
        font-size: 0.75rem;
        font-weight: 700;
        color: white;
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .viewer-bottom-bar {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .viewer-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .anim-selector {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .anim-selector label {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.4);
        display: flex;
        align-items: center;
        gap: 0.3rem;
        white-space: nowrap;
    }

    .anim-selector label i {
        color: rgba(255, 255, 255, 0.2);
    }

    .anim-selector select {
        font-size: 0.8rem;
        background: rgba(255, 255, 255, 0.1);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.5rem;
        padding: 0.35rem 0.6rem;
        cursor: pointer;
        outline: none;
        max-width: 200px;
        transition: all 0.2s;
    }

    .anim-selector select:hover {
        border-color: rgba(255, 255, 255, 0.2);
    }

    .anim-selector select:focus {
        border-color: var(--unrender-accent, #ffa500);
        box-shadow: 0 0 0 1px var(--unrender-accent, #ffa500);
    }

    .anim-selector select option {
        background: #0d0d1a;
        color: white;
    }

    .anim-single {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.4);
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    .anim-single i {
        color: rgba(255, 255, 255, 0.2);
    }

    /* ── AUDIOVISUAL TAB ─────────────────────────── */
    .av-header {
        margin-bottom: 1.5rem;
        text-align: center;
    }

    .av-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: white;
        margin: 0 0 0.5rem;
    }

    .av-subtitle {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
        line-height: 1.6;
        max-width: 600px;
        margin-inline: auto;
    }

    .av-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 0.5rem;
    }

    .av-card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 1rem;
        padding: 1.5rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .av-card:hover {
        transform: translateY(-4px);
        border-color: var(--unrender-accent, #f5a623);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .av-icon {
        font-size: 1.6rem;
        margin-bottom: 0.75rem;
    }

    .av-name {
        font-size: 1.1rem;
        font-weight: 700;
        color: white;
        margin: 0 0 0.5rem;
    }

    .av-desc {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.4;
        margin: 0 0 0.75rem;
    }

    .av-tags {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
    }

    .av-tag {
        font-size: 0.75rem;
        padding: 0.25rem 0.6rem;
        border-radius: 0.5rem;
        border: 1px solid;
        background: transparent;
    }

    /* ── FORTNITE TAB ────────────────────────────── */
    .fn-header {
        text-align: center;
        margin-bottom: 1.5rem;
    }

    .fn-logo-wrap {
        display: flex;
        justify-content: center;
        margin-bottom: 0.75rem;
    }

    .fn-logo {
        height: 48px;
        object-fit: contain;
        filter: drop-shadow(0 0 12px rgba(255, 220, 50, 0.5));
    }

    .fn-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: white;
        margin: 0 0 0.5rem;
    }

    .fn-subtitle {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
        line-height: 1.6;
        max-width: 600px;
        margin-inline: auto;
    }

    .fn-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 0.5rem;
    }

    .fn-card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .fn-card:hover {
        transform: translateY(-5px);
        border-color: #ffe04b;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .fn-card-img {
        aspect-ratio: 16/7;
        overflow: hidden;
        background: rgba(255, 220, 50, 0.05);
    }

    .fn-card-img img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 0.5rem;
    }

    .fn-card-no-img {
        aspect-ratio: 16/7;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 220, 50, 0.05);
        color: rgba(255, 220, 50, 0.25);
        font-size: 2.5rem;
    }

    .fn-card-info {
        padding: 0.4rem 0.6rem;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }

    .fn-highlight {
        font-size: 0.7rem;
        font-weight: 700;
        color: #ffe04b;
        text-transform: uppercase;
        letter-spacing: 0.1em;
    }

    .fn-card-name {
        font-size: 1.1rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    .fn-card-desc {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.4;
        margin: 0;
    }

    .fn-tags {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
        margin-top: 0.25rem;
    }

    .fn-tag {
        font-size: 0.7rem;
        padding: 0.2rem 0.5rem;
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        color: #ffe04b;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    /* ── ROBLOX TAB ──────────────────────────────── */
    .rb-header {
        text-align: center;
        margin-bottom: 1.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
    }

    .rb-logo {
        height: 48px;
        object-fit: contain;
        filter: drop-shadow(0 0 12px rgba(226, 35, 26, 0.5));
    }

    .rb-subtitle {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.6);
        margin: 0;
        line-height: 1.6;
        max-width: 580px;
    }

    .rb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 0.5rem;
    }

    .rb-card {
        display: flex;
        gap: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        padding: 0.5rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .rb-card:hover {
        transform: translateY(-4px);
        border-color: var(--unrender-accent, #f5a623);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }

    .rb-icon {
        width: 36px;
        height: 36px;
        border-radius: 0.4rem;
        border: 1px solid;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        flex-shrink: 0;
    }

    .rb-info {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        flex: 1;
    }

    .rb-name {
        font-size: 1.1rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    .rb-desc {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.4;
        margin: 0;
    }

    .rb-tags {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
    }

    .rb-tag {
        font-size: 0.75rem;
        padding: 0.2rem 0.5rem;
        border-radius: 0.5rem;
        border: 1px solid;
        background: transparent;
    }

    /* ── Responsive ──────────────────────────────── */
    @media (max-width: 768px) {
        .pf-panel {
            max-height: 95vh;
        }
        /* Tab responsive styles handled by Tailwind classes in HTML */

        .viewer-layout {
            flex-direction: column;
            height: auto;
        }

        .model-list {
            width: 100%;
            flex-direction: row;
            overflow-x: auto;
            overflow-y: hidden;
            height: 64px;
            flex-shrink: 0;
        }

        .model-list-title {
            display: none;
        }

        .model-item {
            flex-direction: column;
            align-items: center;
            gap: 0.25rem;
            min-width: 72px;
            padding: 0.5rem 0.4rem;
            border-bottom: none;
            border-right: 1px solid rgba(111, 163, 255, 0.07);
        }

        .model-item.selected {
            border-left: none;
            border-bottom: 2px solid #6fa3ff;
        }

        .model-item-name {
            font-size: 0.55rem;
            text-align: center;
        }

        .viewer-canvas-wrap {
            height: 140px;
        }

        .pf-grid {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 0.5rem;
        }

        .av-grid,
        .fn-grid,
        .rb-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 0.35rem;
        }
    }

    @media (max-width: 480px) {
        .pf-grid {
            grid-template-columns: 1fr;
            gap: 0.4rem;
        }
        .av-grid,
        .fn-grid,
        .rb-grid {
            grid-template-columns: 1fr;
            gap: 0.4rem;
        }
        .viewer-canvas-wrap {
            height: 120px;
        }
    }
</style>
