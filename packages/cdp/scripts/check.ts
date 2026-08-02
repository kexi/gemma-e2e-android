/**
 * Drives the example web app through the real CdpClient and prints what the
 * model would see.
 *
 * This is the half of the DOM walker that unit tests cannot reach: happy-dom
 * has no layout engine, so `getBoundingClientRect` there returns zeroes and
 * every element would be filtered out as off-screen. Only a real browser can
 * say whether the collector finds the page at all.
 *
 * Opt-in and manual -- CI has no Chrome, and a unit suite that needed one
 * would stop being runnable on a laptop with nothing attached.
 *
 *   just example-web    # the app under test, on :5174
 *   just chrome         # Chrome with --remote-debugging-port=9222
 *   just cdp-check
 */
import { serializeForLlm } from "@gemma-e2e/core";
import { createLogger, parseLogLevel } from "@gemma-e2e/logger";
import { CdpClient } from "../src/index.ts";

const url = process.env["EXAMPLE_WEB_URL"] ?? "http://localhost:5174";
const endpoint = process.env["CHROME_ENDPOINT"] ?? "http://127.0.0.1:9222";

const logger = createLogger({
  level: parseLogLevel(process.env["LOG_LEVEL"] ?? "warn"),
  bindings: { service: "cdp-check" },
});

const cdp = new CdpClient({ endpoint, logger });

function show(title: string, tree: { text: string }): void {
  console.log(`\n=== ${title} ===`);
  console.log(tree.text);
}

const session = await cdp.openSession();
try {
  await cdp.navigate(session, url);

  const signIn = serializeForLlm(await cdp.dumpUi(session));
  show(`sign in (${await cdp.screenLabel(session)})`, signIn);

  // Everything below is the loop's own vocabulary: resolve a ref to a point,
  // tap it, type into it. If this reaches the shop screen, a scenario can too.
  const byId = (id: string) => [...signIn.refs.values()].find((ref) => ref.node.resourceId === id);
  const email = byId("email");
  const password = byId("password");
  const login = byId("loginButton");
  const isRecognisable = email !== undefined && password !== undefined && login !== undefined;
  if (!isRecognisable) {
    throw new Error(
      `the sign-in screen offered ${signIn.refs.size} targets, none of which were the form`,
    );
  }

  await cdp.tap(session, email.center.x, email.center.y);
  await cdp.typeText(session, "demo@example.com");
  await cdp.tap(session, password.center.x, password.center.y);
  await cdp.typeText(session, "demo1234");
  await cdp.tap(session, login.center.x, login.center.y);

  // No wait: the app is local and synchronous, and a real run would spend a
  // step observing rather than sleeping.
  const shop = serializeForLlm(await cdp.dumpUi(session));
  show(`after login (${await cdp.screenLabel(session)})`, shop);

  const reachedShop = shop.text.includes("Kexi Coffee Shop") && shop.text.includes("Yirgacheffe");
  if (!reachedShop) {
    throw new Error("logging in did not reach the shop screen");
  }

  const shot = `${process.env["TMPDIR"] ?? "/tmp"}/cdp-check.png`;
  await cdp.screencap(session, shot);
  console.log(`\nscreenshot: ${shot}`);
  console.log("\nOK: the walker found the page, and the loop's actions drove it.");
} finally {
  await cdp.closeSession(session);
  cdp.close();
}
