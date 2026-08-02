import { useEffect, useState } from "react";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { DevicePlatform } from "./DeviceLiveView.tsx";

const LABEL: Record<DevicePlatform, string> = {
  android: "Android",
  web: "Web",
};

/** What the server says it can show, so a build with one source hides the picker. */
async function fetchPlatforms(): Promise<DevicePlatform[]> {
  const response = await fetch("/api/device/platforms");
  const isMissing = !response.ok;
  if (isMissing) {
    return [];
  }
  const body = (await response.json()) as { platforms?: DevicePlatform[] };
  return body.platforms ?? [];
}

export interface DevicePlatformPickerProps {
  value: DevicePlatform;
  onChange: (platform: DevicePlatform) => void;
}

/**
 * Chooses which live view to show.
 *
 * The server attaches both sources, since neither costs anything idle, so this
 * is a view control rather than a server setting -- a run on either platform
 * can be watched without restarting anything. Renders nothing when the server
 * offers fewer than two, which is what a single-platform build looks like.
 */
export function DevicePlatformPicker({ value, onChange }: DevicePlatformPickerProps) {
  const [available, setAvailable] = useState<DevicePlatform[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchPlatforms().then((platforms) => {
      // Guarded because the page can be left while this is in flight, and
      // setting state on an unmounted component is a warning at best.
      if (!cancelled) {
        setAvailable(platforms);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasChoice = available.length > 1;
  if (!hasChoice) {
    return null;
  }

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_event, next: DevicePlatform | null) => {
        // Null when the active button is clicked again; keeping the current
        // choice is better than deselecting into a view of nothing.
        const isDeselect = next === null;
        if (!isDeselect) {
          onChange(next);
        }
      }}
      aria-label="Live view platform"
    >
      {available.map((platform) => (
        <ToggleButton key={platform} value={platform}>
          {LABEL[platform]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
