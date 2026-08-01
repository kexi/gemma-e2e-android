import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { App } from "./App.tsx";
import { IdlePage } from "./pages/IdlePage.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import "./workbench.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <IdlePage /> },
      { path: "runs/:id", element: <RunPage /> },
      // The workbench absorbed both of these: history is the rail's own list,
      // and the device view is what the idle main pane shows. Bookmarks and
      // the browser's own history still resolve.
      { path: "runs", element: <Navigate to="/" replace /> },
      { path: "device", element: <Navigate to="/" replace /> },
    ],
  },
]);

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <CssBaseline />
    <RouterProvider router={router} />
  </StrictMode>,
);
