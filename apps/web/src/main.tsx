import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { App } from "./App.tsx";
import { ScenariosPage } from "./pages/ScenariosPage.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { DevicePage } from "./pages/DevicePage.tsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ScenariosPage /> },
      { path: "runs", element: <HistoryPage /> },
      { path: "runs/:id", element: <RunPage /> },
      { path: "device", element: <DevicePage /> },
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
