import type { KeyName, SwipeDirection, UiNode, WebTarget } from "@gemma-e2e/core";
import type { CdpSession, Viewport } from "@gemma-e2e/cdp";
import type { Driver } from "../driver.ts";

/**
 * The slice of `CdpClient` this adapter drives, stated here so the agent
 * package depends on the CDP package for types only and a test can supply a
 * fake without a browser. Mirrors {@link AdbLike} on the android side.
 */
export interface CdpLike {
  openSession(viewport?: Viewport): Promise<CdpSession>;
  closeSession(session: CdpSession): Promise<void>;
  navigate(session: CdpSession, url: string): Promise<void>;
  dumpUi(session: CdpSession): Promise<UiNode>;
  screenLabel(session: CdpSession): Promise<string>;
  tap(session: CdpSession, x: number, y: number): Promise<void>;
  typeText(session: CdpSession, text: string): Promise<void>;
  swipe(session: CdpSession, direction: SwipeDirection): Promise<void>;
  keyevent(session: CdpSession, key: KeyName): Promise<void>;
  screencap(session: CdpSession, destPath: string): Promise<string>;
}

/**
 * Adapts {@link CdpLike} to {@link Driver}, binding one page to every call.
 *
 * The session is the unit of isolation, so it is opened by whoever builds this
 * driver and disposed by the same code -- not here. What this class adds is the
 * binding: the loop names no page, and every method reaches the one this case
 * was given.
 */
export class WebDriver implements Driver {
  readonly #cdp: CdpLike;
  readonly #session: CdpSession;
  readonly #target: WebTarget;

  constructor(cdp: CdpLike, session: CdpSession, target: WebTarget) {
    this.#cdp = cdp;
    this.#session = session;
    this.#target = target;
  }

  dumpUi(): Promise<UiNode> {
    return this.#cdp.dumpUi(this.#session);
  }

  screenLabel(): Promise<string> {
    return this.#cdp.screenLabel(this.#session);
  }

  tap(x: number, y: number): Promise<void> {
    return this.#cdp.tap(this.#session, x, y);
  }

  typeText(text: string): Promise<void> {
    return this.#cdp.typeText(this.#session, text);
  }

  swipe(direction: SwipeDirection): Promise<void> {
    return this.#cdp.swipe(this.#session, direction);
  }

  keyevent(key: KeyName): Promise<void> {
    return this.#cdp.keyevent(this.#session, key);
  }

  screencap(destPath: string): Promise<string> {
    return this.#cdp.screencap(this.#session, destPath);
  }

  /**
   * Navigates to the target's url.
   *
   * The context this session runs in was created for this case alone, so it
   * starts with no cookies and no storage and there is nothing to clear here --
   * where android has to force-stop first, a fresh context is already clean.
   * Navigating is still needed: the session opens on about:blank.
   */
  reset(): Promise<void> {
    return this.#cdp.navigate(this.#session, this.#target.url);
  }
}
