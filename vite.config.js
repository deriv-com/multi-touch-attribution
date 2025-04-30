import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import typescript from '@rollup/plugin-typescript';

export default defineConfig({
  build: {
    lib: {
      // The entry point for your library
      entry: resolve(__dirname, 'src/index.tsx'),
      // The name that will be used for the global variable in UMD builds
      name: 'UserJourneyTracker',
      // Output file formats
      formats: ['es', 'umd'],
      // File name pattern for output
      fileName: (format) => `user-journey-tracker.${format}.js`
    },
    rollupOptions: {
      // Make sure to externalize dependencies that shouldn't be bundled
      external: [], // No external dependencies for this library
      output: {
        // Global variable names used in UMD build
        globals: {}
      }
    },
    // Generate source maps
    sourcemap: false,
    // Minify the output
    minify: 'terser'
  },
  plugins: [
    // Generate TypeScript declaration files
    dts(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist/types'
    })
  ]
});