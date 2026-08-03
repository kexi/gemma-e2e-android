import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";

import { type DevicePlatform, failureLabelFor } from "./devicePlatform.ts";

export type { DevicePlatform };

export type ConnectionState = "connecting" | "live" | "disconnected" | "unavailable" | "paused";

/** The gateway sends 1011 when the upstream source failed, not the browser. */
const CLOSE_UPSTREAM_FAILED = 1011;

const STATE_LABEL: Record<Exclude<ConnectionState, "unavailable">, string> = {
  connecting: "Connecting",
  live: "Live",
  disconnected: "Disconnected",
  paused: "Paused (off-screen)",
};

const STATE_COLOR: Record<ConnectionState, "default" | "success" | "warning" | "error"> = {
  connecting: "default",
  live: "success",
  disconnected: "warning",
  unavailable: "error",
  paused: "default",
};

/** `contentvisibilityautostatechange` is only raised where the property exists. */
const SUPPORTS_CONTENT_VISIBILITY = "contentVisibility" in document.documentElement.style;

interface ContentVisibilityEvent extends Event {
  readonly skipped: boolean;
}

function streamUrl(platform: DevicePlatform): string {
  // Same origin as the page: in development Vite proxies /api (ws:true) to the
  // Hono server, in production Hono serves both.
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/device/stream?platform=${platform}`;
}

export interface DeviceLiveViewProps {
  /** Which source to watch. Changing it reopens the socket on the other one. */
  platform: DevicePlatform;
  /** Cap on the rendered height; the run pane gives it less room than the idle pane. */
  maxHeight?: number | string;
  /** Hidden beside a run, where the surrounding card already explains itself. */
  showHint?: boolean;
}

/**
 * Live screen of whichever source `platform` names, fed by frames the server
 * relays -- PNG off the emulator's gRPC `streamScreenshot`, JPEG off Chrome's
 * screencast.
 *
 * The socket is owned by this component, so mounting and unmounting is what
 * opens and closes it: the run pane can drop the element when a run ends and
 * the stream is released without any extra coordination. On top of that, the
 * wrapper carries `content-visibility: auto`, and the browser's own
 * skip/render decision closes and reopens the socket — a scrolled-away or
 * background-tabbed view stops costing the source an encode per frame.
 */
export function DeviceLiveView({
  platform,
  maxHeight = "70vh",
  showHint = true,
}: DeviceLiveViewProps) {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rendered, setRendered] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref rather than state: the cleanup path has to revoke the URL
  // that is currently on screen, and reading it from state there would close
  // over a stale value.
  const currentUrl = useRef<string | null>(null);

  const reconnect = useCallback(() => {
    setState("connecting");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    if (SUPPORTS_CONTENT_VISIBILITY) {
      // The listener has to sit on the element carrying the property: the
      // event does not bubble in every implementation.
      const onStateChange = (event: Event) => {
        setRendered(!(event as ContentVisibilityEvent).skipped);
      };
      container.addEventListener("contentvisibilityautostatechange", onStateChange);
      return () => {
        container.removeEventListener("contentvisibilityautostatechange", onStateChange);
      };
    }

    // Rough approximation for browsers without content-visibility: the margin
    // reopens the socket slightly before the view is actually on screen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setRendered(entry.isIntersecting);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!rendered) {
      setState("paused");
      return;
    }

    setState("connecting");
    const socket = new WebSocket(streamUrl(platform));
    socket.binaryType = "blob";
    let closed = false;

    const show = (blob: Blob): void => {
      const url = URL.createObjectURL(blob);
      // Every frame allocates an object URL, so the previous one has to be
      // released or a long session leaks one blob per frame.
      if (currentUrl.current !== null) {
        URL.revokeObjectURL(currentUrl.current);
      }
      currentUrl.current = url;
      setFrameUrl(url);
    };

    socket.onopen = () => {
      if (!closed) setState("live");
    };
    socket.onmessage = (event: MessageEvent<Blob>) => {
      if (!closed) show(event.data);
    };
    socket.onerror = () => {
      if (!closed) setState("unavailable");
    };
    socket.onclose = (event) => {
      if (closed) return;
      setState(event.code === CLOSE_UPSTREAM_FAILED ? "unavailable" : "disconnected");
    };

    return () => {
      closed = true;
      socket.close();
      if (currentUrl.current !== null) {
        URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = null;
      }
      // The last frame's URL is gone, so the <img> must not keep pointing at it.
      setFrameUrl(null);
    };
    // `platform` belongs here: switching it has to drop this socket and open
    // one on the other source, which is exactly what re-running the effect
    // does. Leaving it out would keep showing the previous platform's frames.
  }, [attempt, rendered, platform]);

  const isBroken = state === "unavailable" || state === "disconnected";
  // "Emulator unreachable" on a browser view names the wrong thing, and this
  // is the state where the message has to be right -- it is the one the reader
  // acts on.
  const isUnreachable = state === "unavailable";
  const isAndroid = platform === "android";
  const label = isUnreachable ? failureLabelFor(platform) : STATE_LABEL[state];

  return (
    <Stack className="device-live-view" ref={containerRef} spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Chip label={label} color={STATE_COLOR[state]} size="small" />
        <Box sx={{ flexGrow: 1 }} />
        {isBroken && (
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={reconnect}>
            Reconnect
          </Button>
        )}
      </Stack>

      {isBroken && (
        <Alert severity={isUnreachable ? "error" : "warning"}>
          {isAndroid ? (
            <>
              The live view needs the emulator running with its gRPC bridge: <code>just emu</code>{" "}
              starts it with <code>-grpc 8554</code>. As a fallback, <code>just mirror</code> opens
              the same screen in scrcpy.
            </>
          ) : (
            <>
              The live view needs Chrome running with its DevTools port: <code>just chrome</code>{" "}
              opens one. Set <code>CHROME_ENDPOINT</code> to reach a browser started some other way.
            </>
          )}
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "common.black",
          // Portrait device: reserve height so the frame does not resize the
          // page when the first one lands.
          minHeight: 320,
          p: 1,
        }}
      >
        {frameUrl === null ? (
          <Typography variant="body2" color="text.secondary">
            {state === "connecting" && "Waiting for the first frame…"}
            {state === "paused" && "Streaming stops while the view is off-screen."}
            {state !== "connecting" && state !== "paused" && "No frame"}
          </Typography>
        ) : (
          <Box
            component="img"
            src={frameUrl}
            alt="Emulator screen"
            sx={{ maxWidth: "100%", maxHeight, objectFit: "contain", display: "block" }}
          />
        )}
      </Paper>

      {showHint && (
        <Typography variant="body2" color="text.secondary">
          Frames arrive only when the screen changes, so a still device shows a static image. The
          view is read-only.
        </Typography>
      )}
    </Stack>
  );
}
