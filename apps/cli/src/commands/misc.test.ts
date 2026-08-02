import { describe, expect, test } from "bun:test";
import { deviceCommand, modelsCommand } from "./misc.ts";
import { captureContext, withServer } from "../testing.ts";
import { UsageError } from "../usage.ts";

describe("models", () => {
  test("lists one model id per line", async () => {
    await withServer(
      () => Response.json({ models: [{ id: "gemma-4-26b" }, { id: "gemma-4-e4b" }] }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await modelsCommand([], context)).toBe(0);
        expect(out).toEqual(["gemma-4-26b\ngemma-4-e4b"]);
      },
    );
  });

  test("prints the raw listing when --json is given", async () => {
    await withServer(
      () => Response.json({ models: [{ id: "gemma-4-26b" }] }),
      async (client) => {
        const { context, out } = captureContext(client, { json: true });

        await modelsCommand(["--json"], context);

        expect(JSON.parse(out[0] ?? "")).toEqual([{ id: "gemma-4-26b" }]);
      },
    );
  });

  test("surfaces the server's message when the LLM endpoint is unreachable", async () => {
    await withServer(
      () => Response.json({ error: "no model endpoint configured" }, { status: 503 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(modelsCommand([], context)).rejects.toThrow("no model endpoint configured");
      },
    );
  });

  test("rejects an operand", async () => {
    await withServer(
      () => Response.json({ models: [] }),
      async (client) => {
        const { context } = captureContext(client);

        expect(modelsCommand(["extra"], context)).rejects.toBeInstanceOf(UsageError);
      },
    );
  });
});

describe("device", () => {
  test("shows the emulator's boot state and hardware config", async () => {
    await withServer(
      () =>
        Response.json({
          device: { booted: true, uptimeMs: 42_000, hardwareConfig: { "hw.lcd.width": "1080" } },
        }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await deviceCommand([], context)).toBe(0);
        expect(out.join("\n")).toContain("booted  true");
        expect(out.join("\n")).toContain("hw.lcd.width  1080");
      },
    );
  });

  test("surfaces the server's message when no emulator is attached", async () => {
    await withServer(
      () => Response.json({ error: "emulator is not running" }, { status: 503 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(deviceCommand([], context)).rejects.toThrow("emulator is not running");
      },
    );
  });
});
