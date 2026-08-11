import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { registerServiceWorker, watchForUpdates } from "./update.js";
import { watchTaps } from "./haptics.js";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support, so the checklist opens on a plane or in a basement — and the
// counterweight to it, so an installed copy doesn't sit on an old build.
registerServiceWorker();
watchForUpdates();

// A buzz under the finger on every control, where the device has one.
watchTaps();
