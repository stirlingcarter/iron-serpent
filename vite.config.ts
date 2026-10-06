import { defineConfig } from "vite";

// GitHub Pages serves project sites from /<repo-name>/. The deploy workflow
// sets VITE_BASE accordingly; local dev and user/organization sites use "/".
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 4517,
    strictPort: true,
  },
});
