import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ercot-net-load-surprise-monitor/",
  build: {
    sourcemap: true
  }
});
