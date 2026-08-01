import { Link as RouterLink, Outlet } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import HistoryIcon from "@mui/icons-material/History";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import SmartphoneIcon from "@mui/icons-material/Smartphone";

export function App() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar position="static">
        <Toolbar>
          <SmartphoneIcon sx={{ mr: 1 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            gemma-e2e
          </Typography>
          <Button color="inherit" component={RouterLink} to="/" startIcon={<PlaylistPlayIcon />}>
            Scenarios
          </Button>
          <Button color="inherit" component={RouterLink} to="/runs" startIcon={<HistoryIcon />}>
            History
          </Button>
          <Button
            color="inherit"
            component={RouterLink}
            to="/device"
            startIcon={<SmartphoneIcon />}
          >
            Device
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
