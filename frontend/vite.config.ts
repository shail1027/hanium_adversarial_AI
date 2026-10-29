import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VERIFACE_');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': env.VERIFACE_API_TARGET || 'http://127.0.0.1:8001',
      },
    },
  };
});
