import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/App";
import { browserOvenSnapshotClient } from "@/lib/oven-event-client.mjs";

browserOvenSnapshotClient.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
