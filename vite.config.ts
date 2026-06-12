import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { planningApiPlugin } from "./src/server/planningApi";

const root = process.env.PLANARIUM_ROOT ?? process.cwd();
const port = Number(process.env.PORT ?? process.env.PLANARIUM_PORT ?? 9010);
const maxDepth = Number(process.env.PLANARIUM_DEPTH ?? 5);

export default defineConfig({
  plugins: [react(), planningApiPlugin({ root, maxDepth })],
  build: {
    emptyOutDir: false,
    outDir: "dist/client",
  },
  server: {
    port,
    host: true,
  },
});
