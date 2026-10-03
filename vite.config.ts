import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 可用 WC_API_TARGET 指向非默认端口的后端（如并行运行的第二个实例）
      "/api": process.env.WC_API_TARGET ?? "http://localhost:3000",
    },
  },
});