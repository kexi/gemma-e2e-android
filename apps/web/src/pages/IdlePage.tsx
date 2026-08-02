import { useEffect, useRef } from "react";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DeviceLiveView } from "../DeviceLiveView.tsx";
import { DevicePlatformPicker } from "../DevicePlatformPicker.tsx";
import { useDevicePlatform } from "../useDevicePlatform.ts";

/**
 * What the main pane shows with no run selected: the emulator screen, which is
 * what the old standalone Device page existed for, plus the one line that says
 * where runs come from.
 */
export function IdlePage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [platform, setPlatform] = useDevicePlatform();

  // The view transition morphs the pane but leaves focus wherever the click
  // left it, which for a rail button is an element the new pane never had.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="h5" component="h1" ref={headingRef} tabIndex={-1}>
          Device
        </Typography>
        <DevicePlatformPicker value={platform} onChange={setPlatform} />
      </Stack>
      <Alert severity="info">
        Pick a run from the rail to watch it, or start one there — a scenario with the play button,
        or a one-off prompt with the model you want.
      </Alert>
      <DeviceLiveView platform={platform} />
    </Stack>
  );
}
