<script>
    import { onMount, onDestroy } from "svelte";
    import { registerRenderer, unregisterRenderer } from "./debugStore.js";
    import PrinceOfPersiaHero from "./PrinceOfPersiaHero.svelte";
    import WebInterativa from "./WebInterativa.svelte";

    let scrollY = 0;
    let innerHeight = 0;
    let scrollProgress = 0;
    let canvasIndicator; // Canvas reference

    $: if (typeof window !== "undefined" && innerHeight) {
        const maxScroll = document.body.scrollHeight - innerHeight;
        scrollProgress = maxScroll > 0 ? scrollY / maxScroll : 0;
    }

    // React to scroll or resize for canvas
    $: if (canvasIndicator && (scrollY || innerHeight || scrollProgress >= 0)) {
        drawScrollPath();
    }

    function drawScrollPath() {
        if (!canvasIndicator) return;
        const ctx = canvasIndicator.getContext("2d");
        const w = canvasIndicator.width;
        const h = canvasIndicator.height;

        ctx.clearRect(0, 0, w, h);

        // Configuration
        const center = w / 2;
        const padY = 40; // Padding from top/bottom to prevent cut-off
        const usableH = h - padY * 2;

        // Loop Physics
        const loops = 5;
        const loopRadius = 30;

        // Parametric Function for Path
        const getPathPos = (t) => {
            const baseY = padY + t * usableH;
            const angle = t * Math.PI * 2 * loops;
            const x = center + Math.sin(angle) * loopRadius;
            const y = baseY + Math.cos(angle + Math.PI) * 25;
            return { x, y };
        };

        // 1. Draw Faint Path
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        const steps = 200;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const pos = getPathPos(t);
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
        }
        ctx.stroke();

        // 2. Draw Filled Path
        ctx.beginPath();
        ctx.strokeStyle = "#ffa500";
        ctx.lineWidth = 3;
        ctx.setLineDash([]);

        const currentT = scrollProgress;
        const drawSteps = Math.ceil(currentT * steps);

        for (let i = 0; i <= drawSteps; i++) {
            const t = i / steps;
            if (t > currentT) break;
            const pos = getPathPos(t);
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
        }
        const finalPos = getPathPos(currentT);
        ctx.lineTo(finalPos.x, finalPos.y);
        ctx.stroke();

        // 3. Draw Plane
        const p1 = getPathPos(currentT);
        const p2 = getPathPos(currentT + 0.005);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rot = Math.atan2(dy, dx) - Math.PI / 2;

        ctx.save();
        ctx.translate(finalPos.x, finalPos.y);
        ctx.rotate(rot);

        const size = 14;
        ctx.fillStyle = "#ffa500";
        ctx.shadowColor = "rgba(255,165,0,0.5)";
        ctx.shadowBlur = 6;

        ctx.beginPath();
        ctx.moveTo(0, size);
        ctx.lineTo(size * 0.7, -size);
        ctx.lineTo(0, -size * 0.4);
        ctx.lineTo(-size * 0.7, -size);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    onMount(() => {
        registerRenderer(null, "Retro Rotoscopy Canvas", "high");
    });

    onDestroy(() => {
        unregisterRenderer();
    });
</script>

<svelte:window bind:scrollY bind:innerHeight />

<!-- Scroll Indicator -->
<div class="scroll-indicator-container">
    <canvas
        bind:this={canvasIndicator}
        width="100"
        height={innerHeight ? innerHeight * 0.6 : 500}
        class="scroll-canvas"
    ></canvas>
</div>

<!-- Hero Section: Prince of Persia Atari Classic Dungeon + Rotoscoped Prince + UI/UX Copy -->
<PrinceOfPersiaHero />

<!-- Content Section 2: Micro-Interações 2D & Efeitos -->
<section
    class="content-section bg-[#14121d] py-24 relative z-20 overflow-hidden border-t border-white/5"
>
    <div
        class="absolute inset-0 bg-gradient-to-br from-orange-950/15 via-purple-950/20 to-slate-950/40 pointer-events-none z-0"
    ></div>
    <div class="container mx-auto px-6 relative z-10">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
                <span class="text-orange-400 font-mono text-xs uppercase tracking-wider font-bold">
                    DESIGN DE INTERFACE REATIVO
                </span>
                <h2 class="text-4xl md:text-5xl font-black text-white mt-2 mb-6">
                    Efeitos Interativos 2D & Micro-Interações
                </h2>
                <p class="text-lg text-gray-300 mb-6 leading-relaxed">
                    Interfaces vivas que respondem a gestos, cliques e rolagem. Criamos
                    animações super fluidas, micro-interações instantâneas e efeitos visuais
                    que mantêm os olhos do usuário vidrados no seu conteúdo.
                </p>
                <ul class="space-y-4">
                    <li class="flex items-center gap-3">
                        <div
                            class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold"
                        >
                            1
                        </div>
                        <span class="font-medium text-gray-200"
                            >Animações e Transições Fluidas (60+ FPS)</span
                        >
                    </li>
                    <li class="flex items-center gap-3">
                        <div
                            class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold"
                        >
                            2
                        </div>
                        <span class="font-medium text-gray-200"
                            >Micro-interações Reativas em Tempo Real</span
                        >
                    </li>
                    <li class="flex items-center gap-3">
                        <div
                            class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold"
                        >
                            3
                        </div>
                        <span class="font-medium text-gray-200"
                            >Efeitos Visuais e Iluminação Shader</span
                        >
                    </li>
                </ul>
            </div>
            <div
                class="rounded-3xl p-4 md:p-8 min-h-[400px] flex items-center justify-center relative overflow-hidden bg-white/5 border border-white/10 shadow-2xl backdrop-blur-sm"
            >
                <div class="absolute top-6 left-6 z-20 pointer-events-none">
                    <span
                        class="text-orange-400/70 text-xs font-mono uppercase tracking-widest font-bold"
                        >Demonstração • Micro-Interações 2D</span
                    >
                </div>
                <div
                    class="w-full h-full relative z-10 flex items-center justify-center pt-8"
                >
                    <WebInterativa />
                </div>
            </div>
        </div>

        <div class="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
            {#each [
                { title: "Gráficos & Shaders", desc: "Criamos mundos tridimensionais e efeitos com WebGL, WebGPU e Canvas 2D garantindo alta performance e fidelidade visual em qualquer dispositivo." },
                { title: "UI e Elementos 2D", desc: "Integramos interfaces modernas, tipografia fluida e micro-interações que elevam a experiência e percepção de valor da sua marca." },
                { title: "Gamificação de Conversão", desc: "Ao combinar dinâmicas de jogos com narrativa comercial, transformamos o tempo de permanência no site em receita real." }
            ] as tech}
                <div
                    class="p-8 border border-white/10 rounded-2xl hover:border-orange-500/30 transition-all bg-white/5 hover:bg-white/10 backdrop-blur-sm shadow-xl"
                >
                    <h3 class="text-xl font-bold text-white mb-3">
                        {tech.title}
                    </h3>
                    <p class="text-gray-300 text-sm leading-relaxed">
                        {tech.desc}
                    </p>
                </div>
            {/each}
        </div>
    </div>
</section>

<style>
    :global(body) {
        margin: 0;
        background-color: #12101b;
        overflow-x: hidden;
    }

    /* Scroll Indicator */
    .scroll-indicator-container {
        position: fixed;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        height: auto;
        z-index: 100;
        display: flex;
        flex-direction: column;
        align-items: center;
        pointer-events: none;
    }
</style>
