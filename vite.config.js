import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: [
      // Todo `import ... from "three"` (páginas e loaders do examples/jsm) vira
      // three/webgpu: o site inteiro roda no WebGPURenderer e o bundle do
      // WebGLRenderer clássico (~330 kB / 82 kB gzip) não é mais baixado.
      // O fallback WebGL usa o backend WebGL2 do próprio WebGPURenderer.
      { find: /^three$/, replacement: 'three/webgpu' }
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/build/**', '**/docs/**']
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  },
  ssr: {
    noExternal: ['three']
  }
});
