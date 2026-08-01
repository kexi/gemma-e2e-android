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

/** The shortest file the loader accepts: a title and one case. */
const MINIMAL = ["title: Checkout", "cases:", "  - id: buys", "    prompt: buy something"].join(
  "\n",
);

describe("loadScenario", () => {
  test("loads a scenario with its app, model, and cases", async () => {
    const path = await write(
      "login.yaml",
      [
        "id: login-happy",
        "title: Login",
        "app:",
        "  package: com.example.app",
        "  activity: .MainActivity",
        "model: scenario-model",
        "cases:",
        "  - id: valid",
        "    title: Logs in",
        "    prompt: check that the user can log in",
        "    model: case-model",
        "    maxSteps: 8",
        "  - id: invalid",
        "    prompt: check that a wrong password is rejected",
      ].join("\n"),
    );

    const scenario = await loadScenario(path);

    expect(scenario.id).toBe("login-happy");
    expect(scenario.title).toBe("Login");
    expect(scenario.app?.package).toBe("com.example.app");
    expect(scenario.model).toBe("scenario-model");
    expect(scenario.cases).toHaveLength(2);
    expect(scenario.cases[0]?.title).toBe("Logs in");
    expect(scenario.cases[0]?.model).toBe("case-model");
    expect(scenario.cases[0]?.maxSteps).toBe(8);
  });

  test("falls back to the filename for id and defaults each case's maxSteps", async () => {
    const path = await write("checkout.yml", MINIMAL);

    const scenario = await loadScenario(path);

    expect(scenario.id).toBe("checkout");
    expect(scenario.cases[0]?.maxSteps).toBe(20);
    expect(scenario.app).toBeUndefined();
    expect(scenario.model).toBeUndefined();
    expect(scenario.cases[0]?.model).toBeUndefined();
  });

  test("rejects a scenario with no cases at all", async () => {
    const path = await write("bad.yaml", "title: No cases\ncases: []");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects a scenario missing the cases key", async () => {
    const path = await write("bad.yaml", "title: No cases");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects a case missing a prompt", async () => {
    const path = await write("bad.yaml", "title: T\ncases:\n  - id: a");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects a case id that is not a slug", async () => {
    const path = await write("bad.yaml", "title: T\ncases:\n  - id: Not A Slug\n    prompt: p");
    await expect(loadScenario(path)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("rejects duplicate case ids within one scenario", async () => {
    const path = await write(
      "dupe.yaml",
      ["title: T", "cases:", "  - id: same", "    prompt: a", "  - id: same", "    prompt: b"].join(
        "\n",
      ),
    );

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
    await write("b.yaml", "title: B\ncases:\n  - id: b\n    prompt: do b");
    await write("a.yml", "title: A\ncases:\n  - id: a\n    prompt: do a");
    await write("notes.md", "not a scenario");

    const scenarios = await loadScenariosDir(dir);

    expect(scenarios.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("rejects duplicate scenario ids across files", async () => {
    await write("one.yaml", "id: same\ntitle: A\ncases:\n  - id: a\n    prompt: do a");
    await write("two.yaml", "id: same\ntitle: B\ncases:\n  - id: b\n    prompt: do b");

    await expect(loadScenariosDir(dir)).rejects.toBeInstanceOf(ScenarioLoadError);
  });

  test("allows the same case id in different scenarios", async () => {
    await write("one.yaml", "title: A\ncases:\n  - id: shared\n    prompt: do a");
    await write("two.yaml", "title: B\ncases:\n  - id: shared\n    prompt: do b");

    const scenarios = await loadScenariosDir(dir);

    expect(scenarios.map((s) => s.cases[0]?.id)).toEqual(["shared", "shared"]);
  });

  test("returns an empty list for a directory with no scenarios", async () => {
    expect(await loadScenariosDir(dir)).toEqual([]);
  });

  test("rejects a missing directory", async () => {
    await expect(loadScenariosDir(join(dir, "nope"))).rejects.toBeInstanceOf(ScenarioLoadError);
  });
});
