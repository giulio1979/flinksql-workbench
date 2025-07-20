import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: true, // Allow all hosts
    proxy: {
      // Proxy all /api/flink requests to the Flink SQL Gateway
      '/api/flink': {
        target: process.env.FLINK_HOST || 'http://localhost:8083',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/flink/, ''),
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying request:', req.method, req.url, '-> http://localhost:8083' + req.url.replace('/api/flink', ''));
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url);
          });
        }
      }
    }
  },
  preview: {
    host: '0.0.0.0', // Allow all hostnames for preview mode
    port: 4173
  }
})
