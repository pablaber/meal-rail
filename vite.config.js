import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Every build gets an id. A running copy of the app compares it against the
// deployed version.json to notice a release it is missing — see src/update.js.
// On CI the commit is the natural id; locally a timestamp keeps builds distinct.
const buildId =
  process.env.GITHUB_SHA?.slice(0, 7) || `dev-${Date.now().toString(36)}`;

const PRECACHE_PUBLIC_FILES = [
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable.png",
  "icon.svg",
];

// Publishes the build id next to the app so a running copy can fetch it. Emitted
// by the build rather than kept in public/, since its contents change per build.
const versionFile = {
  name: "meal-rail-build-files",
  generateBundle(_, bundle) {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: `${JSON.stringify({ buildId })}\n`,
    });

    // The worker is deliberately kept dependency-free. Give it the exact
    // fingerprinted files for this build so its install can make the app
    // offline-ready before taking control. An empty path resolves to the
    // configured base URL, which is the navigation we need to cache.
    const files = new Set(["", ...PRECACHE_PUBLIC_FILES]);
    for (const output of Object.values(bundle)) {
      if (
        output.fileName !== "version.json" &&
        !output.fileName.endsWith(".map")
      ) {
        files.add(output.fileName);
      }
    }

    this.emitFile({
      type: "asset",
      fileName: `precache-${buildId}.json`,
      source: `${JSON.stringify([...files])}\n`,
    });
  },
};

// GitHub Pages serves project sites from /<repo-name>/, so the build needs a
// matching base path. The deploy workflow sets BASE_PATH; local dev uses "/".
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), tailwindcss(), versionFile],
});
