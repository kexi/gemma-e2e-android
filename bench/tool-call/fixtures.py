# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""gemma-e2e-android の decide 1 回分を LM Studio に直接投げ、tool call の安定性を測る。

tools.json は題材の actionTools() / SYSTEM_PROMPT から書き出したもの（README 参照）。
ツール定義と tool_choice: "required" は題材と同じ。
temperature: 0 はベンチ側で固定する（本番Genkit経路では明示していない）。

Genkit を経由しないのは、ここで知りたいのが「モデル + ランタイムが tool_calls を
正しく返すか」で、Genkit 側の変換は題材のユニットテストが既に押さえているため。
"""

import json
import pathlib

HERE = pathlib.Path(__file__).parent
SPEC = json.loads((HERE / "tools.json").read_text())


def build_prompt(goal: str, history: str, screen: str, facts: list[str]) -> str:
    """題材 llm.ts の buildDecisionPrompt と同じ組み立て。"""
    fact_lines = ["# Remembered facts", *[f"- {f}" for f in facts], ""] if facts else []
    return "\n".join(
        [
            "# Goal",
            goal,
            "",
            *fact_lines,
            "# Steps so far",
            history or "(nothing yet - this is the first step)",
            "",
            "# Current screen",
            screen,
            "",
            "Choose the next action.",
        ]
    )


def long_settings_screen() -> str:
    """実運用に近い長さの画面。目的の項目を末尾近くに置く。"""
    labels = [f"Setting item {i}" for i in range(60)]
    labels[47] = "Developer options"
    rows = ['TextView text="Settings"']
    rows += [f'[{i}] Button text="{label}"' for i, label in enumerate(labels)]
    return "\n".join(rows)


# expect: 正解とみなす (tool 名, 引数の判定) の組。判定は引数 dict を受ける。
CASES = [
    {
        "id": "tap",
        "goal": "Open the Settings screen.",
        "screen": '[0] Button text="Home"\n[1] Button text="Settings"\n[2] Button text="Profile"',
        "expect": [("tap", lambda a: a.get("ref") == 1)],
    },
    {
        "id": "input_text",
        "goal": "Log in with the email user@example.com and the password hunter2.",
        "history": "1. tap ref=0 (Email field)",
        "screen": '[0] EditText desc="Email" editable focused\n[1] EditText desc="Password" editable\n[2] Button text="Log in"',
        "expect": [
            (
                "input_text",
                lambda a: a.get("ref") == 0 and a.get("text") == "user@example.com",
            )
        ],
    },
    {
        "id": "finish_passed",
        "goal": "Log in with the email user@example.com and the password hunter2.",
        "history": "1. input_text ref=0 user@example.com\n2. input_text ref=1 hunter2\n3. tap ref=2 (Log in)",
        "screen": 'TextView text="Welcome back, user@example.com"\n[0] Button text="Log out"',
        "expect": [
            ("finish", lambda a: a.get("verdict") == "passed" and bool(a.get("reason")))
        ],
    },
    {
        "id": "finish_failed",
        "goal": "Log in with the email user@example.com and the password hunter2.",
        "history": "1. tap ref=2 (Log in)\n2. tap ref=2 (Log in)\n3. tap ref=2 (Log in)\n(warning: the screen did not change after the last 3 actions)",
        "screen": 'TextView text="This account is locked. Contact support."',
        "expect": [
            ("finish", lambda a: a.get("verdict") == "failed" and bool(a.get("reason")))
        ],
    },
    {
        "id": "remember",
        "goal": "Buy one coffee, then open the order history and confirm the order number shown after purchase appears there.",
        "history": "1. tap ref=0 (Coffee)\n2. tap ref=3 (Buy)",
        "screen": 'TextView text="Thank you!"\nTextView text="Order number: A1B2C3"\n[0] Button text="Order history"',
        "expect": [("remember", lambda a: "A1B2C3" in str(a.get("text", "")))],
    },
    {
        "id": "wait",
        "goal": "Open the Settings screen.",
        "history": "1. tap ref=1 (Settings)",
        "screen": 'ProgressBar desc="Loading"\nTextView text="Loading..."',
        "expect": [("wait", lambda a: isinstance(a.get("ms"), int) and a["ms"] > 0)],
    },
    {
        "id": "swipe",
        "goal": "Open Privacy in the settings list.",
        "screen": 'TextView text="Settings"\n[0] Button text="Network"\n[1] Button text="Display"\n[2] Button text="Sound"\nTextView text="Scroll for more"',
        "expect": [("swipe", lambda a: a.get("direction") == "up")],
    },
    {
        "id": "key_back",
        "goal": "Go back to the list of articles.",
        "history": "1. tap ref=4 (Article: Gemma 4 released)",
        "screen": 'TextView text="Gemma 4 released"\nTextView text="Google today announced..."',
        "expect": [("key_event", lambda a: a.get("key") == "back")],
    },
    {
        "id": "long_screen",
        "goal": "Open Developer options.",
        "screen": long_settings_screen(),
        "expect": [("tap", lambda a: a.get("ref") == 47)],
    },
]


def schema_errors(name: str, args: dict) -> list[str]:
    """tools.json の JSON Schema のうち、題材が使う範囲（required / type / enum / minimum）だけ検証する。"""
    tool = next(
        (t["function"] for t in SPEC["tools"] if t["function"]["name"] == name), None
    )
    if tool is None:
        return [f"unknown tool {name}"]
    params = tool["parameters"]
    errors = [f"missing {k}" for k in params.get("required", []) if k not in args]
    for key, prop in params["properties"].items():
        if key not in args:
            continue
        value = args[key]
        kind = prop.get("type")
        is_wrong_int = kind == "integer" and (
            not isinstance(value, int) or isinstance(value, bool)
        )
        is_wrong_str = kind == "string" and not isinstance(value, str)
        if is_wrong_int or is_wrong_str:
            errors.append(f"{key}: expected {kind}, got {value!r}")
            continue
        if "enum" in prop and value not in prop["enum"]:
            errors.append(f"{key}: {value!r} not in {prop['enum']}")
        if "minimum" in prop and value < prop["minimum"]:
            errors.append(f"{key}: {value} < {prop['minimum']}")
        if "exclusiveMinimum" in prop and value <= prop["exclusiveMinimum"]:
            errors.append(f"{key}: {value} <= {prop['exclusiveMinimum']}")
        if "minLength" in prop and len(value) < prop["minLength"]:
            errors.append(f"{key}: shorter than {prop['minLength']}")
    return errors
