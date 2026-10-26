import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import hmrToast from "vite-plugin-hmr-toast";

export default defineConfig({
  plugins: [react(), hmrToast({ duration: 2200 })],
});
