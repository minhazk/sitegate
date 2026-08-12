import { sitegate } from "sitegate/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sitegate({ enabled: false })] });
