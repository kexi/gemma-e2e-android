import { describe, expect, test } from "bun:test";
import type { Run, Scenario } from "@gemma-e2e/core/schema";
import {
  colored,
  describeAction,
  plain,
  renderDevice,
  renderEvent,
  renderModels,
  renderRun,
  renderRunList,
  renderScenario,
  renderScenarioList,
  statusColor,
  styleFor,
  table,
} from "./render.ts";

const SCENARIO: Scenario = {
  id: "login",
  title: "Login",
  cases: [
    { id: "valid", title: "Logs in", prompt: "log in", maxSteps: 20 },
    { id: "invalid", prompt: "reject a wrong password", maxSteps: 20 },
  ],
};

const RUN: Run = {
  id: "run-1",
  scenarioId: "login",
  title: "Login",
  status: "failed",
  verdictReason: "one case failed",
  startedAt: "2026-08-02T10:00:00.000Z",
  finishedAt: "2026-08-02T10:01:00.000Z",
  cases: [
    {
      runId: "run-1",
      caseId: "valid",
      order: 0,
      title: "Logs in",
      prompt: "log in",
      model: "gemma-4-26b",
      status: "failed",
      verdictReason: "no login button",
      startedAt: "2026-08-02T10:00:00.000Z",
      finishedAt: "2026-08-02T10:01:00.000Z",
      videoPath: null,
      steps: [
        {
          runId: "run-1",
          caseId: "valid",
          index: 0,
          action: { type: "tap", ref: 3 },
          uiText: "",
          screenshotPath: null,
          note: null,
          createdAt: "2026-08-02T10:00:01.000Z",
        },
      ],
    },
  ],
};

describe("styleFor", () => {
  test("colours output on a TTY with no suppressing signal", () => {
    expect(styleFor({ noColor: false, isTty: true, env: {} })).toBe(colored);
  });

  test("drops colour when --no-color is passed", () => {
    expect(styleFor({ noColor: true, isTty: true, env: {} })).toBe(plain);
  });

  test("drops colour when output is not a TTY", () => {
    expect(styleFor({ noColor: false, isTty: false, env: {} })).toBe(plain);
  });

  test("drops colour when NO_COLOR is set to any value, including empty", () => {
    expect(styleFor({ noColor: false, isTty: true, env: { NO_COLOR: "" } })).toBe(plain);
    expect(styleFor({ noColor: false, isTty: true, env: { NO_COLOR: "1" } })).toBe(plain);
  });
});

describe("statusColor", () => {
  test("maps each run status to its own colour", () => {
    expect(statusColor("passed")).toBe("green");
    expect(statusColor("failed")).toBe("red");
    expect(statusColor("running")).toBe("cyan");
    expect(statusColor("error")).toBe("yellow");
  });
});

describe("table", () => {
  test("pads every column to its widest cell", () => {
    expect(
      table([
        ["id", "title"],
        ["a-very-long-id", "x"],
      ]),
    ).toBe("id              title\na-very-long-id  x");
  });

  test("leaves no trailing whitespace on a row whose last cell is empty", () => {
    expect(
      table([
        ["a", "bbb"],
        ["c", ""],
      ]),
    ).toBe("a  bbb\nc");
  });

  test("renders nothing for no rows", () => {
    expect(table([])).toBe("");
  });
});

describe("renderScenarioList", () => {
  test("lists each scenario with its case count and model", () => {
    expect(renderScenarioList([SCENARIO], plain)).toBe(
      ["ID     TITLE  CASES  MODEL", "login  Login  2      -"].join("\n"),
    );
  });

  test("says so when there are no scenarios", () => {
    expect(renderScenarioList([], plain)).toBe("No scenarios.");
  });
});

describe("renderScenario", () => {
  test("shows the scenario's fields and every case, titled or not", () => {
    const output = renderScenario(SCENARIO, plain);

    expect(output).toContain("id     login");
    expect(output).toContain("title  Login");
    expect(output).toContain("cases (2)");
    expect(output).toContain("valid  Logs in");
    expect(output).toContain("invalid  reject a wrong password");
  });

  test("shows the app target and model only when the scenario names them", () => {
    const withApp = renderScenario(
      { ...SCENARIO, app: { package: "com.example", activity: ".Main" }, model: "gemma" },
      plain,
    );

    expect(withApp).toContain("app    com.example/.Main");
    expect(withApp).toContain("model  gemma");
    expect(renderScenario(SCENARIO, plain)).not.toContain("app  ");
  });
});

describe("renderRunList", () => {
  test("lists each run with its status", () => {
    expect(renderRunList([RUN], plain)).toBe(
      [
        "RUN ID  SCENARIO  STATUS  STARTED",
        "run-1   login     failed  2026-08-02T10:00:00.000Z",
      ].join("\n"),
    );
  });

  test("says so when there are no runs", () => {
    expect(renderRunList([], plain)).toBe("No runs.");
  });
});

describe("renderRun", () => {
  test("shows the run's verdict, its cases, and each case's steps", () => {
    const output = renderRun(RUN, plain);

    expect(output).toContain("run       run-1");
    expect(output).toContain("status    failed");
    expect(output).toContain("reason    one case failed");
    expect(output).toContain("failed  valid  Logs in");
    expect(output).toContain("reason  no login button");
    expect(output).toContain("  0  tap [3]");
  });
});

describe("describeAction", () => {
  test("renders every action variant on one line", () => {
    expect(describeAction({ type: "tap", ref: 3 })).toBe("tap [3]");
    expect(describeAction({ type: "input_text", ref: 1, text: "hi" })).toBe('input_text [1] "hi"');
    expect(describeAction({ type: "swipe", direction: "up" })).toBe("swipe up");
    expect(describeAction({ type: "key_event", key: "back" })).toBe("key_event back");
    expect(describeAction({ type: "wait", ms: 500 })).toBe("wait 500ms");
    expect(describeAction({ type: "remember", text: "code 42" })).toBe('remember "code 42"');
    expect(describeAction({ type: "finish", verdict: "passed", reason: "logged in" })).toBe(
      "finish passed: logged in",
    );
  });
});

describe("renderEvent", () => {
  test("renders the events a watcher should see", () => {
    expect(renderEvent({ type: "run_started", runId: "r", scenario: SCENARIO }, plain)).toBe(
      "run  Login (2 cases)",
    );

    expect(
      renderEvent(
        {
          type: "action_decided",
          runId: "r",
          caseId: "valid",
          index: 2,
          action: { type: "tap", ref: 7 },
          llmDurationMs: 830,
        },
        plain,
      ),
    ).toBe("    2  tap [7] (830ms)");

    expect(
      renderEvent(
        {
          type: "case_finished",
          runId: "r",
          caseId: "valid",
          status: "passed",
          reason: "logged in",
          videoPath: null,
        },
        plain,
      ),
    ).toBe("passed  valid  logged in");

    expect(
      renderEvent({ type: "run_finished", runId: "run-1", status: "failed", reason: null }, plain),
    ).toBe("failed  run run-1");
  });

  test("suppresses the events that would flood the terminal or repeat themselves", () => {
    const suppressed = [
      { type: "ui_captured", runId: "r", caseId: "c", index: 0, uiText: "<huge tree>" },
      { type: "step_started", runId: "r", caseId: "c", index: 0 },
      {
        type: "action_executed",
        runId: "r",
        caseId: "c",
        index: 0,
        action: { type: "tap", ref: 1 },
      },
    ] as const;

    for (const event of suppressed) {
      expect(renderEvent(event, plain)).toBeNull();
    }
  });
});

describe("renderModels", () => {
  test("lists one model id per line", () => {
    expect(renderModels([{ id: "gemma-4-26b" }, { id: "gemma-4-e4b" }])).toBe(
      "gemma-4-26b\ngemma-4-e4b",
    );
  });

  test("says so when the endpoint serves no models", () => {
    expect(renderModels([])).toBe("No models.");
  });
});

describe("renderDevice", () => {
  test("shows boot state, uptime in seconds, and the hardware config", () => {
    const output = renderDevice(
      { booted: true, uptimeMs: 42_000, hardwareConfig: { "hw.lcd.width": "1080" } },
      plain,
    );

    expect(output).toContain("booted  true");
    expect(output).toContain("uptime  42s");
    expect(output).toContain("hw.lcd.width  1080");
  });

  test("shows a dash when the emulator reports no uptime", () => {
    const output = renderDevice({ booted: false, uptimeMs: null, hardwareConfig: {} }, plain);

    expect(output).toContain("uptime  -");
    expect(output).not.toContain("hardware");
  });
});
