<script>
    import { onMount, onDestroy } from "svelte";
    import Spinner from "./Spinner.svelte";
    import { hasSeenSplashScreen, globalLoading } from "./modalStore.js";
    import MocapComponent from "./MocapComponent.svelte";
    import { gsap } from "gsap";
    import { ScrollTrigger } from "gsap/ScrollTrigger";
    import { registerRenderer, unregisterRenderer } from "./debugStore.js";
    import { createRenderer } from "./threeRenderer.js";

    if (typeof window !== "undefined") {
        gsap.registerPlugin(ScrollTrigger);
    }

    let scrollContainer;
    let container;
    let renderer;
    let scene;
    let camera;
    let cube;
    let raf;
    let resizeHandler;
    let scrollCleanup;
    let isInitialized = false;
    let cameraStream = null;
    let cameraPermissionGranted = false;
    let showMocap = false;
    let scrollY = 0;
    let innerHeight = 0;

    // Reset global loading immediately when component is instantiated
    globalLoading.set(true);

    let isDestroyed = false;

    $: isBottom =
        typeof document !== "undefined"
            ? scrollY + innerHeight >=
              document.documentElement.scrollHeight - 100
            : false;

    const handleScrollClick = () => {
        if (isBottom) {
            window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
            window.scrollTo({
                top: scrollY + window.innerHeight,
                behavior: "smooth",
            });
        }
    };

    // Camera permission request
    async function requestCameraPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
            });
            cameraStream = stream;
            cameraPermissionGranted = true;
            // We don't stop the tracks immediately so the light stays on/permission persists,
            // or we can stop and let components re-request.
            // For now, we keep it active as "Shared Camera" concept.
        } catch (err) {
            console.error("Camera permission denied", err);
        }
    }

    // Helper to create text textures
    function createTextTexture(text, color, bgColor, rotation = 0) {
        const canvas = document.createElement("canvas");
        // High res for full screen
        canvas.width = 2048;
        canvas.height = 2048;
        const ctx = canvas.getContext("2d");

        // Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 2048, 2048);

        ctx.save();
        ctx.translate(1024, 1024);
        ctx.rotate(rotation);
        ctx.translate(-1024, -1024);

        // Text
        ctx.fillStyle = color;
        ctx.font = 'bold 80px "Montserrat", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const lines = text.split("\n");
        const lineHeight = 120;
        const startY = 1024 - ((lines.length - 1) * lineHeight) / 2;

        lines.forEach((line, i) => {
            ctx.fillText(line, 1024, startY + i * lineHeight);
        });

        ctx.restore();

        return canvas;
    }

    onMount(() => {
        const setup = async () => {
            if (!isInitialized) {
                const THREE = await import("three");

                scene = new THREE.Scene();
                scene.background = new THREE.Color(0x000000);

                // Camera setup
                // Increase distance and decrease FOV to flatten perspective slightly
                const cameraZ = 20;
                const fov = 25; // Adjusted for new distance roughly maintaining scale
                camera = new THREE.PerspectiveCamera(
                    fov,
                    window.innerWidth / window.innerHeight,
                    0.1,
                    1000,
                );
                camera.position.set(0, 0, cameraZ);

                const isMobileRenderer = window.innerWidth < 768;
                const result = await createRenderer({
                    antialias: !isMobileRenderer,
                    alpha: true,
                });
                renderer = result.renderer;
                const currentRenderer = result.currentRenderer;

                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.setPixelRatio(isMobileRenderer ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
                renderer.domElement.style.position = "fixed";
                renderer.domElement.style.top = "0";
                renderer.domElement.style.left = "0";
                renderer.domElement.style.zIndex = "1"; // Canvas behind CSS
                container.appendChild(renderer.domElement);

                // Register renderer for global debug overlay
                registerRenderer(renderer, currentRenderer);

                // Import CSS3D
                // Versão do bundle (mesma do resto do site); antes baixava um
                // segundo three 0.160 inteiro do unpkg só para o CSS3D.
                const { CSS3DRenderer, CSS3DObject } = await import(
                    "three/examples/jsm/renderers/CSS3DRenderer.js"
                );

                // CSS3D Renderer
                const cssRenderer = new CSS3DRenderer();
                cssRenderer.setSize(window.innerWidth, window.innerHeight);
                cssRenderer.domElement.style.position = "fixed";
                cssRenderer.domElement.style.top = "0";
                cssRenderer.domElement.style.left = "0";
                cssRenderer.domElement.style.zIndex = "2"; // CSS on top
                // Allow scroll to pass through the renderer area, but enable events on children (mocapDiv)
                cssRenderer.domElement.style.pointerEvents = "none";
                container.appendChild(cssRenderer.domElement);

                // Calculate visible height at z=0 (where the front face will be)
                const vFOV = THREE.MathUtils.degToRad(fov);
                const visibleHeight = 2 * Math.tan(vFOV / 2) * cameraZ;
                const visibleWidth = visibleHeight * camera.aspect;

                // Textures
                // Use unified background color to hide cube edges
                const bgColor = "#000000";

                // Face 1: Front - Text removed as per request
                // const face1Canvas = createTextTexture(
                //    "AUDIOVISUAL\n\nReal-time 3D for VFX\nGreen Screen & Virtual Sets\nMovie & TV Production\n\n(3D Spatial Audio Available)",
                //    "#ffffff",
                //    bgColor,
                // );
                // const face1Texture = new THREE.CanvasTexture(face1Canvas);
                // face1Texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

                // Face 2: Bottom (Rotates up)
                // Text removed as per request. Using black material matching other sides.
                // const face2Canvas = createTextTexture(...) -> Removed

                const materials = [
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Right
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Left
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Top
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Bottom (Face 2) - Changed to Color
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Front (Face 1) - Text Removed
                    new THREE.MeshBasicMaterial({ color: 0x000000 }), // Back
                ];

                const geometry = new THREE.BoxGeometry(1, 1, 1);
                cube = new THREE.Mesh(geometry, materials);

                // Initial sizing
                cube.scale.set(visibleWidth, visibleHeight, visibleHeight);
                // Position the cube so its front face is at z=0.
                // Cube depth is visibleHeight. Center z is -visibleHeight/2.
                cube.position.z = -visibleHeight / 2;

                scene.add(cube);

                // Mocap CSS3D Object
                // We want to attach the Mocap layout to Face 2 (Bottom).
                // Face 2 is at y = -0.5 (relative to unit cube), with specific rotation.
                // Since we scale the cube, we must be careful. CSS3DObject inherits scale if attached to mesh.
                // But HTML elements don't scale nicely with CSS3D if parent is scaled with 'scale.set'.
                // Actually, CSS3DObject *does* scale the DOM element via matrix3d.
                // So if the cube is 20 units big, the DIV will be blown up 20x.
                // We need the DIV to be high-res (e.g. 1024px) but visually fit the face (1 unit).
                // So we scale the CSS3DObject down by 1/visibleHeight. Or set size appropriately.

                // Create a wrapper for the CSS Object
                // Create a wrapper for the CSS Object
                const mocapDiv = document.createElement("div");

                // To prevent clipping/stretching issues, we make the DIV match the aspect ratio of the target face ON SCREEN.
                // When face 2 is viewed, it fills the screen. So the aspect ratio is window.innerWidth / window.innerHeight.
                // We set the resolution high enough for clarity.
                const targetWidth = window.innerWidth;
                const targetHeight = window.innerHeight;

                mocapDiv.style.width = targetWidth + "px";
                mocapDiv.style.height = targetHeight + "px";
                mocapDiv.style.background = "#000"; // Keep black background for seamless blend
                mocapDiv.style.pointerEvents = "auto";
                mocapDiv.style.display = "flex";
                mocapDiv.style.flexDirection = "column";
                mocapDiv.style.alignItems = "center";
                mocapDiv.style.justifyContent = "center";
                mocapDiv.style.boxSizing = "border-box";
                mocapDiv.style.opacity = "0"; // Start hidden to prevent perspective leak

                // Create Layout Container
                const layoutContainer = document.createElement("div");
                layoutContainer.style.position = "relative"; // For absolute children
                layoutContainer.style.width = "100%";
                layoutContainer.style.height = "100%";
                layoutContainer.style.overflow = "hidden"; // Keep content inside face
                mocapDiv.appendChild(layoutContainer);

                // Helper to animate Local Orbit (Text + GIF pair)
                const animateLocalOrbit = (
                    el,
                    cx,
                    cy,
                    radius,
                    duration,
                    startAngle = 0,
                ) => {
                    el.style.left = '0px';
                    el.style.top = '0px';
                    el.style.willChange = 'transform';
                    
                    const proxy = { angle: startAngle };

                    gsap.to(proxy, {
                        angle: startAngle + Math.PI * 2,
                        duration: duration,
                        repeat: -1,
                        ease: "none",
                        onUpdate: () => {
                            const x =
                                cx +
                                Math.cos(proxy.angle) * radius -
                                el.offsetWidth / 2;
                            const y =
                                cy +
                                Math.sin(proxy.angle) * radius -
                                el.offsetHeight / 2;
                            el.style.transform = `translate(${x}px, ${y}px)`;
                        },
                    });
                };

                // GIFs — exactly 3, one per cluster (top, left, right)
                // Cluster 0 (top): "Captura de movimento e expressões faciais"
                // Cluster 1 (left): "Modelagem e animação de personagens"
                // Cluster 2 (right): "Avatares 2D e 3D"
                const gifPaths = [
                    "/images/metahuman.mp4", // top  – motion capture silhouette
                    "/images/animations.webp", // left – character modelling (video)
                    "/images/mocap4.webp", // right – avatar / metahuman
                ];

                const centerX = targetWidth / 2;
                const centerY = targetHeight / 2;

                // --- TEXT ELEMENTS ---
                const textData = [
                    {
                        title: "",
                        desc: "Captura de movimento e expressões faciais",
                    },
                    {
                        title: "",
                        desc: "Modelagem e animação de personagens",
                    },
                    {
                        title: "",
                        desc: "Avatares animados em tempo real",
                    },
                ];

                const isMobile = window.innerWidth < 768;
                const textGroupWidth = isMobile ? "140px" : "300px";
                const titleSize = isMobile ? "1.2rem" : "2.5rem";
                const descSize = isMobile ? "0.8rem" : "1.2rem";
                const orbitRadius = isMobile ? 40 : 60;
                const gifSize = isMobile ? "80px" : "150px";

                const createTextGroup = (data) => {
                    const container = document.createElement("div");
                    container.style.position = "absolute";
                    container.style.width = textGroupWidth; // Responsive width
                    container.style.textAlign = "center";
                    container.style.pointerEvents = "none";
                    container.style.zIndex = "40"; // HIGHEST: Text on top of Mocap

                    const t = document.createElement("div");
                    t.innerText = data.title;
                    t.style.fontFamily =
                        '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
                    t.style.fontSize = titleSize;
                    t.style.fontWeight = "800";
                    t.style.color = "#ffffff";
                    t.style.letterSpacing = "-0.02em";
                    t.style.textShadow = "0 4px 20px rgba(0,0,0,0.5)";

                    const d = document.createElement("div");
                    d.innerText = data.desc;
                    d.style.fontFamily =
                        '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
                    d.style.fontSize = descSize;
                    d.style.fontWeight = "400";
                    d.style.color = "rgba(255,255,255,0.8)";
                    d.style.marginTop = "0.5rem";

                    container.appendChild(t);
                    container.appendChild(d);
                    return container;
                };

                // Cluster Centers
                // Adaptive positioning
                const xSpread = isMobile ? window.innerWidth * 0.35 : 450;
                const yOffsetTop = isMobile ? 220 : 280;
                const yOffsetBottom = isMobile ? 180 : 150;

                // Top Center (Moved down for navbar)
                const topCluster = { x: centerX, y: centerY - yOffsetTop };
                // Left Cluster
                const leftCluster = {
                    x: centerX - xSpread,
                    y: centerY + yOffsetBottom,
                };
                // Right Cluster
                const rightCluster = {
                    x: centerX + xSpread,
                    y: centerY + yOffsetBottom,
                };

                const clusters = [topCluster, leftCluster, rightCluster];

                // Create and Animate Text Groups (Orbiting their cluster center)
                textData.forEach((data, i) => {
                    const el = createTextGroup(data);
                    layoutContainer.appendChild(el);

                    const center = clusters[i] || topCluster;
                    const radius = orbitRadius;
                    const duration = 15 + Math.random() * 5;

                    // Start Text at Angle 0 (Right of center), GIF will be at PI (Left)
                    animateLocalOrbit(
                        el,
                        center.x,
                        center.y,
                        radius,
                        duration,
                        0,
                    );
                });

                // --- MOCAP CONTAINER (CENTER) ---
                const mocapBaseSize = 400;
                const mocapSize = isMobile
                    ? Math.min(mocapBaseSize, window.innerWidth * 0.8)
                    : mocapBaseSize;

                const mocapSlot = document.createElement("div");
                mocapSlot.style.width = mocapSize + "px";
                mocapSlot.style.height = mocapSize + "px";
                mocapSlot.style.borderRadius = "2.5rem"; // More apple-like rounded
                mocapSlot.style.overflow = "hidden";
                mocapSlot.style.border = "1px solid rgba(255,255,255,0.1)";
                mocapSlot.style.boxShadow = "0 20px 80px rgba(0,0,0,0.6)"; // Deep shadow
                mocapSlot.style.background = "rgba(20,20,20,0.5)"; // Glassy backing
                mocapSlot.style.backdropFilter = "blur(20px)";
                mocapSlot.style.flexShrink = "0";
                mocapSlot.id = "mocap-slot";
                mocapSlot.style.position = "absolute";
                mocapSlot.style.zIndex = "30"; // Middle: Behind Text (40), Above GIFs (10)

                // Centered based on size
                mocapSlot.style.left = `${centerX - mocapSize / 2}px`;
                mocapSlot.style.top = `${centerY - mocapSize / 2}px`;

                layoutContainer.appendChild(mocapSlot);

                // Animate Mocap (Subtle float, not orbit)
                mocapSlot.style.willChange = "transform";
                gsap.to(mocapSlot, {
                    y: 20,
                    duration: 4,
                    yoyo: true,
                    repeat: -1,
                    ease: "sine.inOut",
                });

                // --- LOCAL ORBITING MEDIA (Paired with Text, one per cluster) ---
                gifPaths.forEach((src, i) => {
                    const targetCenter = clusters[i]; // Direct 1-to-1 pairing
                    const isVideo = src.toLowerCase().endsWith(".mp4");
                    let media;
                    if (isVideo) {
                        media = document.createElement("video");
                        media.src = src;
                        media.muted = true;
                        media.loop = true;
                        media.autoplay = true;
                        media.playsInline = true;
                        media.setAttribute("playsinline", "");
                        media.play().catch(() => {});
                    } else {
                        media = document.createElement("img");
                        media.src = src;
                    }
                    media.style.width = gifSize;
                    media.style.height = gifSize;
                    media.style.objectFit = "cover"; // Ensure it fills with rounded corners
                    media.style.borderRadius = "1rem";
                    media.style.position = "absolute";
                    media.style.zIndex = "10";
                    media.style.opacity = "0.8";

                    layoutContainer.appendChild(media);

                    const radius = orbitRadius;
                    const duration = 15 + Math.random() * 5;

                    // Start media at Angle PI (Opposite to Text at 0)
                    animateLocalOrbit(
                        media,
                        targetCenter.x,
                        targetCenter.y,
                        radius,
                        duration,
                        Math.PI,
                    );
                });

                // We move the existing svelte component container INTO this div?
                // Svelte component is rendered in the body via slot or binding?
                // Currently it's in the markup: <div class="mocap-container" bind:this={mocapContainer}>...</div>
                // We can append that DOM node to our CSS Object div.

                const cssObject = new CSS3DObject(mocapDiv);
                // Position on Bottom Face
                // Center of bottom face is (0, -0.5, 0).
                // Rotation: Face 2 material points 'down'. But we want it to be 'front' when rotated up.
                // Standard Box UV: Bottom face is oriented... let's trial and error or deduction.
                // Bottom face normal is (0, -1, 0).
                // To make an object coplanar with bottom face facing OUT, we rotate X by 90 deg (PI/2).
                cssObject.position.set(0, -0.5, 0);
                cssObject.rotation.x = Math.PI / 2;

                // Scale: The div is targetWidth x targetHeight.
                // The face geometry is 1 unit x 1 unit.
                // We want the div to fit exactly into the 1x1 face.
                // So scale X = 1 / targetWidth. Scale Y = 1 / targetHeight.
                // HOWEVER: The global scaling of the cube (visibleWidth, visibleHeight) stretches this 1x1 face.
                // visibleWidth/visibleHeight = aspect ratio.
                // So the 1x1 face becomes aspect x 1 in world space.
                // If our DIV is aspect x 1 (in pixels ratio), and we scale it to 1x1 (local), it becomes aspect x 1 (world).
                // So if width = 1920, height = 1080.
                // scale X = 1/1920. scale Y = 1/1080.
                // cssObject local size becomes 1x1.
                // Cube stretches it to visibleWidth x visibleHeight.
                // visibleWidth/visibleHeight is ALSO 1920/1080.
                // So the final aspect ratio is preserved perfectly.
                cssObject.scale.set(
                    1 / targetWidth,
                    1 / targetHeight,
                    1 / targetWidth,
                ); // Z scale matters less but keep consistent-ish

                cube.add(cssObject);

                // Allow access to append content
                // We need a way to move the Svelte element into 'mocapDiv'
                // We can do this in a reactive statement or right here if we use a global variable or querySelector.
                // Let's use a querySelector for the container we want to move.
                // But we need to make sure Svelte has rendered it.

                const moveMocapToCube = () => {
                    console.log("Attempting to move Mocap component...");
                    const existingContainer = document.querySelector(
                        ".mocap-content-wrapper",
                    );
                    const slot = document.getElementById("mocap-slot");

                    if (existingContainer && slot) {
                        // Check if it's already there
                        if (slot.contains(existingContainer)) {
                            console.log("Mocap already in slot.");
                            return;
                        }
                        console.log(
                            "Found container and slot, moving...",
                            existingContainer,
                            slot,
                        );

                        // Force visibility before moving
                        existingContainer.style.display = "block !important";
                        existingContainer.style.width = "100%";
                        existingContainer.style.height = "100%";

                        slot.appendChild(existingContainer);

                        // Verify
                        setTimeout(() => {
                            existingContainer.style.display = "block";
                            console.log(
                                "Mocap display set to block. Parent:",
                                existingContainer.parentElement,
                            );
                        }, 100);
                    } else {
                        console.warn(
                            "Mocap container or slot not found yet, retrying...",
                            { existingContainer, slot },
                        );
                        setTimeout(moveMocapToCube, 500); // Retry
                    }
                };

                // Start checking
                setTimeout(moveMocapToCube, 500);

                // ── VFX Comparison Slider on Front Face ───────────────────────
                const vfxDiv = document.createElement("div");
                vfxDiv.style.width = targetWidth + "px";
                vfxDiv.style.height = targetHeight + "px";
                vfxDiv.style.background = "transparent";
                vfxDiv.style.pointerEvents = "auto";
                vfxDiv.style.display = "flex";
                vfxDiv.style.flexDirection = "column";
                vfxDiv.style.alignItems = "center";
                vfxDiv.style.justifyContent = "center";
                vfxDiv.style.boxSizing = "border-box";
                vfxDiv.style.position = "relative";

                // VFX Layout Container
                const vfxLayoutContainer = document.createElement("div");
                vfxLayoutContainer.style.position = "relative";
                vfxLayoutContainer.style.width = "100%";
                vfxLayoutContainer.style.height = "100%";
                vfxLayoutContainer.style.overflow = "hidden";
                vfxDiv.appendChild(vfxLayoutContainer);

                // Floating Elements for VFX Face
                const vfxTextData = [
                    {
                        title: "",
                        desc: "Composição em Tempo Real",
                    },
                    {
                        title: "",
                        desc: "Produção Virtual",
                    },
                    {
                        title: "",
                        desc: "Animações Pré-Renderizadas",
                    },
                ];

                // VFX face media — exactly 3, one per cluster (top, left, right)
                // Cluster 0 (top): "Real-time VFX"
                // Cluster 1 (left): "Produção Virtual"
                // Cluster 2 (right): "Post-Processing"
                const vfxGifPaths = [
                    "/images/composition.mp4", // left – composited virtual scene
                    "/images/audiovisual-vfx.webp", // top  – real-time VFX effect
                    "/images/prerender.mp4", // right – raw green screen footage
                ];

                vfxTextData.forEach((data, i) => {
                    const el = createTextGroup(data);
                    vfxLayoutContainer.appendChild(el);
                    const center = clusters[i] || topCluster;
                    const radius = orbitRadius;
                    const duration = 15 + Math.random() * 5;
                    animateLocalOrbit(
                        el,
                        center.x,
                        center.y,
                        radius,
                        duration,
                        0,
                    );
                });

                vfxGifPaths.forEach((src, i) => {
                    const targetCenter = clusters[i % 3];
                    const isVideo = src.toLowerCase().endsWith(".mp4");
                    let media;
                    if (isVideo) {
                        media = document.createElement("video");
                        media.src = src;
                        media.muted = true;
                        media.loop = true;
                        media.autoplay = true;
                        media.playsInline = true;
                        media.setAttribute("playsinline", "");
                        media.play().catch(() => {});
                    } else {
                        media = document.createElement("img");
                        media.src = src;
                    }
                    media.style.width = gifSize;
                    media.style.height = gifSize;
                    media.style.objectFit = "cover"; // Ensure it fills with rounded corners
                    media.style.borderRadius = "1rem";
                    media.style.position = "absolute";
                    media.style.zIndex = "10";
                    media.style.opacity = "0.8";
                    vfxLayoutContainer.appendChild(media);
                    const radius = orbitRadius;
                    const duration = 15 + Math.random() * 5;
                    animateLocalOrbit(
                        media,
                        targetCenter.x,
                        targetCenter.y,
                        radius,
                        duration,
                        Math.PI,
                    );
                });

                // Slider setup
                const sliderW = Math.min(targetWidth * 0.448, 448);
                const sliderH = sliderW * (9 / 16);

                const vfxOuter = document.createElement("div");
                vfxOuter.style.cssText =
                    "display:flex;flex-direction:column;align-items:center;gap:16px;position:absolute;z-index:30;";
                vfxOuter.style.left = `${centerX - sliderW / 2}px`; // Centered
                vfxOuter.style.top = `${centerY - sliderH / 2}px`; // Centered

                const vfxWrap = document.createElement("div");
                vfxWrap.style.cssText =
                    "position:relative;display:flex;align-items:center;justify-content:center;";

                // Label badges - responsive to prevent overlap on mobile
                const makeBadge = (text, side) => {
                    const el = document.createElement("div");
                    el.innerText = text;
                    const fontSize = isMobile ? "8px" : "10px";
                    const padding = isMobile ? "4px 8px" : "5px 11px";
                    const sideOffset = isMobile ? "8px" : "16px";
                    const topVal = isMobile
                        ? side === "left"
                            ? "25%"
                            : "75%"
                        : "50%";

                    el.style.cssText = `position:absolute;${side}:${sideOffset};top:${topVal};transform:translateY(-50%);font-family:Montserrat,sans-serif;font-size:${fontSize};font-weight:700;letter-spacing:0.12em;color:white;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);padding:${padding};border-radius:999px;pointer-events:none;z-index:8;white-space:nowrap;`;
                    return el;
                };
                vfxWrap.appendChild(makeBadge("TELA VERDE", "left"));
                vfxWrap.appendChild(makeBadge("CENA FINAL", "right"));

                const vfxComparison = document.createElement("div");
                vfxComparison.style.cssText = `position:relative;width:${sliderW}px;height:${sliderH}px;overflow:hidden;border-radius:1.5rem;box-shadow:0 0 80px rgba(0,0,0,0.9),0 0 0 2px rgba(255,255,255,0.1);`;

                const vfxAfter = document.createElement("img");
                vfxAfter.src = "/images/greenscreen-vfx.webp";
                vfxAfter.alt = "Post VFX Scene";
                vfxAfter.style.cssText =
                    "display:block;width:100%;height:100%;object-fit:cover;user-select:none;pointer-events:none;border-radius:1.5rem;";

                const vfxBefore = document.createElement("img");
                vfxBefore.src = "/images/greenscreen.webp";
                vfxBefore.alt = "Tela Verde";
                vfxBefore.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;user-select:none;pointer-events:none;clip-path:inset(0 50% 0 0);border-radius:1.5rem;";

                const vfxLine = document.createElement("div");
                vfxLine.style.cssText =
                    "position:absolute;top:0;bottom:0;left:50%;width:3px;background:rgba(255,255,255,0.9);transform:translateX(-50%);pointer-events:none;z-index:5;box-shadow:0 0 12px rgba(255,255,255,0.5);";

                const vfxBtn = document.createElement("div");
                vfxBtn.style.cssText =
                    "position:absolute;top:50%;left:50%;width:44px;height:44px;transform:translate(-50%,-50%);background:white;border-radius:50%;pointer-events:none;z-index:6;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.4);";
                vfxBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 10L2 7V13L6 10Z" fill="#333"/><path d="M14 10L18 7V13L14 10Z" fill="#333"/><line x1="10" y1="2" x2="10" y2="18" stroke="#333" stroke-width="2"/></svg>`;

                const vfxRange = document.createElement("input");
                vfxRange.type = "range";
                vfxRange.min = "0";
                vfxRange.max = "100";
                vfxRange.value = "50";
                vfxRange.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:ew-resize;z-index:10;margin:0;";
                vfxRange.addEventListener("input", (e) => {
                    const v = Number(e.target.value);
                    vfxBefore.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
                    vfxLine.style.left = `${v}%`;
                    vfxBtn.style.left = `${v}%`;
                });

                vfxComparison.appendChild(vfxAfter);
                vfxComparison.appendChild(vfxBefore);
                vfxComparison.appendChild(vfxLine);
                vfxComparison.appendChild(vfxBtn);
                vfxComparison.appendChild(vfxRange);
                vfxWrap.appendChild(vfxComparison);

                const vfxCaption = document.createElement("p");
                vfxCaption.innerText = "Arraste para comparar";
                vfxCaption.style.cssText =
                    "color:rgba(255,255,255,0.5);font-family:Montserrat,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;margin:0;user-select:none;";

                vfxOuter.appendChild(vfxWrap);
                vfxOuter.appendChild(vfxCaption);
                vfxLayoutContainer.appendChild(vfxOuter);

                // Attach as CSS3DObject to the front face (z = +0.5 local, no rotation)
                const vfxCssObject = new CSS3DObject(vfxDiv);
                vfxCssObject.position.set(0, 0, 0.5); // Centered on face
                vfxCssObject.scale.set(
                    1 / targetWidth,
                    1 / targetHeight,
                    1 / targetWidth,
                );
                cube.add(vfxCssObject);

                // Resize handler
                resizeHandler = function onResize() {
                    const w = window.innerWidth;
                    const h = window.innerHeight;

                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                    renderer.setSize(w, h);
                    cssRenderer.setSize(w, h);

                    // Update mocap CSS Object
                    mocapDiv.style.width = w + "px";
                    mocapDiv.style.height = h + "px";
                    cssObject.scale.set(1 / w, 1 / h, 1 / w);

                    // Update VFX CSS Object
                    vfxDiv.style.width = w + "px";
                    vfxDiv.style.height = h + "px";
                    vfxCssObject.scale.set(1 / w, 1 / h, 1 / w);

                    // Re-calculate dimensions
                    const vH =
                        2 * Math.tan(THREE.MathUtils.degToRad(25) / 2) * 20;
                    const vW = vH * camera.aspect;

                    cube.scale.set(vW, vH, vH);
                    cube.position.z = -vH / 2;
                };

                await requestCameraPermission();

                window.addEventListener("resize", resizeHandler);

                async function animate() {
                    raf = requestAnimationFrame(animate);
                    if (renderer && scene && camera) {
                        if (renderer.info) renderer.info.reset();

                        renderer.render(scene, camera); // init() já foi aguardado: render síncrono (sem await por frame)
                    }
                    if (cssRenderer) cssRenderer.render(scene, camera);
                }

                animate();

                // GSAP ScrollTrigger
                try {
                    const gsapModule = await import("gsap");
                    const gsap =
                        gsapModule.gsap || gsapModule.default || gsapModule;
                    const stModule = await import("gsap/ScrollTrigger");
                    const ScrollTrigger =
                        stModule.ScrollTrigger || stModule.default || stModule;
                    if (typeof window !== "undefined") {
        gsap.registerPlugin(ScrollTrigger);
    }

                    // Rotate X by -90 degrees (-PI/2)
                    // We want the Bottom face to come to the front.
                    // A negative rotation around X moves the Bottom face towards the camera.
                    // Create Timeline for sync
                    const tl = gsap.timeline({
                        scrollTrigger: {
                            trigger: scrollContainer,
                            start: "top top",
                            end: "bottom-=100 bottom",
                            scrub: 0.5,
                            pin: false,
                            onUpdate: (self) => {
                                if (self.progress > 0.8) {
                                    showMocap = true;
                                } else {
                                    showMocap = false;
                                }
                            },
                        },
                    });

                    tl.to(cube.rotation, {
                        x: -Math.PI / 2, // Rotate -90 degrees
                        ease: "none",
                    }).to(
                        mocapDiv.style,
                        {
                            opacity: "1",
                            ease: "none",
                        },
                        "<",
                    ); // Run in parallel

                    // Reference for cleanup (using the timeline/scrolltrigger)
                    const rotationTween = tl;

                    scrollCleanup = () => {
                        rotationTween.kill();
                        if (ScrollTrigger) {
                            ScrollTrigger.getAll().forEach((t) => t.kill());
                        }
                    };
                } catch (e) {
                    console.warn("GSAP not available", e);
                }

                // Ensure at least one frame is rendered before hiding loader
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (!isDestroyed) {
                            globalLoading.set(false);
                            isInitialized = true;
                        }
                    });
                });
            }
        };
        setup();
    });

    onDestroy(() => {
        isDestroyed = true;
        unregisterRenderer();
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(raf);
        }
        if (typeof window !== "undefined" && resizeHandler) {
            window.removeEventListener("resize", resizeHandler);
        }
        if (scrollCleanup) scrollCleanup();
        // Clean up scene
        if (scene) {
            scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((m) => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }
        if (renderer) {
            renderer.dispose?.();
            renderer.forceContextLoss?.();
        }
    });
</script>

<svelte:window bind:scrollY bind:innerHeight />

<!-- Container for scrolling height -->
<!-- 250vh gives us enough room to scroll and rotate the cube -->
<div class="scroll-container" bind:this={scrollContainer}>
    <div bind:this={container} class="canvas-container"></div>

    <!-- Optional: Scroll indicators or overlay text if needed, but text is on cube -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="scroll-helper"
        on:click={handleScrollClick}
        style="cursor: pointer; pointer-events: auto;"
    >
        <p>
            {#if isBottom}
                Voltar ao topo <i
                    class="fa-solid fa-arrow-up"
                    style="margin-left: 0.5rem;"
                ></i>
            {:else}
                Explorar <i
                    class="fa-solid fa-arrow-down"
                    style="margin-left: 0.5rem;"
                ></i>
            {/if}
        </p>
    </div>
</div>

<!-- Mocap Content Wrapper - Will be moved into CSS3D Object -->
<div class="mocap-content-wrapper" style="display: none;">
    {#if cameraPermissionGranted}
        <!-- active prop is redundant if we just show control visibility, but component uses it? Component doesn't use 'active' prop in code read earlier. -->
        <MocapComponent {cameraStream} />
    {:else}
        <!-- Permission prompt also goes into the 3D face -->
        <div
            class="w-full h-full flex flex-col items-center justify-center bg-black text-white p-10"
        >
            <p>Camera access required for Motion Capture</p>
            <button
                class="mt-4 px-6 py-2 bg-white/20 rounded-xl"
                on:click={requestCameraPermission}
            >
                Enable Camera
            </button>
        </div>
    {/if}
</div>

<style>
    :global(body) {
        margin: 0;
        overflow-x: hidden;
        background-color: #000;
    }

    .scroll-container {
        height: 250vh; /* Adjust for scroll length */
        position: relative;
    }

    .canvas-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        pointer-events: none; /* Allow scroll to pass through */
    }

    /* ── Scroll helper ───────────────────────────────────────────── */
    .scroll-helper {
        position: fixed;
        bottom: 2rem;
        right: 6rem;
        left: auto;
        transform: none;
        color: white;
        font-family: "Montserrat", sans-serif;
        opacity: 0.8;
        z-index: 100;
        pointer-events: auto; /* Changed from none to allow click */
        animation: bounce 2s infinite;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        padding: 0.8rem 1.5rem;
        border-radius: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    @keyframes bounce {
        0%,
        20%,
        50%,
        80%,
        100% {
            transform: translateY(0);
        }
        40% {
            transform: translateY(-10px);
        }
        60% {
            transform: translateY(-5px);
        }
    }
</style>
