import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // allows external connections
    allowedHosts: true, // allows ngrok domains (for newer vite)
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
})
