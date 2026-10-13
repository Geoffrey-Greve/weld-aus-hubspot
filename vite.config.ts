import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const modulesDir = resolve(__dirname, 'src/modules')

function discoverModuleEntries(): Record<string, string> {
  if (!existsSync(modulesDir)) return {}
  const entries: Record<string, string> = {}
  for (const name of readdirSync(modulesDir)) {
    const dir = join(modulesDir, name)
    if (!statSync(dir).isDirectory()) continue
    const entry = join(dir, 'index.tsx')
    if (existsSync(entry)) entries[name] = entry
  }
  return entries
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@styles': resolve(__dirname, 'src/styles')
    }
  },
  build: {
    outDir: 'theme/assets/js',
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
    // Suppress Vite's built-in size warning for the expected vendor-react chunk
    // (~142 KB minified / 45 KB gzip). Entry-chunk enforcement is handled by
    // check-bundle-size.ts (budget: 80 KB gzip per entry).
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: discoverModuleEntries(),
      output: {
        entryFileNames: '[name].[hash].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        // Extract React + ReactDOM + scheduler into a shared vendor chunk so
        // every island bundle only carries its own code (~45 KB React chunk
        // is fetched once and cached across all islands).
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          // Shared src/shared/ utilities land in one chunk, deduplicated
          // across all island entry points.
          if (id.includes('/src/shared/')) {
            return 'shared'
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
