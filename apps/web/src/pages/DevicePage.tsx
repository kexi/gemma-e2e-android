import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DeviceLiveView } from "../DeviceLiveView.tsx";

/**
 * Standing view of the emulator screen, independent of any run. The Run page
 * embeds the same component while a run is in progress.
 */
export function DevicePage() {
  return (
    <Stack spacing={3}>
      <Typography variant="h5" component="h1">
        Device
      </Typography>
      <DeviceLiveView />
    </Stack>
  );
}
