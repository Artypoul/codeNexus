import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  define: {
    "import.meta.env.VITE_WS_URL": JSON.stringify(""),
    "import.meta.env.VITE_HTTP_URL": JSON.stringify(""),
    "import.meta.env.VITE_T3CODE_RELAY_URL": JSON.stringify(""),
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(""),
    "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(""),
    "import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID": JSON.stringify(""),
    "import.meta.env.VITE_RELAY_OTLP_TRACES_URL": JSON.stringify(""),
    "import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET": JSON.stringify(""),
    "import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN": JSON.stringify(""),
    "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(""),
    "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify("desktop"),
    "import.meta.env.T3CODE_FEATURE_SECRETS": JSON.stringify(""),
    "import.meta.env.VITE_RELEASE_CHANNEL": JSON.stringify("desktop"),
    "import.meta.env.APP_VERSION": JSON.stringify("0.1.7"),
    "import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY": JSON.stringify(""),
  },
  build: { outDir: "dist", emptyOutDir: true, manifest: true, sourcemap: false },
});
