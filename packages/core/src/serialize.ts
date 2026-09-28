import type { Bounds, UiFormat, UiNode } from "./schema.ts";

/**
 * An element the model may target by `ref`: a numbered actionable element in
 * the text format, any node at all in the XML one.
 */
export interface UiRef {
  ref: number;
  node: UiNode;
  center: { x: number; y: number };
}

export interface SerializedUi {
  text: string;
  refs: Map<number, UiRef>;
}

/** Tap target for a node: the rectangle's centre, rounded down. */
export function centerOf(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.floor((bounds.x1 + bounds.x2) / 2),
    y: Math.floor((bounds.y1 + bounds.y2) / 2),
  };
}

/**
 * Fields a model may type into, in both platforms' vocabularies: uiautomator
 * names an Android widget class, a DOM walker names the tag. Matched as one
 * pattern rather than per platform because a `UiNode` deliberately carries no
 * record of where it came from -- that is what lets one serializer serve both.
 */
const EDITABLE_CLASS_PATTERN =
  /EditText|AutoCompleteTextView|SearchView|^input$|^textarea$|^contenteditable$/i;
const INDENT = "  ";

/**
 * `com.example:id/login_button` -> `login_button`; ids are noise beyond the
 * leaf. A DOM `id` has no such prefix, so this is the identity there.
 */
function shortResourceId(resourceId: string): string {
  const slash = resourceId.lastIndexOf("/");
  const hasPackagePrefix = slash >= 0;
  return hasPackagePrefix ? resourceId.slice(slash + 1) : resourceId;
}

/** `android.widget.Button` -> `Button`; a DOM tag like `button` is unchanged. */
function shortClassName(className: string): string {
  const dot = className.lastIndexOf(".");
  const isQualified = dot >= 0;
  return isQualified ? className.slice(dot + 1) : className;
}

function isEditable(node: UiNode): boolean {
  return EDITABLE_CLASS_PATTERN.test(node.className);
}

/** Editable fields are targets even when uiautomator marks them unclickable. */
function isActionable(node: UiNode): boolean {
  const isInteractive = node.clickable || isEditable(node);
  return isInteractive && node.enabled;
}

function hasZeroArea(node: UiNode): boolean {
  const { x1, y1, x2, y2 } = node.bounds;
  return x2 <= x1 || y2 <= y1;
}

/** Anything the model could read or act on; everything else is scaffolding. */
function carriesInformation(node: UiNode): boolean {
  return node.text !== "" || node.contentDesc !== "" || isActionable(node);
}

/**
 * True when a node exists only to hold one child -- a layout wrapper. Collapsing
 * these is what keeps a 200-node dump readable: nesting depth in the output
 * then reflects meaningful grouping rather than layout implementation.
 */
function isRedundantContainer(node: UiNode, renderableChildren: UiNode[]): boolean {
  return !carriesInformation(node) && renderableChildren.length <= 1;
}

function describe(node: UiNode, ref: number | undefined): string {
  const parts: string[] = [];

  const hasRef = ref !== undefined;
  if (hasRef) {
    parts.push(`[${ref}]`);
  }

  parts.push(shortClassName(node.className) || "View");

  const hasText = node.text !== "";
  if (hasText) {
    parts.push(`text=${JSON.stringify(node.text)}`);
  }

  const hasContentDesc = node.contentDesc !== "" && node.contentDesc !== node.text;
  if (hasContentDesc) {
    parts.push(`desc=${JSON.stringify(node.contentDesc)}`);
  }

  const shortId = shortResourceId(node.resourceId);
  const hasId = shortId !== "";
  if (hasId) {
    parts.push(`id=${shortId}`);
  }

  const isCheckable = node.checked !== undefined;
  if (isCheckable) {
    parts.push(`checked=${node.checked === true}`);
  }

  // Only the exceptional states are worth tokens; enabled+unfocused is the norm.
  const isDisabled = !node.enabled;
  if (isDisabled) {
    parts.push("disabled");
  }

  if (node.focused) {
    parts.push("focused");
  }

  if (isEditable(node)) {
    parts.push("editable");
  }

  return parts.join(" ");
}

/**
 * Renders the tree as indented text and numbers every actionable element.
 *
 * Refs are assigned in document order, which is top-to-bottom on screen, so the
 * numbering matches how a human would scan the screen.
 */
export function serializeForLlm(tree: UiNode): SerializedUi {
  const refs = new Map<number, UiRef>();
  const lines: string[] = [];
  let nextRef = 0;

  function walk(node: UiNode, depth: number): void {
    const isInvisible = hasZeroArea(node);
    if (isInvisible) {
      return;
    }

    const renderableChildren = node.children.filter((child) => !hasZeroArea(child));

    const shouldCollapse = isRedundantContainer(node, renderableChildren);
    if (shouldCollapse) {
      for (const child of renderableChildren) {
        walk(child, depth);
      }
      return;
    }

    let ref: number | undefined;
    const needsRef = isActionable(node);
    if (needsRef) {
      ref = nextRef++;
      refs.set(ref, { ref, node, center: centerOf(node.bounds) });
    }

    lines.push(`${INDENT.repeat(depth)}${describe(node, ref)}`);

    for (const child of renderableChildren) {
      walk(child, depth + 1);
    }
  }

  walk(tree, 0);

  return { text: lines.join("\n"), refs };
}

/**
 * Characters XML 1.0 cannot carry even as a character reference. Replaced
 * rather than written as `&#x1;`: that spelling is only legal in XML 1.1, and a
 * model that has seen mostly 1.0 would be shown a document it has never seen
 * parse. The screen's text is evidence, not data we round-trip, so U+FFFD --
 * "a character was here" -- keeps the rendering honest without breaking it.
 */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  // Whitespace other than a space is written as a reference because an XML
  // parser normalises a literal tab or newline in an attribute to a space, so
  // a multi-line label would otherwise read back as one line.
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

function escapeXmlAttribute(value: string): string {
  return value
    .replace(XML_ILLEGAL_CHARS, "\uFFFD")
    .replace(/[&<>"\t\n\r]/g, (char) => XML_ESCAPES[char] ?? char);
}

function formatBounds({ x1, y1, x2, y2 }: Bounds): string {
  return `[${x1},${y1}][${x2},${y2}]`;
}

/**
 * The node's attributes, named and ordered as uiautomator writes them, so on
 * Android the rendering is the dump itself plus our `ref`, and a model that has
 * seen dumps before recognises every attribute.
 *
 * `ref` stands where uiautomator writes `index`, and no `index` is written.
 * Its `index` is the position among siblings -- on a real sign-in screen 9 of
 * 14 nodes carried `index="0"` -- so it cannot name a node, and a DOM-walked
 * page has none to report. Reusing the name would promise an identity it never
 * carried.
 *
 * The optional fields are written only when the tree has them: an attribute
 * the platform could not report is left out rather than written as `false`,
 * which would claim a state nobody observed.
 */
function xmlAttributes(node: UiNode, ref: number): string {
  const optionalBoolean = (value: boolean | undefined) =>
    value === undefined ? undefined : String(value);

  const attributes: [string, string | undefined][] = [
    ["ref", String(ref)],
    ["text", node.text],
    ["resource-id", node.resourceId],
    ["class", node.className],
    ["package", node.package],
    ["content-desc", node.contentDesc],
    ["checkable", optionalBoolean(node.checkable)],
    // uiautomator writes `checked` on every node; the parser keeps it only on
    // checkable ones, where it is a state rather than a default.
    ["checked", optionalBoolean(node.checked)],
    ["clickable", String(node.clickable)],
    ["enabled", String(node.enabled)],
    ["focusable", optionalBoolean(node.focusable)],
    ["focused", String(node.focused)],
    ["scrollable", optionalBoolean(node.scrollable)],
    ["long-clickable", optionalBoolean(node.longClickable)],
    ["password", optionalBoolean(node.password)],
    ["selected", optionalBoolean(node.selected)],
    ["bounds", formatBounds(node.bounds)],
  ];

  return attributes
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(" ");
}

/**
 * Renders every node of the tree as nested XML and makes every node a ref.
 *
 * Deliberately none of {@link serializeForLlm}'s pruning -- no zero-area
 * filter, no container collapsing -- because this format exists to measure
 * what that pruning is worth, and a partly pruned tree would measure neither.
 *
 * A node's `ref` is its position in document (pre-order) order, so it is
 * unique on the screen and reads top-to-bottom like the text format's
 * numbering. All nodes are addressable because the model, not this function,
 * is now the one deciding what is actionable.
 */
export function serializeAsXml(tree: UiNode): SerializedUi {
  const refs = new Map<number, UiRef>();
  const lines: string[] = [];
  let nextRef = 0;

  function walk(node: UiNode, depth: number): void {
    const ref = nextRef++;
    refs.set(ref, { ref, node, center: centerOf(node.bounds) });

    const indent = INDENT.repeat(depth);
    const attributes = xmlAttributes(node, ref);

    const isLeaf = node.children.length === 0;
    if (isLeaf) {
      lines.push(`${indent}<node ${attributes} />`);
      return;
    }

    lines.push(`${indent}<node ${attributes}>`);
    for (const child of node.children) {
      walk(child, depth + 1);
    }
    lines.push(`${indent}</node>`);
  }

  walk(tree, 0);

  return { text: lines.join("\n"), refs };
}

/**
 * The serializer a format names. One entry point, so every caller that acts on
 * refs renders the screen the same way the model was shown it.
 */
export function serializeUi(tree: UiNode, format: UiFormat): SerializedUi {
  switch (format) {
    case "text":
      return serializeForLlm(tree);
    case "xml":
      return serializeAsXml(tree);
  }
}
