import { writable } from 'svelte/store';

/**
 * Global store for the Three.js renderer.
 * Components that initialize a renderer should update this store.
 * The DebugOverlay component in the main layout subscribes to this.
 */
export const debugRenderer = writable({
  renderer: null,
  currentRenderer: 'WebGL',
  tier: 'high'
});

/**
 * Helper to update the debug renderer from any component.
 * @param {import('three').WebGLRenderer | any} renderer 
 * @param {'WebGPU' | 'WebGL'} currentRenderer 
 * @param {'low' | 'medium' | 'high'} [tier='high']
 */
export function registerRenderer(renderer, currentRenderer, tier = 'high') {
  debugRenderer.set({ renderer, currentRenderer, tier });
}

/**
 * Helper to clear the renderer when it's disposed.
 */
export function unregisterRenderer() {
  debugRenderer.set({ renderer: null, currentRenderer: 'WebGL', tier: 'high' });
}
