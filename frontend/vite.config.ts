import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [
      'videos-sim-asthma-nonprofit.trycloudflare.com',
      '.trycloudflare.com', // allow all subdomains
    ],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})