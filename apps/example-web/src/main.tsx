import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { A11yLab } from "./A11yLab.tsx";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root to mount into");
}

// A query flag rather than a screen in the shop flow: the shop screens are what
// the scenarios and the recorded benchmarks run against, and a new route there
// would change the UI tree every past run was measured on.
const isA11yLab = new URLSearchParams(window.location.search).get("lab") === "a11y";

createRoot(root).render(<StrictMode>{isA11yLab ? <A11yLab /> : <App />}</StrictMode>);
