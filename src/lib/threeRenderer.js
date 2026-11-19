/**
 * threeRenderer.js — fábrica única de renderers Three.js do site.
 *
 * Política: **WebGPU sempre**. WebGL (backend WebGL2 do WebGPURenderer) só entra se o WebGPU falhar de verdade
 * (sem navigator.gpu, sem adapter de hardware, erro no requestDevice/init ou
 * device perdido na criação). Nenhuma página pode forçar WebGL por opção;
 * o único override é o `?forceWebGL` na URL (usado pelo DebugOverlay para
 * comparar os dois backends).
 *
 * Performance:
 *  - Um único GPUDevice é criado e compartilhado entre todos os renderers da
 *    página (Home tem fundo + celular + avião + modelagem 3D). Criar um device
 *    por canvas custa 50–300 ms cada; compartilhando, só o primeiro paga.
 *  - `warmupGPU()` dispara adapter/device e o download do chunk three/webgpu
 *    em paralelo com o resto da página (chamado no +layout).
 *  - Adapter "fallback" (software / SwiftShader) é tratado como falha: nesses
 *    casos o WebGL acelerado por hardware é bem mais rápido.
 *
 * Uso:
 *   import { createRenderer } from '$lib/threeRenderer.js';
 *   const { renderer, currentRenderer } = await createRenderer({ antialias: true, alpha: true });
 */

let gpuPromise = null; // Promise<{ adapter, device } | null>
let webgpuModulePromise = null;
let webgpuBroken = false; // depois de uma falha real, não tenta de novo nesta aba

function forcedWebGLByUrl() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('forceWebGL');
  } catch {
    return false;
  }
}

function loadWebGPUModule() {
  if (!webgpuModulePromise) {
    webgpuModulePromise = import('three/webgpu').catch((e) => {
      webgpuModulePromise = null;
      throw e;
    });
  }
  return webgpuModulePromise;
}

/**
 * Cria (uma vez) o adapter + device WebGPU compartilhado.
 * Resolve `null` quando WebGPU não está disponível de verdade.
 */
function getSharedGPU() {
  if (gpuPromise) return gpuPromise;

  gpuPromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      console.info('[threeRenderer] navigator.gpu indisponível → WebGL');
      return null;
    }
    let adapter = await navigator.gpu
      .requestAdapter({ powerPreference: 'high-performance' })
      .catch(() => null);
    if (!adapter) {
      adapter = await navigator.gpu.requestAdapter().catch(() => null);
    }
    if (!adapter) {
      console.warn('[threeRenderer] Nenhum adapter WebGPU → WebGL');
      return null;
    }
    const isFallback = adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter;
    if (isFallback) {
      console.warn('[threeRenderer] Adapter WebGPU é software (fallback) → WebGL de hardware é mais rápido');
      return null;
    }

    // Mesmas features que o WebGPUBackend do three pediria sozinho.
    const requiredFeatures = [...adapter.features];
    const lim = adapter.limits;
    const requiredLimits = {};
    // Shadow maps 8K (configuração "epic" do jogo) e buffers grandes de instancing.
    if (lim?.maxTextureDimension2D) requiredLimits.maxTextureDimension2D = Math.min(lim.maxTextureDimension2D, 16384);
    if (lim?.maxBufferSize) requiredLimits.maxBufferSize = lim.maxBufferSize;
    if (lim?.maxStorageBufferBindingSize) requiredLimits.maxStorageBufferBindingSize = lim.maxStorageBufferBindingSize;

    let device;
    try {
      device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
    } catch (e) {
      console.warn('[threeRenderer] requestDevice com limites altos falhou, tentando padrão:', e?.message);
      device = await adapter.requestDevice({ requiredFeatures }).catch(() => null);
    }
    if (!device) return null;

    device.lost.then((info) => {
      console.warn('[threeRenderer] GPUDevice perdido:', info?.reason, info?.message);
      gpuPromise = null; // próximo renderer cria um device novo
    });
    return { adapter, device };
  })().catch((e) => {
    console.warn('[threeRenderer] Falha ao iniciar WebGPU:', e);
    return null;
  });

  return gpuPromise;
}

/**
 * Começa a preparar o WebGPU o quanto antes (adapter, device e o chunk
 * three/webgpu) sem bloquear nada. Seguro chamar várias vezes.
 */
export function warmupGPU() {
  if (typeof window === 'undefined' || forcedWebGLByUrl()) return;
  getSharedGPU();
  loadWebGPUModule().catch(() => {});
}

/** true quando o navegador tem WebGPU de hardware utilizável. */
export async function isWebGPUAvailable() {
  if (forcedWebGLByUrl() || webgpuBroken) return false;
  return Boolean(await getSharedGPU());
}

/**
 * @typedef {Object} RendererResult
 * @property {any} renderer
 * @property {'WebGPU' | 'WebGL'} currentRenderer
 */

/**
 * Cria um renderer: WebGPU (device compartilhado) e, só se falhar, WebGL.
 * @param {Object} [options] opções do construtor (antialias, alpha, canvas…).
 *   `forceWebGL` é ignorado de propósito; `preserveDrawingBuffer` só vale no WebGL.
 * @returns {Promise<RendererResult>}
 */
export async function createRenderer(options = {}) {
  // eslint-disable-next-line no-unused-vars
  const { forceWebGL: _ignored, powerPreference, ...rendererOptions } = options;
  const forceWebGL = forcedWebGLByUrl();

  if (!forceWebGL && !webgpuBroken) {
    let renderer = null;
    try {
      const [gpu, mod] = await Promise.all([getSharedGPU(), loadWebGPUModule()]);
      const WebGPURenderer = mod?.WebGPURenderer;
      if (gpu && WebGPURenderer) {
        renderer = new WebGPURenderer({
          antialias: true,
          ...rendererOptions,
          device: gpu.device,
          powerPreference: 'high-performance',
        });
        await renderer.init();
        // Se por algum motivo o three caiu no backend WebGL2 interno, trata como WebGPU indisponível
        if (renderer.backend && renderer.backend.isWebGPUBackend !== true) {
          throw new Error('WebGPURenderer caiu no backend WebGL2');
        }
        return { renderer, currentRenderer: 'WebGPU' };
      }
    } catch (e) {
      console.warn('[threeRenderer] WebGPU falhou, usando WebGL:', e?.message || e);
      webgpuBroken = true;
      try {
        renderer?.dispose?.();
      } catch {
        /* ignore */
      }
    }
  }

  // --- Fallback WebGL: backend WebGL2 do próprio WebGPURenderer ---
  // (mesmos materiais/cena; o WebGLRenderer clássico não entra mais no bundle)
  const { WebGPURenderer } = await loadWebGPUModule();
  const renderer = new WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    ...rendererOptions,
    forceWebGL: true,
  });
  await renderer.init();
  console.info(`[threeRenderer] WebGL${forceWebGL ? ' (forçado via ?forceWebGL)' : ' (fallback)'}`);
  return { renderer, currentRenderer: 'WebGL' };
}

/**
 * Captura o canvas como PNG funcionando em WebGPU e WebGL: renderiza e lê o
 * canvas na mesma tarefa (o swap-chain do WebGPU ainda é válido nesse momento).
 */
export function captureCanvas(renderer, scene, camera, type = 'image/png') {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL(type);
}
