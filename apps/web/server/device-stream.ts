import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";

/** Where the gateway reaches the emulator's gRPC bridge (`emulator -grpc 8554`). */
export const DEFAULT_EMULATOR_GRPC_TARGET = "localhost:8554";

/** Frames wider than the device are pointless; this keeps PNGs small enough to push at speed. */
const DEFAULT_FRAME_WIDTH = 360;
const DEFAULT_FRAME_HEIGHT = 800;

/** Close codes the browser sees. 1011 is the WebSocket "internal error" code. */
export const CLOSE_UPSTREAM_FAILED = 1011;

/** One screenshot off the emulator's `streamScreenshot` stream. */
export interface DeviceFrame {
  image: Uint8Array<ArrayBuffer>;
  seq: number;
}

/**
 * The half of a gRPC server-streaming call this module uses. Narrowing it to
 * three members is what lets the tests drive the relay with a plain
 * EventEmitter instead of a live emulator.
 */
export interface FrameStream {
  on(event: "data", listener: (frame: DeviceFrame) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end", listener: () => void): void;
  cancel(): void;
}

/** Opens a screenshot stream. Injected so tests can supply a fake. */
export type OpenFrameStream = () => FrameStream;

/** The bits of a WebSocket the relay writes to; `ws` and Bun's socket both satisfy it. */
export interface FrameSink {
  send(data: Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
}

export interface RelayOptions {
  /**
   * Minimum gap between frames pushed to the client. `streamScreenshot` only
   * emits on change, so this bites during animation, not on an idle screen.
   */
  minFrameIntervalMs?: number | undefined;
  logger?: Logger | undefined;
}

/**
 * Pumps emulator screenshots into a WebSocket until one side goes away.
 *
 * Returns the teardown function. It is safe to call more than once, which
 * matters because both a client close and an upstream error land here.
 *
 * Why a raw binary frame per PNG rather than JSON with base64: the browser
 * turns a Blob straight into an object URL, and base64 would inflate every
 * frame by a third for no gain.
 */
export function relayFrames(
  openStream: OpenFrameStream,
  sink: FrameSink,
  options: RelayOptions = {},
): () => void {
  const log = options.logger ?? noopLogger;
  const minIntervalMs = options.minFrameIntervalMs ?? 0;

  let stream: FrameStream;
  try {
    stream = openStream();
  } catch (error) {
    // A synchronous throw here means the channel could not even be created,
    // so there is nothing to tear down -- report and hand back a no-op.
    log.error("device.stream_open_failed", errorFields(error));
    sink.close(CLOSE_UPSTREAM_FAILED, "emulator unreachable");
    return () => {};
  }

  let closed = false;
  let lastSentAt = 0;
  let framesSent = 0;

  const stop = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    // Cancelling is what releases the emulator-side encoder; letting the
    // socket drop without it leaves the stream running until the process ends.
    try {
      stream.cancel();
    } catch {
      // Already dead upstream; nothing left to release.
    }
  };

  stream.on("data", (frame) => {
    if (closed) {
      return;
    }
    const now = Date.now();
    const tooSoon = minIntervalMs > 0 && now - lastSentAt < minIntervalMs;
    if (tooSoon) {
      return;
    }
    lastSentAt = now;
    framesSent += 1;
    sink.send(frame.image);
  });

  stream.on("error", (error) => {
    if (closed) {
      // grpc-js reports our own cancel() as an error; it is not worth logging.
      return;
    }
    log.error("device.stream_failed", errorFields(error));
    closed = true;
    sink.close(CLOSE_UPSTREAM_FAILED, "emulator stream failed");
  });

  stream.on("end", () => {
    if (closed) {
      return;
    }
    log.info("device.stream_ended", { framesSent });
    closed = true;
    sink.close();
  });

  return stop;
}

interface EmulatorControllerClient {
  getStatus(
    request: Record<string, never>,
    callback: (error: Error | null, response?: RawStatus) => void,
  ): void;
  streamScreenshot(request: { format: string; width: number; height: number }): FrameStream;
  close(): void;
}

interface RawStatus {
  uptime?: string | number;
  booted?: boolean;
  hardwareConfig?: { entry?: { key: string; value: string }[] };
}

export interface DeviceStatus {
  uptimeMs: number | null;
  booted: boolean;
  /** Flattened `hw.*` properties; the Device page reads the LCD dimensions. */
  hardwareConfig: Record<string, string>;
}

/**
 * Thin wrapper over the emulator's EmulatorController service.
 *
 * The proto is loaded at runtime by @grpc/proto-loader rather than compiled to
 * TypeScript: codegen would add a build step to a workspace that is otherwise
 * buildless, and this file touches exactly two of the service's ~50 methods.
 */
export class EmulatorClient {
  readonly #client: EmulatorControllerClient;
  readonly #log: Logger;

  constructor(
    target: string = DEFAULT_EMULATOR_GRPC_TARGET,
    options: { logger?: Logger | undefined; protoPath?: string | undefined } = {},
  ) {
    this.#log = options.logger ?? noopLogger;
    const protoPath =
      options.protoPath ?? join(import.meta.dir, "proto", "emulator_controller.proto");
    const definition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(definition) as unknown as {
      android: {
        emulation: {
          control: {
            EmulatorController: new (
              target: string,
              credentials: grpc.ChannelCredentials,
            ) => EmulatorControllerClient;
          };
        };
      };
    };
    // Insecure by design: the bridge is bound to localhost and started without
    // -grpc-use-token, so there is no credential to present.
    this.#client = new loaded.android.emulation.control.EmulatorController(
      target,
      grpc.credentials.createInsecure(),
    );
  }

  async getStatus(): Promise<DeviceStatus> {
    return await new Promise<DeviceStatus>((resolve, reject) => {
      this.#client.getStatus({}, (error, response) => {
        if (error !== null && error !== undefined) {
          reject(error);
          return;
        }
        resolve(toDeviceStatus(response));
      });
    });
  }

  openFrameStream(
    size: { width?: number | undefined; height?: number | undefined } = {},
  ): FrameStream {
    const width = size.width ?? DEFAULT_FRAME_WIDTH;
    const height = size.height ?? DEFAULT_FRAME_HEIGHT;
    this.#log.info("device.stream_opened", { width, height });
    return this.#client.streamScreenshot({ format: "PNG", width, height });
  }

  close(): void {
    this.#client.close();
  }
}

function toDeviceStatus(response: RawStatus | undefined): DeviceStatus {
  const entries = response?.hardwareConfig?.entry ?? [];
  const hardwareConfig: Record<string, string> = {};
  for (const entry of entries) {
    hardwareConfig[entry.key] = entry.value;
  }
  const uptime = response?.uptime;
  return {
    uptimeMs: uptime === undefined ? null : Number(uptime),
    booted: response?.booted ?? false,
    hardwareConfig,
  };
}
