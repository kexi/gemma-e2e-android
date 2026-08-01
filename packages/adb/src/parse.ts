import { XMLParser } from "fast-xml-parser";
import type { Bounds, UiNode } from "@gemma-e2e/core";

const BOUNDS_PATTERN = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;
const ATTRIBUTE_PREFIX = "@_";

export class UiDumpParseError extends Error {
  override readonly name = "UiDumpParseError";
}

/** `[x1,y1][x2,y2]` -> Bounds. Off-screen negatives are legal and preserved. */
export function parseBounds(raw: string): Bounds {
  const match = BOUNDS_PATTERN.exec(raw.trim());
  if (!match) {
    throw new UiDumpParseError(`malformed bounds: ${JSON.stringify(raw)}`);
  }

  const [, x1, y1, x2, y2] = match;
  return {
    x1: Number(x1),
    y1: Number(y1),
    x2: Number(x2),
    y2: Number(y2),
  };
}

/** Tap target for a node: the rectangle's centre, rounded down. */
export function centerOf(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.floor((bounds.x1 + bounds.x2) / 2),
    y: Math.floor((bounds.y1 + bounds.y2) / 2),
  };
}

// fast-xml-parser is configured to never coerce values: uiautomator writes
// booleans as the strings "true"/"false" and resource ids that look numeric
// ("0", "123") must not silently become numbers.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => name === "node",
});

type RawNode = Record<string, unknown>;

function attr(raw: RawNode, name: string): string | undefined {
  const value = raw[`${ATTRIBUTE_PREFIX}${name}`];
  const isPresent = typeof value === "string";
  return isPresent ? value : undefined;
}

function boolAttr(raw: RawNode, name: string): boolean {
  return attr(raw, name) === "true";
}

/**
 * uiautomator writes `checked="false"` on every node, checkable or not, so the
 * raw attribute cannot distinguish "unchecked checkbox" from "not a checkbox".
 * `checkable` is the flag that makes it meaningful; without it `checked` stays
 * undefined and the serializer omits it.
 */
function checkedState(raw: RawNode): boolean | undefined {
  const isCheckable = attr(raw, "checkable") === "true";
  return isCheckable ? attr(raw, "checked") === "true" : undefined;
}

function toUiNode(raw: RawNode): UiNode {
  const rawBounds = attr(raw, "bounds");
  // A node without bounds cannot be tapped or laid out; treat the dump as
  // corrupt rather than inventing a rectangle.
  if (rawBounds === undefined) {
    throw new UiDumpParseError("node is missing a bounds attribute");
  }

  const childNodes = raw["node"];
  const children = Array.isArray(childNodes) ? childNodes.map((c) => toUiNode(c as RawNode)) : [];

  const checked = checkedState(raw);

  return {
    text: attr(raw, "text") ?? "",
    resourceId: attr(raw, "resource-id") ?? "",
    className: attr(raw, "class") ?? "",
    contentDesc: attr(raw, "content-desc") ?? "",
    bounds: parseBounds(rawBounds),
    clickable: boolAttr(raw, "clickable"),
    enabled: boolAttr(raw, "enabled"),
    focused: boolAttr(raw, "focused"),
    ...(checked === undefined ? {} : { checked }),
    children,
  };
}

/**
 * Parses `uiautomator dump` XML into a UiNode tree.
 *
 * The dump's root is `<hierarchy>`, which carries no bounds of its own. When it
 * holds exactly one child that child becomes the root; otherwise a synthetic
 * root spanning the union of its children keeps the return type a single node.
 */
export function parseUiDump(xml: string): UiNode {
  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new UiDumpParseError(`not valid XML: ${detail}`);
  }

  const hierarchy = document["hierarchy"] as RawNode | undefined;
  if (hierarchy === undefined) {
    throw new UiDumpParseError("dump has no <hierarchy> root");
  }

  const rawChildren = hierarchy["node"];
  const hasChildren = Array.isArray(rawChildren) && rawChildren.length > 0;
  if (!hasChildren) {
    throw new UiDumpParseError("dump contains no nodes");
  }

  const roots = rawChildren.map((c) => toUiNode(c as RawNode));

  const first = roots[0];
  const isSingleRoot = roots.length === 1 && first !== undefined;
  if (isSingleRoot) {
    return first;
  }

  return {
    text: "",
    resourceId: "",
    className: "hierarchy",
    contentDesc: "",
    bounds: {
      x1: Math.min(...roots.map((n) => n.bounds.x1)),
      y1: Math.min(...roots.map((n) => n.bounds.y1)),
      x2: Math.max(...roots.map((n) => n.bounds.x2)),
      y2: Math.max(...roots.map((n) => n.bounds.y2)),
    },
    clickable: false,
    enabled: true,
    focused: false,
    children: roots,
  };
}
