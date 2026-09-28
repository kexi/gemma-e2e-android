import { describe, expect, test } from "bun:test";
import { failureLabelFor } from "./devicePlatform.ts";
import { initialLocale, LOCALES, localeFromLanguage, messagesFor, parseLocale } from "./i18n.ts";

/**
 * Only the pure half is tested: the provider needs a DOM and a testing library
 * this app does not carry, and which language a reader lands in is decided
 * entirely here.
 */
describe("localeFromLanguage", () => {
  test("starts a Japanese browser in Japanese, whatever its region", () => {
    expect(localeFromLanguage("ja")).toBe("ja");
    expect(localeFromLanguage("ja-JP")).toBe("ja");
    expect(localeFromLanguage("JA-jp")).toBe("ja");
  });

  test("starts every other browser in English", () => {
    expect(localeFromLanguage("en-US")).toBe("en");
    expect(localeFromLanguage("fr")).toBe("en");
    // "jv" (Javanese) shares the first letter, not the language.
    expect(localeFromLanguage("jv")).toBe("en");
  });

  test("falls back to English when there is no browser language, as under bun test", () => {
    expect(localeFromLanguage(undefined)).toBe("en");
    expect(localeFromLanguage(null)).toBe("en");
    expect(localeFromLanguage("")).toBe("en");
  });
});

describe("initialLocale", () => {
  test("keeps a language the reader chose over the browser's", () => {
    expect(initialLocale("en", "ja-JP")).toBe("en");
    expect(initialLocale("ja", "en-US")).toBe("ja");
  });

  test("ignores a stored value it does not know and follows the browser", () => {
    // Storage outlives deployments and can be edited by hand; a stale or
    // garbled value must not leave the dashboard without a language.
    expect(initialLocale("de", "ja-JP")).toBe("ja");
    expect(initialLocale(null, "en-GB")).toBe("en");
  });
});

describe("parseLocale", () => {
  test("accepts only the languages the dictionary has", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("ja")).toBe("ja");
    expect(parseLocale("ja-JP")).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });
});

/** Every leaf in a message tree, keyed by its dotted path. */
function leavesOf(tree: object, prefix = ""): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, value]): [string, unknown][] => {
    const path = `${prefix}${key}`;
    const isBranch = typeof value === "object" && value !== null;
    return isBranch ? leavesOf(value as object, `${path}.`) : [[path, value]];
  });
}

function shapeOf(tree: object): string[] {
  return leavesOf(tree).map(([path, value]) => `${path}:${typeof value}`);
}

describe("messages", () => {
  test("give Japanese a counterpart of the same kind for every English message", () => {
    // The type already demands the keys; this also catches a string where a
    // function belongs, which a cast could slip past the typecheck.
    expect(shapeOf(messagesFor("ja"))).toEqual(shapeOf(messagesFor("en")));
  });

  test("leave no text message empty in either language", () => {
    for (const locale of LOCALES) {
      const empty = leavesOf(messagesFor(locale))
        .filter(([, value]) => value === "")
        .map(([path]) => `${locale}: ${path}`);
      expect(empty).toEqual([]);
    }
  });

  test("interpolate counts into English with the singular for one", () => {
    const en = messagesFor("en");
    expect(en.common.caseCount(1)).toBe("1 case");
    expect(en.common.caseCount(3)).toBe("3 cases");
    expect(en.run.stepCount(1)).toBe("1 step");
  });
});

describe("failureLabelFor", () => {
  test("names the unreachable source in the active language", () => {
    expect(failureLabelFor("android", messagesFor("ja"))).toBe("エミュレーターに接続できません");
    expect(failureLabelFor("web", messagesFor("ja"))).toBe("ブラウザに接続できません");
  });
});
