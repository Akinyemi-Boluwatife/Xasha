import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({ server: { cors: false }, plugins: [cloudflare()] })
