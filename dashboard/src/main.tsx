import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/App";
import { legacyRoute } from "@/lib";

const redirected = legacyRoute({ pathname: window.location.pathname, search: window.location.search });
if (redirected) window.history.replaceState(null, "", redirected);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
