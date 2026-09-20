import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "leaflet/dist/leaflet.css";

const host = document.getElementById("app");
if (!host) throw new Error("No #app element to mount into");
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Tells the self-heal guard in hike.html that the app is alive, so it does
// not clear the caches out from under a perfectly working page.
declare global {
  interface Window {
    __slownavMounted?: boolean;
  }
}
window.__slownavMounted = true;
