import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario, loadScenariosDir, ScenarioLoadError } from "./scenario.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gemma-scenario-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  return path;
}

describe("loadScenario", () => {
  test("loads a full scenario", async () => {
    const path = await write(
      "login.yaml",
      [
        "id: login-happy",
        "title: Login",
        "prompt: check that the user can log in",
        "app:",
        "  package: com.example.app",
        "  activity: .MainActivity",
        "maxSteps: 8",
      ].join("\n"),
    );

    const scenario = await loadScenario(path);

    expect(scenario.id).toBe("login-happy");
    expect(scenario.title).toBe("Login");
    expect(scenario.app?.package).toBe("com.example.app");
    expect(scenario.maxSteps).toBe(8);
  });

  test("falls back to the filename for id and defaults maxSteps", async () => {
    const path = await write(
      "checkout.yml",
      ["title: Checkout", "prompt: buy something"].join("\n"),
    );

    const scenario = await loadScenario(path);

    expect(scenario.id).toBe("checkout");
    expect(scenario.maxSteps).toBe(20);
    expect(scenario.app).toBeUndefined();
  });

  test("rejects a scenario missing a prompt", async () => {
    const path = await write("bad.yaml", "title: No prompt");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects malformed YAML", async () => {
    const path = await write("broken.yaml", "title: [unclosed");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects a top-level sequence", async () => {
    const path = await write("list.yaml", "- one\n- two");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects a missing file", async () => {
    await expect(loadScenario(join(dir, "absent.yaml"))).rejects.toBeInstanceOf(ScenarioLoadError);
  });
});

describe("loadScenariosDir", () => {
  test("loads yaml and yml sorted by filename, ignoring other files", async () => {
    await write("b.yaml", "title: B\nprompt: do b");
    await write("a.yml", "title: A\nprompt: do a");
    await write("notes.md", "not a scenario");

    const scenarios = await loadScenariosDir(dir);

    expect(scenarios.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("rejects duplicate ids across files", async () => {
    await write("one.yaml", "id: same\ntitle: A\nprompt: do a");
    await write("two.yaml", "id: same\ntitle: B\nprompt: do b");

    await expect(loadScenariosDir(dir)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("returns an empty list for a directory with no scenarios", async () => {
    expect(await loadScenariosDir(dir)).toEqual([]);
  });

  test("rejects a missing directory", async () => {
    await expect(loadScenariosDir(join(dir, "nope"))).rejects.toBeInstanceOf(ScenarioLoadError);
  });
});
