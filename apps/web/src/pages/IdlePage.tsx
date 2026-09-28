import { useEffect, useRef } from "react";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DeviceLiveView } from "../DeviceLiveView.tsx";
import { DevicePlatformPicker } from "../DevicePlatformPicker.tsx";
import { useI18n } from "../I18nProvider.tsx";
import { useDevicePlatform } from "../useDevicePlatform.ts";

/**
 * What the main pane shows with no run selected: the emulator screen, which is
 * what the old standalone Device page existed for, plus the one line that says
 * where runs come from.
 */
export function IdlePage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [platform, setPlatform] = useDevicePlatform();
  const { t } = useI18n();

  // The view transition morphs the pane but leaves focus wherever the click
  // left it, which for a rail button is an element the new pane never had.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="h5" component="h1" ref={headingRef} tabIndex={-1}>
          {t.idle.heading}
        </Typography>
        <DevicePlatformPicker value={platform} onChange={setPlatform} />
      </Stack>
      <Alert severity="info">{t.idle.intro}</Alert>
      <DeviceLiveView platform={platform} />
    </Stack>
  );
}
