import { useCallback, useState } from "react";
import type { DevicePlatform } from "./DeviceLiveView.tsx";

const STORAGE_KEY = "gemma-e2e.device-platform";

function stored(): DevicePlatform | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "android" || value === "web" ? value : null;
  } catch {
    // Storage can be denied outright (private mode, blocked cookies). The
    // picker still works, it just forgets between visits.
    return null;
  }
}

/**
 * The live view's platform, remembered across pages and reloads.
 *
 * Kept out of the URL: it says which screen you are watching, not which run
 * you are looking at, so it should survive navigating between runs rather than
 * reset with each one. Android is the default because it is what the view was
 * built for and what a repository named for it most often drives.
 */
export function useDevicePlatform(): [DevicePlatform, (next: DevicePlatform) => void] {
  const [platform, setPlatform] = useState<DevicePlatform>(() => stored() ?? "android");

  const choose = useCallback((next: DevicePlatform) => {
    setPlatform(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // As above: remembering is a convenience, not a requirement.
    }
  }, []);

  return [platform, choose];
}
