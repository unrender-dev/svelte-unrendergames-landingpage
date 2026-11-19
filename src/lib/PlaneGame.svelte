<script>
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import * as THREE from 'three';
    import { createRenderer } from './threeRenderer.js';

    let container;
    let speedDisplayValue = 0;

    let isPlaying = true;
    let isBoosting = false;
    const baseSpeed = 1.2;
    const boostSpeed = 4.0;
    let currentSpeed = baseSpeed;

    let input = { x: 0, y: 0 };
    let gyroPermissionGranted = false;
    let isMobile = false;

    let renderer, scene, camera;
    let planeGroup, particles, gridHelper, flame, flameMat, engineLight;
    let animationId;
    const clock = new THREE.Clock();
    let planeYaw = 0;
    let mounted = false;
    let resizeObserver;
    
    const dispatch = createEventDispatcher();

    let particleCount = 2000;
    const gridSize = 40;

    // Reusable vectors for animation loop to avoid garbage collection
    const _forward = new THREE.Vector3(0, 0, -1);
    const _cameraOffset = new THREE.Vector3(0, 5, 20);
    const _idealCameraPos = new THREE.Vector3();
    const _lookAtTargetOffset = new THREE.Vector3(0, 0, -25);
    const _lookAtTarget = new THREE.Vector3();

    // Helper to request orientation permission
    const requestOrientationPermission = () => {
        if (gyroPermissionGranted) return;
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response == 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                        window.addEventListener('devicemotion', handleMotion);
                        gyroPermissionGranted = true;
                    }
                })
                .catch(console.error);
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
            window.addEventListener('devicemotion', handleMotion);
            gyroPermissionGranted = true;
        }
    };

    let hasOrientation = false;

    const handleOrientation = (e) => {
        if (e.gamma !== null && e.beta !== null) {
            hasOrientation = true;
            let roll = e.gamma || 0;
            let pitch = e.beta || 0;
            roll = Math.max(-45, Math.min(45, roll));
            let adjustedPitch = pitch - 45;
            adjustedPitch = Math.max(-30, Math.min(30, adjustedPitch));
            input.x = roll / 45;
            input.y = -adjustedPitch / 30;
        }
    };

    const handleMotion = (e) => {
        if (hasOrientation || !e.accelerationIncludingGravity) return;
        
        let ax = e.accelerationIncludingGravity.x || 0;
        let ay = e.accelerationIncludingGravity.y || 0;
        let az = e.accelerationIncludingGravity.z || 0;

        let roll = Math.atan2(ax, az) * (180 / Math.PI);
        let pitch = Math.atan2(ay, az) * (180 / Math.PI);

        roll = Math.max(-45, Math.min(45, roll));
        let adjustedPitch = pitch - 45;
        adjustedPitch = Math.max(-30, Math.min(30, adjustedPitch));

        input.x = roll / 45;
        input.y = -adjustedPitch / 30;
    };

    const startBoost = () => { isBoosting = true; };
    const endBoost = () => { isBoosting = false; };
    
    const handleTouchStart = (e) => {
        if (isMobile) requestOrientationPermission();
        startBoost();
    };

    const handleMouseMove = (e) => {
        if (isMobile) return;
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            input.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            input.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        } else {
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            input.x = (e.clientX / w) * 2 - 1;
            input.y = -(e.clientY / h) * 2 + 1;
        }
    };

    const handleResize = () => {
        if (!container || !camera || !renderer) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    };

    function animate() {
        if (!mounted) return;
        animationId = requestAnimationFrame(animate);

        const delta = clock.getDelta();

        if (isPlaying && scene && camera && renderer) {
            const targetSpeed = isBoosting ? boostSpeed : baseSpeed;
            currentSpeed = THREE.MathUtils.lerp(currentSpeed, targetSpeed, delta * 5);
            speedDisplayValue = Math.floor(currentSpeed * 100);

            const maxRoll = Math.PI / 3;
            const maxPitch = Math.PI / 4;
            const targetRoll = -input.x * maxRoll;
            const targetPitch = input.y * maxPitch;

            planeGroup.rotation.z = THREE.MathUtils.lerp(planeGroup.rotation.z, targetRoll, delta * 5);
            planeGroup.rotation.x = THREE.MathUtils.lerp(planeGroup.rotation.x, targetPitch, delta * 5);
            planeYaw -= input.x * delta * 1.5;
            planeGroup.rotation.y = planeYaw;

            _forward.set(0, 0, -1).applyQuaternion(planeGroup.quaternion);
            planeGroup.position.add(_forward.multiplyScalar(currentSpeed));

            if (planeGroup.position.y < -15) {
                planeGroup.position.y = -15;
                input.y = Math.max(0, input.y);
            }

            if (isBoosting) {
                flameMat.color.setHex(0x5d44a2); // Purple Turbo
                engineLight.color.setHex(0x5d44a2);
                engineLight.intensity = 15;
                flame.scale.set(1.2 + Math.random() * 0.2, 1.2 + Math.random() * 0.2, 2.5 + Math.random() * 1.0);
            } else {
                flameMat.color.setHex(0xf99126); // Orange Default
                engineLight.color.setHex(0xf99126);
                engineLight.intensity = 6;
                flame.scale.set(0.8 + Math.random() * 0.1, 0.8 + Math.random() * 0.1, 1.0 + Math.random() * 0.3);
            }

            _idealCameraPos.copy(_cameraOffset).applyMatrix4(planeGroup.matrixWorld);
            camera.position.lerp(_idealCameraPos, delta * 6);
            _lookAtTarget.copy(_lookAtTargetOffset).applyMatrix4(planeGroup.matrixWorld);
            camera.lookAt(_lookAtTarget);

            gridHelper.position.x = Math.round(planeGroup.position.x / gridSize) * gridSize;
            gridHelper.position.z = Math.round(planeGroup.position.z / gridSize) * gridSize;

            const pPositions = particles.geometry.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                const dx = pPositions[i3] - planeGroup.position.x;
                const dy = pPositions[i3 + 1] - planeGroup.position.y;
                const dz = pPositions[i3 + 2] - planeGroup.position.z;

                if (dx > 500) pPositions[i3] -= 1000;
                if (dx < -500) pPositions[i3] += 1000;
                if (dy > 500) pPositions[i3 + 1] -= 1000;
                if (dy < -500) pPositions[i3 + 1] += 1000;
                if (dz > 500) pPositions[i3 + 2] -= 1000;
                if (dz < -500) pPositions[i3 + 2] += 1000;
            }
            particles.geometry.attributes.position.needsUpdate = true;

            renderer.render(scene, camera);
        }
    }

    onMount(() => {
        mounted = true;
        initGame();
    });

    async function initGame() {
        isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        particleCount = isMobile ? 300 : 2000;
        const dpr = isMobile ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2);

        if (isMobile && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') {
            window.addEventListener('deviceorientation', handleOrientation);
            window.addEventListener('devicemotion', handleMotion);
            gyroPermissionGranted = true;
        }

        const width = container.clientWidth || window.innerWidth || 800;
        const height = container.clientHeight || window.innerHeight || 600;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0518);
        scene.fog = new THREE.Fog(0x0a0518, 300, 1400);

        camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);

        const result = await createRenderer({ antialias: true });
        if (!mounted) {
            result.renderer.dispose?.();
            return;
        }
        renderer = result.renderer;
        renderer.setSize(width, height);
        renderer.setPixelRatio(dpr);
        if (isMobile) {
            renderer.toneMapping = THREE.NoToneMapping;
        } else {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.5;
        }
        container.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xf99126, 3);
        dirLight.position.set(100, 200, 50);
        scene.add(dirLight);

        const purpleLight = new THREE.DirectionalLight(0x5d44a2, 2);
        purpleLight.position.set(-100, 50, -50);
        scene.add(purpleLight);

        const gridDivisions = isMobile ? 60 : 120;
        gridHelper = new THREE.GridHelper(gridSize * gridDivisions, gridDivisions, 0xf99126, 0x2a1545);
        gridHelper.position.y = -20;
        scene.add(gridHelper);

        const particleGeom = new THREE.BufferGeometry();
        const particlePos = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            particlePos[i * 3] = (Math.random() - 0.5) * 1000;
            particlePos[i * 3 + 1] = (Math.random() - 0.5) * 1000;
            particlePos[i * 3 + 2] = (Math.random() - 0.5) * 1000;
        }
        particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
        const particleMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.0, transparent: true, opacity: 0.5 });
        particles = new THREE.Points(particleGeom, particleMat);
        scene.add(particles);

        planeGroup = new THREE.Group();
        scene.add(planeGroup);

        const mat = new THREE.MeshStandardMaterial({
            color: 0x554433,
            roughness: 0.3,
            metalness: 0.8,
            emissive: 0x1a0e2e
        });

        const bodyGeom = new THREE.ConeGeometry(1, 6, 4);
        bodyGeom.rotateX(Math.PI / 2);
        bodyGeom.rotateZ(Math.PI / 4);
        const body = new THREE.Mesh(bodyGeom, mat);
        planeGroup.add(body);

        const wingGeom = new THREE.BoxGeometry(9, 0.1, 2.5);
        const wings = new THREE.Mesh(wingGeom, mat);
        wings.position.set(0, -0.2, 1);
        planeGroup.add(wings);

        const tailGeom = new THREE.BoxGeometry(0.1, 2, 1.5);
        const tail = new THREE.Mesh(tailGeom, mat);
        tail.position.set(0, 1, 2);
        planeGroup.add(tail);

        const flameGeom = new THREE.ConeGeometry(0.6, 3, 16);
        flameGeom.rotateX(Math.PI / 2);
        flameGeom.translate(0, 0, 1.5);
        flameMat = new THREE.MeshBasicMaterial({
            color: 0xf99126,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        flame = new THREE.Mesh(flameGeom, flameMat);
        flame.position.set(0, 0, 2.5);
        planeGroup.add(flame);

        engineLight = new THREE.PointLight(0xf99126, 5, 50);
        engineLight.position.set(0, 0, 3);
        planeGroup.add(engineLight);

        // Event listeners
        window.addEventListener('resize', handleResize);
        resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(container);
        window.addEventListener('mousemove', handleMouseMove);
        
        // Touch / Mousedown bindings
        window.addEventListener('mousedown', startBoost);
        window.addEventListener('mouseup', endBoost);
        window.addEventListener('touchend', endBoost);
        window.addEventListener('touchstart', handleTouchStart, { passive: false });

        animate();
        
        // Notify Home that component is loaded
        requestAnimationFrame(() => dispatch('ready'));
    }

    onDestroy(() => {
        if (typeof window === 'undefined') return;
        mounted = false;
        if (resizeObserver) resizeObserver.disconnect();
        if (animationId) cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mousedown', startBoost);
        window.removeEventListener('mouseup', endBoost);
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchend', endBoost);
        window.removeEventListener('deviceorientation', handleOrientation);
        window.removeEventListener('devicemotion', handleMotion);

        if (renderer && renderer.domElement && container) {
            container.removeChild(renderer.domElement);
            renderer.dispose();
        }
    });
</script>

<div class="plane-game-wrapper">
    <div id="hud">
        <span id="speed-display">{speedDisplayValue}</span> km/h
    </div>
    <div bind:this={container} class="game-container"></div>
</div>

<style>
    .plane-game-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: #0a0518;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        touch-action: none;
    }
    
    .game-container {
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
    }

    #hud {
        position: absolute;
        top: 20px;
        left: 20px;
        color: #f99126;
        font-size: 1.5rem;
        font-weight: bold;
        font-family: monospace;
        z-index: 5;
        pointer-events: none;
        text-shadow: 0 0 5px #f99126;
    }
</style>
