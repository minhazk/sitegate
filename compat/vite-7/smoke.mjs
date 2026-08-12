import { sitegate } from "sitegate/vite";

const plugin = sitegate({ enabled: false });

if (
  typeof plugin.configureServer !== "function" ||
  typeof plugin.configurePreviewServer !== "function"
) {
  throw new Error("Vite 7 server hooks are unavailable.");
}
