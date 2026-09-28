import { useState } from "react";
import { Outlet } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import type { Locale } from "./i18n.ts";
import { useI18n } from "./I18nProvider.tsx";
import { DEFAULT_RAIL_WIDTH } from "./railWidth.ts";
import { ResizableRail } from "./ResizableRail.tsx";
import { Sidebar } from "./Sidebar.tsx";

/**
 * The workbench shell: one screen, a standing left rail that starts runs and
 * selects them, and a main pane the router swaps between the idle device view
 * and a run. From `md` up the rail's edge is a handle that resizes it. Below
 * `md` the rail becomes a temporary Drawer, so the main pane keeps the full
 * width on a laptop's second screen or a tablet.
 */
export function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { t, locale, setLocale } = useI18n();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <IconButton
            color="inherit"
            edge="start"
            aria-label={t.app.openRail}
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 1, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <SmartphoneIcon sx={{ mr: 1, display: { xs: "none", md: "inline-flex" } }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            gemma-e2e
          </Typography>
          {/* Each language named in itself, with a matching `lang`, so a
              reader who cannot read the current one can still find theirs and
              a screen reader pronounces it in the right voice. */}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={locale}
            onChange={(_event, next: Locale | null) => {
              // Null when the active button is clicked again; staying put is
              // what a two-way switch should do there.
              const isDeselect = next === null;
              if (!isDeselect) {
                setLocale(next);
              }
            }}
            aria-label={t.app.language}
            sx={{
              "& .MuiToggleButton-root": {
                color: "inherit",
                borderColor: "rgba(255, 255, 255, 0.5)",
                px: 1,
                py: 0.25,
                textTransform: "none",
              },
              "& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover": {
                color: "inherit",
                bgcolor: "rgba(255, 255, 255, 0.24)",
              },
            }}
          >
            <ToggleButton value="en" lang="en">
              EN
            </ToggleButton>
            <ToggleButton value="ja" lang="ja">
              日本語
            </ToggleButton>
          </ToggleButtonGroup>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
        <ResizableRail>
          <Sidebar />
        </ResizableRail>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sx={{ display: { md: "none" } }}
          slotProps={{ paper: { sx: { width: DEFAULT_RAIL_WIDTH } } }}
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
