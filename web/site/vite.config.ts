import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: local('./'),
  publicDir: local('../public'),
  plugins: [react()],
  resolve: {
    // Shared page files live above this isolated package; resolve their React here.
    alias: {
      'react-dom': local('./node_modules/react-dom'),
      'react-router': local('./node_modules/react-router'),
      react: local('./node_modules/react'),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
