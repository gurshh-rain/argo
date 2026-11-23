import { defineConfig } from "vite";
import { wasp } from "wasp/client/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [wasp(), tailwindcss()],
  server: {
    // reachable through an HTTPS tunnel so a phone can use the microphone
    host: true,
    allowedHosts: true,
    // one public origin for both client and API: the phone calls <origin>/_server/...
    proxy: {
      "/_server": { target: "http://localhost:4319", changeOrigin: true, rewrite: (p) => p.replace(/^\/_server/, "") },
    },
  },
});
