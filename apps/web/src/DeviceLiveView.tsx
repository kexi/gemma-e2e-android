import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";

export type ConnectionState = "connecting" | "live" | "disconnected" | "unavailable";

/** The gateway sends 1011 when the emulator side failed, not the browser. */
const CLOSE_UPSTREAM_FAILED = 1011;

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  disconnected: "Disconnected",
  unavailable: "Emulator unreachable",
};

const STATE_COLOR: Record<ConnectionState, "default" | "success" | "warning" | "error"> = {
  connecting: "default",
  live: "success",
  disconnected: "warning",
  unavailable: "error",
};

function streamUrl(): string {
  // Same origin as the page: in development Vite proxies /api (ws:true) to the
  // Hono server, in production Hono serves both.
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/device/stream`;
}

export interface DeviceLiveViewProps {
  /** Cap on the rendered height; the Run page gives it less room than the Device page. */
  maxHeight?: number | string;
  /** Hidden on the Run page, where the surrounding card already explains itself. */
  showHint?: boolean;
}

/**
 * Live emulator screen, fed by PNG frames the server relays off the emulator's
 * gRPC `streamScreenshot`.
 *
 * The socket is owned by this component, so mounting and unmounting is what
 * opens and closes it: the Run page can drop the element when a run ends and
 * the stream is released without any extra coordination.
 */
export function DeviceLiveView({ maxHeight = "70vh", showHint = true }: DeviceLiveViewProps) {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Held in a ref rather than state: the cleanup path has to revoke the URL
  // that is currently on screen, and reading it from state there would close
  // over a stale value.
  const currentUrl = useRef<string | null>(null);

  const reconnect = useCallback(() => {
    setState("connecting");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(streamUrl());
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
    };
  }, [attempt]);

  const isBroken = state === "unavailable" || state === "disconnected";

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Chip label={STATE_LABEL[state]} color={STATE_COLOR[state]} size="small" />
        <Box sx={{ flexGrow: 1 }} />
        {isBroken && (
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={reconnect}>
            Reconnect
          </Button>
        )}
      </Stack>

      {isBroken && (
        <Alert severity={state === "unavailable" ? "error" : "warning"}>
          The live view needs the emulator running with its gRPC bridge: <code>just emu</code>{" "}
          starts it with <code>-grpc 8554</code>. As a fallback, <code>just mirror</code> opens the
          same screen in scrcpy.
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
            {state === "connecting" ? "Waiting for the first frame…" : "No frame"}
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
