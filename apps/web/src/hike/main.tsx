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
