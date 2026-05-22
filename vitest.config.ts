import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? "test", process.cwd(), "VITE_");
  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      env: {
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || "https://placeholder.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY || "placeholder-key",
      },
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
  };
});
