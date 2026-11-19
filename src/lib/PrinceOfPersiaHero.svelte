<script>
  import { onMount, onDestroy } from "svelte";

  let canvas;
  let container;
  let animFrameId;

  // Sound toggle (Web Audio API)
  let soundEnabled = false;
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "step") {
        osc.type = "square";
        osc.frequency.setValueAtTime(120 + Math.random() * 20, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.04);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === "jump") {
        osc.type = "square";
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.16);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === "land") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.06);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === "skid") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.linearRampToValueAtTime(60, now + 0.09);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.09);
      }
    } catch (e) {
      // Audio error ignored
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      initAudio();
      playSound("jump");
    }
  }

  // Virtual Atari Resolution (16:9 pixel grid)
  const V_WIDTH = 480;
  const V_HEIGHT = 270;

  // Geometry constants matching the Atari screenshot
  const CEILING_Y = 16;
  const CEILING_H = 68;
  const FLOOR_Y = 152;
  const FLOOR_H = 72;
  const GAP_START_X = 290;
  const GAP_END_X = 336;

  // Pillars (X positions)
  const pillars = [
    { x: 72, w: 32 },
    { x: 174, w: 34 },
    { x: 372, w: 34 }
  ];

  // Metal spikes position
  const SPIKES_X = 300;
  const SPIKES_W = 24;

  // Mouse in Virtual Space
  const mouse = { x: 240, y: 140, isInside: false };

  // Character State
  const prince = {
    x: 120,
    y: FLOOR_Y,
    vx: 0,
    vy: 0,
    facing: 1, // 1: right, -1: left
    isGrounded: true,
    isTurning: false,
    turnTimer: 0,
    turnDuration: 0.22,
    gaitPhase: 0,
    action: "idle", // 'idle' | 'walk' | 'run' | 'turn' | 'jump' | 'crouch' | 'reach'
    graspPhase: 0,
    lastStepTime: 0
  };

  onMount(() => {
    const handleResize = () => {
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    // Exact inverse mapping from screen cursor pixels to virtual Atari canvas coordinates
    const updateMouse = (clientX, clientY) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const realW = canvas.width;
      const realH = canvas.height;
      const scale = Math.min(realW / V_WIDTH, realH / V_HEIGHT);
      const offsetX = (realW - V_WIDTH * scale) / 2;
      const offsetY = (realH - V_HEIGHT * scale) / 2;

      const pxOnCanvas = (clientX - rect.left) * dpr;
      const pyOnCanvas = (clientY - rect.top) * dpr;

      mouse.x = (pxOnCanvas - offsetX) / scale;
      mouse.y = (pyOnCanvas - offsetY) / scale;
      mouse.isInside = true;
    };

    const handleMouseMove = (e) => updateMouse(e.clientX, e.clientY);
    const handleTouchMove = (e) => {
      if (e.touches.length > 0) {
        updateMouse(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleMouseLeave = () => {
      mouse.isInside = false;
      mouse.x = prince.x;
      mouse.y = FLOOR_Y - 20;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    if (container) {
      container.addEventListener("mouseleave", handleMouseLeave);
    }

    let lastTime = performance.now();

    function loop(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      update(dt, now / 1000);
      draw(now / 1000);

      animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      if (container) container.removeEventListener("mouseleave", handleMouseLeave);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  });

  // ==========================================
  // SIMULATION & KINEMATICS
  // ==========================================
  function update(dt, time) {
    const targetX = Math.max(30, Math.min(V_WIDTH - 30, mouse.x));
    const targetY = mouse.y;

    const shoulderX = prince.x;
    const shoulderY = prince.y - 22;

    const dx = targetX - prince.x;
    const dy = targetY - shoulderY;

    // Desired facing direction
    let desiredFacing = prince.facing;
    if (Math.abs(dx) > 10) {
      desiredFacing = dx > 0 ? 1 : -1;
    }

    // Smooth turnaround trigger (rotoscopic skid pivot)
    if (desiredFacing !== prince.facing && !prince.isTurning && prince.isGrounded) {
      prince.isTurning = true;
      prince.turnTimer = 0;
      playSound("skid");
    }

    if (prince.isTurning) {
      prince.action = "turn";
      prince.turnTimer += dt;
      prince.vx *= 0.65;
      if (prince.turnTimer >= prince.turnDuration) {
        prince.facing = desiredFacing;
        prince.isTurning = false;
        prince.turnTimer = 0;
      }
    }

    // Movement & Interactive Grabbing
    if (!prince.isTurning) {
      if (prince.isGrounded) {
        const isNear = Math.abs(dx) < 85;
        const isAbove = dy < -24 && isNear;
        const isBelow = dy > 18 && isNear;
        const isLevel = !isAbove && !isBelow && isNear;

        // 1. Mouse is Above -> Jump to grab!
        if (isAbove && mouse.isInside) {
          prince.action = "jump";
          prince.vy = -6.8;
          prince.vx = prince.facing * Math.min(Math.abs(dx) * 0.05, 1.8);
          prince.isGrounded = false;
          playSound("jump");
        }
        // 2. Mouse is Below -> Crouch to grab!
        else if (isBelow && mouse.isInside) {
          prince.action = "crouch";
          prince.vx *= 0.6;
          prince.graspPhase += dt * 8;
        }
        // 3. Mouse is at Level -> Reach forward to grab!
        else if (isLevel && mouse.isInside && Math.abs(dx) < 65) {
          prince.action = "reach";
          prince.vx *= 0.55;
          prince.graspPhase += dt * 8;
        }
        // 4. Walk / Run towards mouse (with realistic stride speed)
        else if (Math.abs(dx) > 30) {
          const isSprinting = Math.abs(dx) > 90;
          prince.action = isSprinting ? "run" : "walk";

          const maxSpeed = isSprinting ? 2.6 : 1.5;
          const targetVx = prince.facing * maxSpeed;
          prince.vx += (targetVx - prince.vx) * 0.2;

          // Gait phase advances smoothly proportional to actual horizontal velocity
          prince.gaitPhase += Math.abs(prince.vx) * 0.12;

          const stepInterval = isSprinting ? 0.22 : 0.32;
          if (time - prince.lastStepTime > stepInterval && Math.abs(prince.vx) > 0.6) {
            prince.lastStepTime = time;
            playSound("step");
          }
        }
        // 5. Idle
        else {
          prince.action = "idle";
          prince.vx *= 0.65;
        }
      } else {
        // In the air (Jumping)
        prince.action = "jump";
        prince.graspPhase += dt * 9;
        if (Math.abs(dx) > 10) {
          prince.vx += prince.facing * 0.1;
        }
      }
    }

    // Apply Velocity & Gravity
    prince.x += prince.vx;
    prince.y += prince.vy;

    if (!prince.isGrounded) {
      prince.vy += 0.38; // Gravity
      if (prince.y >= FLOOR_Y) {
        prince.y = FLOOR_Y;
        prince.vy = 0;
        prince.isGrounded = true;
        playSound("land");
      }
    }

    // Screen bounds
    prince.x = Math.max(25, Math.min(V_WIDTH - 25, prince.x));
  }

  // ==========================================
  // ATARI 2600 STYLE DRAWING
  // ==========================================
  function draw(time) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Clear whole real canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Scale virtual Atari resolution (480x270) to real canvas with letterbox/fit
    const scaleX = canvas.width / V_WIDTH;
    const scaleY = canvas.height / V_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (canvas.width - V_WIDTH * scale) / 2;
    const offsetY = (canvas.height - V_HEIGHT * scale) / 2;

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Disable smoothing for sharp chunky Atari pixels
    ctx.imageSmoothingEnabled = false;

    // 1. Pure Black Background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

    // 2. Ceiling Bricks with Opening Gap
    drawBrickWall(ctx, 0, CEILING_Y, V_WIDTH, CEILING_H, GAP_START_X, GAP_END_X);

    // 3. Pillars
    for (let p of pillars) {
      drawPillar(ctx, p.x, CEILING_Y + CEILING_H, p.w, FLOOR_Y - (CEILING_Y + CEILING_H));
    }

    // 4. Metal Spikes on the Floor
    drawSpikes(ctx, SPIKES_X, FLOOR_Y);

    // 5. Floor Platform Bricks
    drawBrickWall(ctx, 0, FLOOR_Y, V_WIDTH, FLOOR_H);

    // 6. Bottom Life Indicator Triangles (Atari HUD)
    drawLifeTriangles(ctx);

    // 7. Draw Detailed Rotoscoped Atari Character (Pitfall / PoP hybrid)
    drawRotoscopedCharacter(ctx, time);

    ctx.restore();
  }

  // Draws the authentic Atari Prince of Persia blue brick walls
  function drawBrickWall(ctx, startX, startY, totalW, totalH, gapX1 = -1, gapX2 = -1) {
    const colBrick = "#2b5ab3";
    const colBorder = "#5a8ce6";

    // Top border line
    ctx.fillStyle = colBorder;
    if (gapX1 > 0 && gapX2 > gapX1) {
      ctx.fillRect(startX, startY, gapX1 - startX, 3);
      ctx.fillRect(gapX2, startY, totalW - gapX2, 3);
    } else {
      ctx.fillRect(startX, startY, totalW, 3);
    }

    const rowH = 19;
    const brickW = 46;
    const gapW = 8;
    const rows = Math.floor((totalH - 6) / rowH);

    for (let r = 0; r < rows; r++) {
      const y = startY + 3 + r * rowH;
      const rowOffset = (r % 2) * ((brickW + gapW) / 2);

      const count = Math.ceil(totalW / (brickW + gapW)) + 2;
      for (let c = -1; c < count; c++) {
        const bx = c * (brickW + gapW) + rowOffset;
        const bw = brickW;

        if (gapX1 > 0 && bx + bw > gapX1 && bx < gapX2) {
          if (bx < gapX1) {
            drawSingleBrick(ctx, bx, y, gapX1 - bx, rowH - 2, colBrick, colBorder);
          } else if (bx + bw > gapX2 && bx < gapX2) {
            drawSingleBrick(ctx, gapX2, y, bx + bw - gapX2, rowH - 2, colBrick, colBorder);
          }
          continue;
        }

        drawSingleBrick(ctx, bx, y, bw, rowH - 2, colBrick, colBorder);
      }
    }

    // Bottom border line
    ctx.fillStyle = colBorder;
    if (gapX1 > 0 && gapX2 > gapX1) {
      ctx.fillRect(startX, startY + totalH - 3, gapX1 - startX, 3);
      ctx.fillRect(gapX2, startY + totalH - 3, totalW - gapX2, 3);
    } else {
      ctx.fillRect(startX, startY + totalH - 3, totalW, 3);
    }
  }

  // Draw individual rounded blue brick matching the Atari screenshot
  function drawSingleBrick(ctx, x, y, w, h, colBrick, colBorder) {
    if (w <= 2) return;
    ctx.fillStyle = colBrick;
    ctx.fillRect(x, y + 2, w, h - 4);

    ctx.fillRect(x + 2, y, w - 4, 2);
    ctx.fillRect(x + 2, y + h - 2, w - 4, 2);

    ctx.fillStyle = colBorder;
    ctx.fillRect(x + 3, y, w - 6, 2);
    ctx.fillRect(x + 3, y + h - 2, w - 6, 2);
  }

  // Draw Atari Pillar with Capital and Base
  function drawPillar(ctx, x, y, w, h) {
    const colBrick = "#2b5ab3";
    const colBorder = "#5a8ce6";

    // Capital (top)
    ctx.fillStyle = colBorder;
    ctx.fillRect(x - 5, y, w + 10, 3);
    ctx.fillStyle = colBrick;
    ctx.fillRect(x - 5, y + 3, w + 10, 5);

    // Pillar Shaft
    ctx.fillStyle = colBrick;
    ctx.fillRect(x, y + 8, w, h - 16);

    // Pillar Left Highlight strip
    ctx.fillStyle = colBorder;
    ctx.fillRect(x, y + 8, 3, h - 16);

    // Base (bottom)
    ctx.fillStyle = colBorder;
    ctx.fillRect(x - 6, y + h - 8, w + 12, 3);
    ctx.fillStyle = colBrick;
    ctx.fillRect(x - 6, y + h - 5, w + 12, 5);
  }

  // Draw floor metal spikes exactly like the screenshot
  function drawSpikes(ctx, x, floorY) {
    const spikeCount = 3;
    const spikeW = 6;
    const spikeH = 16;

    for (let i = 0; i < spikeCount; i++) {
      const sx = x + i * (spikeW + 2);
      const sy = floorY - spikeH;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx + 2, sy, 2, 4);

      ctx.fillStyle = "#e0e0e0";
      ctx.fillRect(sx + 1, sy + 4, 4, 6);

      ctx.fillStyle = "#8a8a8a";
      ctx.fillRect(sx, sy + 10, spikeW, 6);
    }
  }

  // Draw bottom red life triangles (Atari HUD)
  function drawLifeTriangles(ctx) {
    const colRed = "#e05050";
    ctx.fillStyle = colRed;

    // 4 red triangles pointing right (left side)
    const startX1 = 56;
    const y = 246;
    for (let i = 0; i < 4; i++) {
      const tx = startX1 + i * 16;
      ctx.beginPath();
      ctx.moveTo(tx, y - 5);
      ctx.lineTo(tx + 8, y);
      ctx.lineTo(tx, y + 5);
      ctx.closePath();
      ctx.fill();
    }

    // 4 red triangles pointing left (right side)
    const startX2 = 380;
    for (let i = 0; i < 4; i++) {
      const tx = startX2 + i * 16;
      ctx.beginPath();
      ctx.moveTo(tx + 8, y - 5);
      ctx.lineTo(tx, y);
      ctx.lineTo(tx + 8, y + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ==========================================
  // DETAILED ROTESCOPED ATARI SPRITE (PITFALL / POP STYLE)
  // Real human kinematics with multi-joint limbs & chunky pixels
  // ==========================================
  function drawRotoscopedCharacter(ctx, time) {
    const px = Math.round(prince.x);
    const py = Math.round(prince.y);
    const f = prince.facing; // 1: right, -1: left

    // Palette (Atari 2600 TIA scanline style: hat/hair, skin, white tunic, belt, trousers, shoes)
    const colHatTop = "#7c3f18";
    const colHatBrim = "#aa6028";
    const colSkin = "#f0b078";
    const colEye = "#1a0e08";
    const colWhite = "#ffffff";
    const colWhiteShadow = "#c8c8d8";
    const colBelt = "#6e3d14";
    const colBuckle = "#d4a030";
    const colShoe = "#3d200e";
    const colShoeTrim = "#b88628";

    // Shoulder anchor in world coordinates
    const shoulderX = px;
    let shoulderY = py - 22;

    // Aim vector straight to mouse cursor
    const aimDx = mouse.x - shoulderX;
    const aimDy = mouse.y - shoulderY;
    const aimAngle = Math.atan2(aimDy, aimDx);

    // 1. TURN STATE (3-Phase Skid / Rotoscope Pivot)
    if (prince.action === "turn") {
      const progress = prince.turnTimer / prince.turnDuration;
      let bob = progress < 0.5 ? 1 : 0;

      // Head (3/4 view)
      drawDetailedHead(ctx, px, py - 30 + bob, 0, colHatTop, colHatBrim, colSkin, colEye);

      // Torso facing front
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 5, py - 24 + bob, 10, 8);
      // Belt
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 5, py - 16 + bob, 10, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1.5, py - 16 + bob, 3, 3);

      // Arms flared out for balance during skid
      drawChunkyPixelLine(ctx, px - 5, py - 23 + bob, px - 9, py - 19 + bob, 3, colWhite);
      drawChunkyPixelLine(ctx, px - 9, py - 19 + bob, px - 11, py - 15 + bob, 2.5, colSkin);
      drawChunkyPixelLine(ctx, px + 5, py - 23 + bob, px + 9, py - 19 + bob, 3, colWhite);
      drawChunkyPixelLine(ctx, px + 9, py - 19 + bob, px + 11, py - 15 + bob, 2.5, colSkin);

      // Scissored legs
      drawLegSegment(ctx, px - 3, py - 13 + bob, px - 4, py - 6, px - 5, py - 1, -1, colWhite, colShoe, colShoeTrim);
      drawLegSegment(ctx, px + 3, py - 13 + bob, px + 4, py - 6, px + 5, py - 1, 1, colWhite, colShoe, colShoeTrim);
      return;
    }

    // 2. CROUCH REACH STATE (One knee down, reaching along floor towards mouse)
    if (prince.action === "crouch") {
      const crouchHipY = py - 10;
      const crouchShoulderY = py - 15;

      // Back leg folded on the stone
      drawLegSegment(ctx, px - 4 * f, crouchHipY, px - 7 * f, py - 4, px - 2 * f, py - 1, f, colWhiteShadow, colShoe, colShoeTrim);

      // Front leg bent deep
      drawLegSegment(ctx, px + 2 * f, crouchHipY, px + 5 * f, py - 6, px + 6 * f, py - 1, f, colWhite, colShoe, colShoeTrim);

      // Torso leaning forward
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 4 + f * 2, crouchShoulderY - 3, 8, 8);
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 4 + f * 2, crouchShoulderY + 5, 8, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1 + f * 3, crouchShoulderY + 5, 3, 3);

      // Head
      drawDetailedHead(ctx, px + f * 4, crouchShoulderY - 11, f, colHatTop, colHatBrim, colSkin, colEye);

      // Arms reaching directly down towards mouse cursor
      drawAimingLimbArms(ctx, px + f * 3, crouchShoulderY, aimAngle, colWhite, colSkin, prince.graspPhase);
      return;
    }

    // 3. JUMP REACH STATE (Leaping into air with arched back and arms reaching up)
    if (prince.action === "jump") {
      const jumpHipY = py - 16;
      const jumpShoulderY = py - 25;

      // Trailing legs in mid-air (Pitfall leap pose)
      drawLegSegment(ctx, px - 3 * f, jumpHipY, px - 6 * f, jumpHipY + 7, px - 4 * f, jumpHipY + 14, f, colWhiteShadow, colShoe, colShoeTrim);
      drawLegSegment(ctx, px + 2 * f, jumpHipY, px + 4 * f, jumpHipY + 6, px + 6 * f, jumpHipY + 13, f, colWhite, colShoe, colShoeTrim);

      // Torso
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 4, jumpShoulderY - 2, 8, 10);
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 4, jumpShoulderY + 8, 8, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1 + f, jumpShoulderY + 8, 3, 3);

      // Head tilted up towards mouse
      drawDetailedHead(ctx, px + f * 2, jumpShoulderY - 10, f, colHatTop, colHatBrim, colSkin, colEye);

      // Both arms reaching up at mouse
      drawAimingLimbArms(ctx, px, jumpShoulderY, aimAngle, colWhite, colSkin, prince.graspPhase);
      return;
    }

    // 4. LEVEL REACH STATE (Forward lunge, stretching arms towards mouse)
    if (prince.action === "reach") {
      const reachHipY = py - 14;
      const reachShoulderY = py - 22;

      // Staggered lunge legs
      drawLegSegment(ctx, px - 5 * f, reachHipY, px - 8 * f, py - 6, px - 7 * f, py - 1, f, colWhiteShadow, colShoe, colShoeTrim);
      drawLegSegment(ctx, px + 3 * f, reachHipY, px + 6 * f, py - 6, px + 7 * f, py - 1, f, colWhite, colShoe, colShoeTrim);

      // Torso leaning forward
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 4 + f * 2, reachShoulderY - 3, 8, 10);
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 4 + f * 2, reachShoulderY + 7, 8, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1 + f * 3, reachShoulderY + 7, 3, 3);

      // Head
      drawDetailedHead(ctx, px + f * 3, reachShoulderY - 11, f, colHatTop, colHatBrim, colSkin, colEye);

      // Arms pointing directly at mouse
      drawAimingLimbArms(ctx, px + f * 2, reachShoulderY, aimAngle, colWhite, colSkin, prince.graspPhase);
      return;
    }

    // 5. WALK & RUN STATE (Rotoscoped Biomechanical Gait Cycle)
    if (prince.action === "walk" || prince.action === "run") {
      const p = prince.gaitPhase;
      const isRun = prince.action === "run";

      // Vertical hip bounce (highest at passing, lowest at foot absorption)
      const bounceAmp = isRun ? 2.5 : 1.5;
      const hipBounce = -Math.cos(p * 2) * bounceAmp;
      const hipY = py - 15 + hipBounce;

      // Forward lean of spine
      const forwardLean = f * (isRun ? 2.5 : 1.2);
      const spineShoulderY = hipY - 9;
      const spineShoulderX = px + forwardLean;

      // Calculate articulated leg joints for both legs (phase offset = PI)
      // Leg 1 (Lead): phase p
      // Leg 2 (Rear): phase p + PI
      const legStrideAmp = isRun ? 0.78 : 0.52;
      const kneeFlexAmp = isRun ? 1.4 : 0.95;

      // Helper to compute realistic thigh, knee, calf, and foot positions
      function computeLegKinematics(theta, isBack) {
        const thighAngle = Math.sin(theta) * legStrideAmp;

        // Knee bends when leg swings backward and forward underneath body
        const isRecovery = Math.cos(theta) < 0.2;
        const kneeBend = isRecovery
          ? Math.max(0, -Math.sin(theta - 0.35) * kneeFlexAmp)
          : Math.max(0, Math.sin(theta) * 0.25);

        const thighLen = 8.5;
        const shinLen = 8.0;

        const startX = px + (isBack ? -1.5 : 1.5) * f;
        const startY = hipY;

        // Knee joint
        const kx = startX + Math.sin(thighAngle) * thighLen * f;
        const ky = startY + Math.cos(thighAngle) * thighLen;

        // Ankle joint
        const calfAngle = thighAngle - kneeBend;
        const ax = kx + Math.sin(calfAngle) * shinLen * f;
        const ay = Math.min(py - 1, ky + Math.cos(calfAngle) * shinLen);

        // Foot roll / toe extension
        const fx = ax + f * 4.5;
        const fy = ay;

        return { startX, startY, kx, ky, ax, ay, fx, fy };
      }

      const legBack = computeLegKinematics(p + Math.PI, true);
      const legFront = computeLegKinematics(p, false);

      // Arm swing angles in counter-oscillation to legs
      const armBackAngle = Math.sin(p) * (isRun ? 0.8 : 0.5);
      const armFrontAngle = -Math.sin(p) * (isRun ? 0.8 : 0.5);

      // 1. Draw Back Leg
      drawLegSegment(ctx, legBack.startX, legBack.startY, legBack.kx, legBack.ky, legBack.ax, legBack.ay, f, colWhiteShadow, colShoe, colShoeTrim);

      // 2. Draw Back Arm
      drawSwingingArm(ctx, spineShoulderX - 2 * f, spineShoulderY + 1, armBackAngle, f, isRun, colWhiteShadow, colSkin);

      // 3. Draw Torso & Belt
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 3.5 + forwardLean * 0.5, spineShoulderY - 2, 7, 9);
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 3.5 + forwardLean * 0.5, hipY - 2, 7, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1 + f, hipY - 2, 3, 3);

      // 4. Draw Front Leg
      drawLegSegment(ctx, legFront.startX, legFront.startY, legFront.kx, legFront.ky, legFront.ax, legFront.ay, f, colWhite, colShoe, colShoeTrim);

      // 5. Draw Head & Hat
      drawDetailedHead(ctx, spineShoulderX + f * 1.5, spineShoulderY - 10, f, colHatTop, colHatBrim, colSkin, colEye);

      // 6. Draw Front Arm
      drawSwingingArm(ctx, spineShoulderX + 2 * f, spineShoulderY + 1, armFrontAngle, f, isRun, colWhite, colSkin);
      return;
    }

    // 6. IDLE STATE (Standing Pose with Subtle Breathing)
    {
      const breath = Math.sin(time * 2.8) > 0.5 ? 1 : 0;
      const idleHipY = py - 14 + breath;
      const idleShoulderY = idleHipY - 9;

      // Legs standing straight with solid foot placement
      drawLegSegment(ctx, px - 2 * f, idleHipY, px - 3 * f, py - 7, px - 3 * f, py - 1, f, colWhiteShadow, colShoe, colShoeTrim);
      drawLegSegment(ctx, px + 2 * f, idleHipY, px + 2 * f, py - 7, px + 3 * f, py - 1, f, colWhite, colShoe, colShoeTrim);

      // Torso & Belt
      ctx.fillStyle = colWhite;
      ctx.fillRect(px - 3.5, idleShoulderY - 2, 7, 9);
      ctx.fillStyle = colBelt;
      ctx.fillRect(px - 3.5, idleHipY - 2, 7, 3);
      ctx.fillStyle = colBuckle;
      ctx.fillRect(px - 1 + f, idleHipY - 2, 3, 3);

      // Head
      drawDetailedHead(ctx, px + f * 1, idleShoulderY - 10, f, colHatTop, colHatBrim, colSkin, colEye);

      // Arms at sides with slight elbow bend
      drawChunkyPixelLine(ctx, px - 3.5 * f, idleShoulderY + 1, px - 4 * f, idleShoulderY + 7, 3, colWhiteShadow);
      drawChunkyPixelLine(ctx, px - 4 * f, idleShoulderY + 7, px - 3 * f, idleShoulderY + 11, 2.5, colSkin);

      drawChunkyPixelLine(ctx, px + 3.5 * f, idleShoulderY + 1, px + 4 * f, idleShoulderY + 7, 3, colWhite);
      drawChunkyPixelLine(ctx, px + 4 * f, idleShoulderY + 7, px + 3 * f, idleShoulderY + 11, 2.5, colSkin);
    }
  }

  // Draw Detailed Pitfall/PoP Head with Hat & Face Profile
  function drawDetailedHead(ctx, hx, hy, f, colHatTop, colHatBrim, colSkin, colEye) {
    // 1. Hat Top (Crown)
    ctx.fillStyle = colHatTop;
    ctx.fillRect(hx - 3, hy, 6, 3);

    // 2. Hat Brim (Wide explorer/turban brim)
    ctx.fillStyle = colHatBrim;
    ctx.fillRect(hx - 4.5, hy + 3, 9, 2);

    // 3. Face
    ctx.fillStyle = colSkin;
    ctx.fillRect(hx - 2.5, hy + 5, 5, 5);

    // 4. Nose & Jaw profile (facing direction)
    if (f !== 0) {
      ctx.fillRect(hx + f * 2.5, hy + 6, 1.5, 2); // Nose
      ctx.fillRect(hx + f * 1.5, hy + 8, 2, 2);   // Chin
    }

    // 5. Eye
    ctx.fillStyle = colEye;
    const eyeX = f === 0 ? hx : hx + f * 1.5;
    ctx.fillRect(eyeX, hy + 6, 1.2, 1.2);

    // 6. Neck
    ctx.fillStyle = colSkin;
    ctx.fillRect(hx - 1.5, hy + 10, 3, 2);
  }

  // Draw 2-Segment Articulated Leg (Thigh -> Knee -> Shin -> Shoe with sole)
  function drawLegSegment(ctx, hx, hy, kx, ky, ax, ay, f, colPants, colShoe, colShoeTrim) {
    // Thigh (hip to knee)
    drawChunkyPixelLine(ctx, hx, hy, kx, ky, 3.8, colPants);

    // Knee cap block
    ctx.fillStyle = colPants;
    ctx.fillRect(kx - 1.5, ky - 1.5, 3, 3);

    // Shin/Calf (knee to ankle)
    drawChunkyPixelLine(ctx, kx, ky, ax, ay, 3.2, colPants);

    // Shoe with pointed toe & sole trim (Pitfall/PoP style)
    const toeX = ax + f * 5;
    ctx.fillStyle = colShoe;
    ctx.fillRect(ax - 2 * f, ay - 1, 5 * f, 3);

    // Sole highlight
    ctx.fillStyle = colShoeTrim;
    ctx.fillRect(ax - 2 * f, ay + 1.5, 6 * f, 1.2);
  }

  // Draw Swinging Arm during Walk/Run (Upper Arm -> Elbow -> Forearm -> Hand)
  function drawSwingingArm(ctx, sx, sy, angle, f, isRun, colSleeve, colSkin) {
    const upperLen = 6.5;
    const lowerLen = 6.0;

    // Upper arm
    const ex = sx + Math.sin(angle) * upperLen * f;
    const ey = sy + Math.cos(angle) * upperLen;
    drawChunkyPixelLine(ctx, sx, sy, ex, ey, 3.2, colSleeve);

    // Forearm (bends forward during arm pump)
    const elbowFlex = isRun ? 0.7 : 0.4;
    const foreAngle = angle + elbowFlex;
    const hx = ex + Math.sin(foreAngle) * lowerLen * f;
    const hy = ey + Math.cos(foreAngle) * lowerLen;
    drawChunkyPixelLine(ctx, ex, ey, hx, hy, 2.6, colSleeve);

    // Hand
    ctx.fillStyle = colSkin;
    ctx.fillRect(hx - 1.2, hy - 1.2, 2.5, 2.5);
  }

  // Draw Arms Aimed ACCURATELY at the mouse cursor
  function drawAimingLimbArms(ctx, sx, sy, aimAngle, colWhite, colSkin, graspPhase) {
    const cosA = Math.cos(aimAngle);
    const sinA = Math.sin(aimAngle);
    const clutch = Math.sin(graspPhase) * 1.5;

    const upperLen = 7.5;
    const lowerLen = 7.0;

    // Arm 1 (Front Arm)
    const elbow1X = sx + cosA * upperLen;
    const elbow1Y = sy + sinA * upperLen;
    const hand1X = elbow1X + cosA * lowerLen;
    const hand1Y = elbow1Y + sinA * lowerLen;

    drawChunkyPixelLine(ctx, sx, sy, elbow1X, elbow1Y, 3.6, colWhite);
    drawChunkyPixelLine(ctx, elbow1X, elbow1Y, hand1X, hand1Y, 3.0, colWhite);

    // Hand & Grasping Fingers
    ctx.fillStyle = colSkin;
    ctx.fillRect(hand1X - 1.5, hand1Y - 1.5, 3, 3);

    ctx.strokeStyle = colSkin;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hand1X, hand1Y);
    ctx.lineTo(hand1X + cosA * (3.5 + clutch), hand1Y + sinA * (3.5 + clutch));
    ctx.stroke();

    // Arm 2 (Back Arm - slightly offset)
    const arm2StartX = sx - sinA * 2.5;
    const arm2StartY = sy + cosA * 2.5;
    const elbow2X = arm2StartX + cosA * (upperLen - 0.5);
    const elbow2Y = arm2StartY + sinA * (upperLen - 0.5);
    const hand2X = elbow2X + cosA * (lowerLen - 0.5);
    const hand2Y = elbow2Y + sinA * (lowerLen - 0.5);

    drawChunkyPixelLine(ctx, arm2StartX, arm2StartY, elbow2X, elbow2Y, 3.2, colWhite);
    drawChunkyPixelLine(ctx, elbow2X, elbow2Y, hand2X, hand2Y, 2.6, colWhite);

    ctx.fillStyle = colSkin;
    ctx.fillRect(hand2X - 1.5, hand2Y - 1.5, 3, 3);
  }

  // Draw chunky pixelated line with square caps (Pitfall aesthetic)
  function drawChunkyPixelLine(ctx, x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
    ctx.stroke();
  }

  function scrollToContent() {
    if (typeof window !== "undefined") {
      const el = document.querySelector(".content-section");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  }
</script>

<div
  bind:this={container}
  class="prince-hero-wrapper relative w-full h-screen overflow-hidden select-none bg-black flex flex-col justify-between cursor-default"
>
  <!-- Interactive Atari Canvas Layer (Standard Mouse Cursor Arrow, Not Crosshair!) -->
  <canvas
    bind:this={canvas}
    class="absolute inset-0 w-full h-full block z-10 cursor-default"
  ></canvas>

  <!-- Clean UI/UX Content Overlay (Substantive, no buzzwords, no character clutter) -->
  <div class="relative z-30 pointer-events-none p-6 md:p-10 flex flex-col justify-between h-full">
    <!-- Top Row: Section Category & Audio Toggle -->
    <div class="flex items-center justify-between pointer-events-auto">
      <div class="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-slate-950/85 backdrop-blur-md border border-blue-500/30 shadow-xl">
        <span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
        <span class="text-xs uppercase tracking-widest font-bold text-blue-300 font-mono">
          DESENVOLVIMENTO WEB • ANIMAÇÕES, VFX & GAMIFICAÇÃO
        </span>
      </div>

      <button
        on:click={toggleSound}
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950/85 hover:bg-slate-900 text-xs font-mono font-medium text-slate-200 border border-slate-700/60 transition shadow-lg cursor-pointer"
        title="Alternar Som Retrô Sintetizado"
      >
        <span>{soundEnabled ? "🔊 Som Retrô: ON" : "🔇 Som Retrô: OFF"}</span>
      </button>
    </div>

    <!-- Center-Left UI/UX Content Box: Sólido, direto ao ponto sobre Sites Interativos -->
    <div class="max-w-xl pointer-events-auto mt-2">
      <div class="p-6 md:p-7 rounded-3xl bg-slate-950/85 backdrop-blur-xl border border-blue-500/25 shadow-2xl space-y-4">
        <div>
          <span class="text-blue-400 font-mono text-xs uppercase tracking-wider font-bold">
            INTERATIVIDADE DIGITAL
          </span>
          <h1 class="text-2xl md:text-4xl font-black text-white tracking-tight leading-tight mt-1">
            Sites Interativos & <br />
            <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-300">
              Animações em Tempo Real.
            </span>
          </h1>
        </div>

        <p class="text-slate-300 text-xs md:text-sm leading-relaxed">
          Páginas estáticas perdem a atenção rapidamente. Criamos sites interativos onde
          o usuário participa ativamente da navegação: cada clique, movimento do cursor e rolagem
          gera respostas visuais imediatas com física e fluidez contínua.
        </p>

        <!-- 4 Pillars Grid: Animações, Interatividade, VFX e Gamificação -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div class="p-2.5 rounded-xl bg-white/5 border border-white/5">
            <div class="text-blue-400 text-base mb-1">🏃</div>
            <h4 class="text-[11px] font-bold text-white uppercase tracking-wider">Animações & Rotoscopia</h4>
            <p class="text-[10px] text-slate-400 mt-0.5 leading-snug">
              Movimentos calculados a 60 FPS com inércia, aceleração e viradas naturais no navegador.
            </p>
          </div>

          <div class="p-2.5 rounded-xl bg-white/5 border border-white/5">
            <div class="text-sky-400 text-base mb-1">🖱️</div>
            <h4 class="text-[11px] font-bold text-white uppercase tracking-wider">Interatividade Real</h4>
            <p class="text-[10px] text-slate-400 mt-0.5 leading-snug">
              Elementos que rastreiam o cursor e reagem ao usuário, aumentando o tempo de permanência.
            </p>
          </div>

          <div class="p-2.5 rounded-xl bg-white/5 border border-white/5">
            <div class="text-indigo-400 text-base mb-1">✨</div>
            <h4 class="text-[11px] font-bold text-white uppercase tracking-wider">Efeitos Visuais & VFX</h4>
            <p class="text-[10px] text-slate-400 mt-0.5 leading-snug">
              Iluminação dinâmica, canvas 2D e shaders leves otimizados para não travar a navegação.
            </p>
          </div>

          <div class="p-2.5 rounded-xl bg-white/5 border border-white/5">
            <div class="text-amber-400 text-base mb-1">🎮</div>
            <h4 class="text-[11px] font-bold text-white uppercase tracking-wider">Gamificação na Web</h4>
            <p class="text-[10px] text-slate-400 mt-0.5 leading-snug">
              Mecânicas lúdicas, metas visuais e feedback que engajam visitantes e impulsionam conversão.
            </p>
          </div>
        </div>

        <!-- Action Button -->
        <div class="pt-2 flex items-center justify-between gap-3 border-t border-white/10">
          <span class="text-[11px] text-slate-400 font-mono">
            União de UX moderno com computação gráfica na web.
          </span>

          <button
            on:click={scrollToContent}
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-blue-500/25 transition cursor-pointer whitespace-nowrap text-center"
          >
            Ver Demonstrações ↓
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom Scroll Indicator (No section descriptions or dialogue) -->
    <div class="flex items-center justify-end text-[11px] font-mono text-slate-400 pointer-events-auto">
      <button
        on:click={scrollToContent}
        class="hidden md:flex items-center gap-1.5 text-slate-400 hover:text-white transition animate-bounce cursor-pointer"
      >
        <span>Rolar para baixo</span>
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .prince-hero-wrapper {
    background-color: #000000;
  }
</style>
