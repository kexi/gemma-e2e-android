import { useState } from "react";
import { Outlet } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import { Sidebar } from "./Sidebar.tsx";

const SIDEBAR_WIDTH = 340;

/**
 * The workbench shell: one screen, a standing left rail that starts runs and
 * selects them, and a main pane the router swaps between the idle device view
 * and a run. Below `md` the rail becomes a temporary Drawer, so the main pane
 * keeps the full width on a laptop's second screen or a tablet.
 */
export function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <IconButton
            color="inherit"
            edge="start"
            aria-label="Open the run rail"
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 1, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <SmartphoneIcon sx={{ mr: 1, display: { xs: "none", md: "inline-flex" } }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            gemma-e2e
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <Box
          component="nav"
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            display: { xs: "none", md: "block" },
            borderRight: 1,
            borderColor: "divider",
            overflowY: "auto",
          }}
        >
          <Sidebar />
        </Box>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sx={{ display: { md: "none" } }}
          slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH } } }}
        >
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </Drawer>

        {/* The view-transition name lives here, so only the main pane slides
            while the rail and the app bar hold still. */}
        <Box
          component="main"
          className="workbench-main"
          sx={{ flexGrow: 1, minWidth: 0, overflowY: "auto", p: { xs: 2, md: 3 } }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
