import { defineConfig } from "vite";
import hmrToast from "vite-plugin-hmr-toast";

export default defineConfig({
  plugins: [hmrToast({ exclude: [".generated."] })],
});
