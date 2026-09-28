import type { ReactNode } from "react";

/**
 * The dashboard's two languages and every string it renders in them.
 *
 * Lives apart from the provider because this half is pure data and decisions,
 * which `bun test` can load without a DOM; the provider reads `navigator` and
 * `localStorage` and writes `document`, which it cannot.
 *
 * Why not an i18n library: two locales and one screen's worth of strings are a
 * typed object each, and a library would bring message catalogues, an ICU
 * parser and a runtime lookup by string key -- the part that loses the
 * compile-time check this file gets for free from `Messages`.
 *
 * What is deliberately absent: anything that arrives from the server or a
 * scenario file (titles, prompts, verdict reasons, model ids, persona text,
 * error messages), and code or paths the reader would type. Those are shown as
 * they are, inside the translated sentence around them.
 */

export type Locale = "en" | "ja";

export const LOCALES: readonly Locale[] = ["en", "ja"];

/**
 * Renders a code span inside a sentence, so a translation can move the path or
 * command to wherever its grammar puts it. The caller's renderer supplies the
 * element (and its key); this file only decides the order.
 */
export type Code = (text: string) => ReactNode;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const en = {
  common: {
    cancel: "Cancel",
    serverDefault: "Server default",
    caseCount: (count: number) => plural(count, "case", "cases"),
  },
  app: {
    openRail: "Open the run rail",
    language: "Display language",
  },
  rail: {
    resize: "Resize the run rail",
    resizeHint: "Drag to resize. Double-click to reset.",
  },
  // Kept identical to the status values in English: the chips said exactly
  // these words before there was a dictionary, and a reader matching them to
  // the CLI's output should keep being able to.
  status: {
    queued: "queued",
    running: "running",
    passed: "passed",
    failed: "failed",
    error: "error",
  },
  // Swipe directions and key names stay as the schema spells them: they are
  // the vocabulary the model was given, and a reader comparing a step to the
  // prompt or the logs needs the same word.
  action: {
    tap: (ref: number) => `tap [${ref}]`,
    inputText: (text: string, ref: number) => `type ${text} into [${ref}]`,
    swipe: (direction: string) => `swipe ${direction}`,
    keyEvent: (key: string) => `press ${key}`,
    wait: (ms: number) => `wait ${ms}ms`,
    remember: (text: string) => `remember ${text}`,
    finish: (verdict: string, reason: string) => `finish ${verdict}: ${reason}`,
  },
  idle: {
    heading: "Device",
    intro:
      "Pick a run from the rail to watch it, or start one there — a scenario with the play button, or a one-off prompt with the model you want.",
  },
  platformPicker: {
    label: "Live view platform",
  },
  liveView: {
    state: {
      connecting: "Connecting",
      live: "Live",
      disconnected: "Disconnected",
      paused: "Paused (off-screen)",
    },
    unreachable: {
      android: "Emulator unreachable",
      web: "Browser unreachable",
    },
    reconnect: "Reconnect",
    androidHelp: (code: Code): ReactNode => [
      "The live view needs the emulator running with its gRPC bridge: ",
      code("just launch-emu"),
      " starts it with ",
      code("-grpc 8554"),
      ". As a fallback, ",
      code("just mirror-screen"),
      " opens the same screen in scrcpy.",
    ],
    webHelp: (code: Code): ReactNode => [
      "The live view needs Chrome running with its DevTools port: ",
      code("just launch-chrome"),
      " opens one. Set ",
      code("CHROME_ENDPOINT"),
      " to reach a browser started some other way.",
    ],
    waitingForFrame: "Waiting for the first frame…",
    pausedOffscreen: "Streaming stops while the view is off-screen.",
    noFrame: "No frame",
    screenAlt: "Emulator screen",
    hint: "Frames arrive only when the screen changes, so a still device shows a static image. The view is read-only.",
  },
  run: {
    back: "Device",
    started: (when: string) => `started ${when}`,
    waitingForDevice: "Waiting for the device. This run starts when the one ahead of it finishes.",
    noCases: "No cases were recorded.",
    liveScreen: "Live screen",
    stepCount: (count: number) => plural(count, "step", "steps"),
    recording: "Recording",
    stepScreenshotAlt: (number: number) => `Step ${number}: after action`,
    noSteps: "No steps yet.",
  },
  uiTree: {
    summary: (lines: number) => `UI tree (${lines} lines)`,
  },
  review: {
    notReviewed: "Visual accessibility: not reviewed.",
    heading: "Visual accessibility",
    failed: "review error",
    completed: (issues: number, personas: number) =>
      `review completed · ${issues} potential issues · ${personas} personas`,
    disclaimer: (model: string) =>
      `Model: ${model}. Suggestions from a screenshot; no conformance guarantee. Screen reader behavior is not evaluated.`,
    openScreenshot: "Open reviewed screenshot (before action)",
    couldNotComplete: (error: string) => `Review could not be completed: ${error}`,
    noIssues: "No potential issues identified. This does not establish accessibility.",
    suggestion: (text: string) => `Suggestion: ${text}`,
    category: {
      color_only: "Color alone",
      contrast: "Contrast",
      text_size: "Text legibility",
      visual_clutter: "Visual clutter",
      other: "Other",
    },
  },
  reviewSettings: {
    legend: "Visual accessibility review",
    intro:
      "Review screenshots for each persona. Findings are suggestions, not a conformance certification. Screen reader behavior is outside this review.",
    useScenarioPersonas: (count: number) => `Use scenario personas (${count})`,
    offInScenario: "Review is off in this scenario.",
    chooseUpTo: (max: number) => `Choose up to ${max} personas. No selection turns review off.`,
    customPersona: "Custom persona",
    personaName: "Persona name *",
    viewingConditions: "Viewing conditions and concerns *",
    removePersonaLabel: (name: string) => `Remove persona ${name}`,
    removePersona: "Remove persona",
    addCustomPersona: "Add custom persona",
  },
  deleteScenario: {
    tooltip: (id: string) => `Delete ${id}`,
    label: (title: string) => `Delete ${title}`,
    heading: (title: string) => `Delete “${title}”?`,
    lede: (code: Code, id: string): ReactNode => [
      "Deletes the file ",
      code(`scenarios/${id}.yaml`),
      ". It is git-managed, so ",
      code(`git checkout scenarios/${id}.yaml`),
      " brings it back. Runs already recorded for this scenario are kept.",
    ],
    deleting: "Deleting…",
    confirm: "Delete scenario",
  },
  builder: {
    editTooltip: (id: string) => `Edit ${id}`,
    editLabel: (title: string) => `Edit ${title}`,
    newScenario: "New scenario",
    editHeading: "Edit scenario",
    ledeEdit: (code: Code, id: string): ReactNode => [
      "Rewrites ",
      code(`scenarios/${id}.yaml`),
      ", which is git-managed — commit the change to keep it.",
    ],
    ledeNew: (code: Code): ReactNode => [
      "Saved as ",
      code("scenarios/<id>.yaml"),
      ", which is git-managed — commit it to keep it. An existing file is never overwritten.",
    ],
    scenarioLegend: "Scenario",
    title: "Title *",
    titleRequired: "A title is required.",
    tags: "Tags",
    tagsHint:
      "Comma-separated, lowercase letters, digits and hyphens. Used to filter the list and to pick a batch to run.",
    tagsInvalid: "Use lowercase letters, digits and hyphens, separated by commas.",
    fileName: "File name",
    fileNameFixed: "The file name is the id, so it cannot be changed here.",
    fileNameHint: "Lowercase letters, digits and hyphens. Becomes scenarios/<id>.yaml.",
    fileNameInvalid: "Use lowercase letters, digits and hyphens, e.g. “checkout-flow”.",
    platform: "Platform",
    appPackage: "App package",
    activity: "Activity",
    url: "URL",
    defaultModel: "Default model",
    caseLegend: (number: number) => `Case ${number}`,
    removeCase: "Remove",
    caseId: "Case id *",
    caseIdInvalid: "Use lowercase letters, digits and hyphens.",
    caseTitle: "Case title",
    prompt: "Prompt *",
    promptHint: "What the agent should check, in plain language.",
    promptRequired: "A prompt is required.",
    model: "Model",
    scenarioDefault: "Scenario default",
    maxSteps: "Max steps",
    addCase: "Add case",
    saving: "Saving…",
    saveChanges: "Save changes",
    saveScenario: "Save scenario",
  },
  sidebar: {
    scenarios: "Scenarios",
    noScenarios: "No scenarios in scenarios/.",
    tagFilter: "Filter scenarios by tag",
    noTagMatch: "No scenarios match these tags.",
    clearTagFilter: "Clear tag filter",
    selectForBatch: (title: string) => `Select ${title} for a batch run`,
    defaultModel: "default model",
    maxSteps: (count: number) => `max ${count}`,
    runTooltip: (id: string) => `Run ${id}`,
    runLabel: (title: string) => `Run ${title}`,
    runSelected: (count: number) => `Run ${count} selected`,
    adHoc: "Ad-hoc run",
    titleOptional: "Title (optional)",
    model: "Model",
    modelHint: "Leave on the server default to use LLM_MODEL.",
    prompt: "Prompt",
    promptPlaceholder: "Check that the user can log in with demo@example.com …",
    runPrompt: "Run prompt",
    recentRuns: "Recent runs",
    noRuns: "No runs yet.",
  },
};

/** The shape both languages share; `ja` is checked against it key by key. */
export type Messages = typeof en;

// Annotated rather than inferred, so a key missing here -- or one left over
// after English dropped it -- fails the typecheck instead of rendering blank.
const ja: Messages = {
  common: {
    cancel: "キャンセル",
    serverDefault: "サーバーの既定",
    caseCount: (count) => `${count} ケース`,
  },
  app: {
    openRail: "サイドバーを開く",
    language: "表示言語",
  },
  rail: {
    resize: "サイドバーの幅を変更",
    resizeHint: "ドラッグで幅を変更、ダブルクリックで元に戻します。",
  },
  status: {
    queued: "待機中",
    running: "実行中",
    passed: "成功",
    failed: "失敗",
    error: "エラー",
  },
  action: {
    tap: (ref) => `タップ [${ref}]`,
    inputText: (text, ref) => `[${ref}] に ${text} を入力`,
    swipe: (direction) => `スワイプ ${direction}`,
    keyEvent: (key) => `キー ${key} を押す`,
    wait: (ms) => `${ms}ms 待機`,
    remember: (text) => `${text} を記憶`,
    finish: (verdict, reason) => `終了（${verdict}）: ${reason}`,
  },
  idle: {
    heading: "デバイス",
    intro:
      "サイドバーで実行を選ぶと、その様子を確認できます。新しく始めるには、シナリオの再生ボタンを押すか、モデルを選んで単発のプロンプトを実行してください。",
  },
  platformPicker: {
    label: "ライブビューのプラットフォーム",
  },
  liveView: {
    state: {
      connecting: "接続中",
      live: "ライブ",
      disconnected: "切断",
      paused: "一時停止（画面外）",
    },
    unreachable: {
      android: "エミュレーターに接続できません",
      web: "ブラウザに接続できません",
    },
    reconnect: "再接続",
    androidHelp: (code) => [
      "ライブビューには gRPC ブリッジ付きで起動したエミュレーターが必要です。",
      code("just launch-emu"),
      " は ",
      code("-grpc 8554"),
      " 付きで起動します。代わりに ",
      code("just mirror-screen"),
      " を使うと、同じ画面を scrcpy で開けます。",
    ],
    webHelp: (code) => [
      "ライブビューには DevTools ポートを開いた Chrome が必要です。",
      code("just launch-chrome"),
      " で起動できます。別の方法で起動したブラウザにつなぐには ",
      code("CHROME_ENDPOINT"),
      " を設定してください。",
    ],
    waitingForFrame: "最初のフレームを待っています…",
    pausedOffscreen: "画面外にある間は配信を止めています。",
    noFrame: "フレームなし",
    screenAlt: "エミュレーターの画面",
    hint: "フレームは画面が変わったときだけ届くため、動きのないデバイスは静止画のままです。表示専用で、操作はできません。",
  },
  run: {
    back: "デバイス",
    started: (when) => `開始 ${when}`,
    waitingForDevice: "デバイスの空きを待っています。前の実行が終わると開始します。",
    noCases: "記録されたケースはありません。",
    liveScreen: "ライブ画面",
    stepCount: (count) => `${count} ステップ`,
    recording: "録画",
    stepScreenshotAlt: (number) => `ステップ ${number}: 操作後`,
    noSteps: "まだステップはありません。",
  },
  uiTree: {
    summary: (lines) => `UI ツリー（${lines} 行）`,
  },
  review: {
    notReviewed: "視覚的アクセシビリティ: 未レビュー",
    heading: "視覚的アクセシビリティ",
    failed: "レビューエラー",
    completed: (issues, personas) =>
      `レビュー完了 · 問題の可能性 ${issues} 件 · ペルソナ ${personas} 人`,
    disclaimer: (model) =>
      `モデル: ${model}。スクリーンショットからの提案であり、適合を保証するものではありません。スクリーンリーダーの挙動は評価していません。`,
    openScreenshot: "レビューしたスクリーンショットを開く（操作前）",
    couldNotComplete: (error) => `レビューを完了できませんでした: ${error}`,
    noIssues:
      "問題の可能性は見つかりませんでした。アクセシビリティが確保されていることを示すものではありません。",
    suggestion: (text) => `提案: ${text}`,
    category: {
      color_only: "色だけに頼った表現",
      contrast: "コントラスト",
      text_size: "文字の読みやすさ",
      visual_clutter: "視覚的な煩雑さ",
      other: "その他",
    },
  },
  reviewSettings: {
    legend: "視覚的アクセシビリティのレビュー",
    intro:
      "ペルソナごとにスクリーンショットをレビューします。指摘は提案であり、適合を認証するものではありません。スクリーンリーダーの挙動はレビューの対象外です。",
    useScenarioPersonas: (count) => `シナリオのペルソナを使う（${count}）`,
    offInScenario: "このシナリオではレビューはオフです。",
    chooseUpTo: (max) =>
      `ペルソナは ${max} 人まで選べます。何も選ばなければレビューはオフになります。`,
    customPersona: "カスタムペルソナ",
    personaName: "ペルソナ名 *",
    viewingConditions: "見え方の条件と懸念 *",
    removePersonaLabel: (name) => `ペルソナ「${name}」を削除`,
    removePersona: "ペルソナを削除",
    addCustomPersona: "カスタムペルソナを追加",
  },
  deleteScenario: {
    tooltip: (id) => `${id} を削除`,
    label: (title) => `「${title}」を削除`,
    heading: (title) => `「${title}」を削除しますか？`,
    lede: (code, id) => [
      "ファイル ",
      code(`scenarios/${id}.yaml`),
      " を削除します。git で管理しているので、",
      code(`git checkout scenarios/${id}.yaml`),
      " で元に戻せます。このシナリオで記録済みの実行は残ります。",
    ],
    deleting: "削除中…",
    confirm: "シナリオを削除",
  },
  builder: {
    editTooltip: (id) => `${id} を編集`,
    editLabel: (title) => `「${title}」を編集`,
    newScenario: "新しいシナリオ",
    editHeading: "シナリオを編集",
    ledeEdit: (code, id) => [
      code(`scenarios/${id}.yaml`),
      " を書き換えます。git で管理しているため、変更を残すにはコミットしてください。",
    ],
    ledeNew: (code) => [
      code("scenarios/<id>.yaml"),
      " として保存します。git で管理しているため、残すにはコミットしてください。既存のファイルは上書きしません。",
    ],
    scenarioLegend: "シナリオ",
    title: "タイトル *",
    titleRequired: "タイトルを入力してください。",
    tags: "タグ",
    tagsHint:
      "カンマ区切りで、英小文字・数字・ハイフンが使えます。一覧の絞り込みや、まとめて実行する対象の選択に使います。",
    tagsInvalid: "英小文字・数字・ハイフンをカンマで区切って入力してください。",
    fileName: "ファイル名",
    fileNameFixed: "ファイル名は ID を兼ねるため、ここでは変更できません。",
    fileNameHint: "英小文字・数字・ハイフンが使えます。scenarios/<id>.yaml になります。",
    fileNameInvalid: "英小文字・数字・ハイフンで入力してください（例:「checkout-flow」）。",
    platform: "プラットフォーム",
    appPackage: "アプリのパッケージ",
    activity: "アクティビティ",
    url: "URL",
    defaultModel: "既定のモデル",
    caseLegend: (number) => `ケース ${number}`,
    removeCase: "削除",
    caseId: "ケース ID *",
    caseIdInvalid: "英小文字・数字・ハイフンで入力してください。",
    caseTitle: "ケースのタイトル",
    prompt: "プロンプト *",
    promptHint: "エージェントに確認させたいことを、ふだんの言葉で書いてください。",
    promptRequired: "プロンプトを入力してください。",
    model: "モデル",
    scenarioDefault: "シナリオの既定",
    maxSteps: "最大ステップ数",
    addCase: "ケースを追加",
    saving: "保存中…",
    saveChanges: "変更を保存",
    saveScenario: "シナリオを保存",
  },
  sidebar: {
    scenarios: "シナリオ",
    noScenarios: "scenarios/ にシナリオがありません。",
    tagFilter: "タグでシナリオを絞り込む",
    noTagMatch: "これらのタグに一致するシナリオはありません。",
    clearTagFilter: "タグの絞り込みを解除",
    selectForBatch: (title) => `「${title}」をまとめて実行する対象に選ぶ`,
    defaultModel: "既定のモデル",
    maxSteps: (count) => `最大 ${count}`,
    runTooltip: (id) => `${id} を実行`,
    runLabel: (title) => `「${title}」を実行`,
    runSelected: (count) => `選択した ${count} 件を実行`,
    adHoc: "単発の実行",
    titleOptional: "タイトル（任意）",
    model: "モデル",
    modelHint: "サーバーの既定のままにすると LLM_MODEL を使います。",
    prompt: "プロンプト",
    promptPlaceholder: "demo@example.com でログインできることを確認する …",
    runPrompt: "プロンプトを実行",
    recentRuns: "最近の実行",
    noRuns: "まだ実行はありません。",
  },
};

const MESSAGES: Record<Locale, Messages> = { en, ja };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** The stored value if it names a language this file has, otherwise null. */
export function parseLocale(value: string | null | undefined): Locale | null {
  const isKnown = value === "en" || value === "ja";
  return isKnown ? value : null;
}

/**
 * The language a browser reporting `language` should start in.
 *
 * Only Japanese is matched, by prefix so `ja-JP` counts; every other language,
 * and no language at all (`bun test` has no `navigator`), falls back to
 * English, which is the one every string here was written in first.
 */
export function localeFromLanguage(language: string | null | undefined): Locale {
  const isJapanese = language?.toLowerCase().startsWith("ja") ?? false;
  return isJapanese ? "ja" : "en";
}

/**
 * The language to open with: an explicit earlier choice beats the browser's,
 * because someone who switched away from their browser language did it on
 * purpose and should not have to do it again on every visit.
 */
export function initialLocale(
  stored: string | null | undefined,
  language: string | null | undefined,
): Locale {
  return parseLocale(stored) ?? localeFromLanguage(language);
}

/**
 * Date and time in the chosen language's conventions.
 *
 * The locale is passed explicitly rather than left to the browser default:
 * a Japanese browser switched to English would otherwise keep showing
 * Japanese dates beside English labels, and the reverse.
 */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale);
}

export function formatTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(locale);
}
