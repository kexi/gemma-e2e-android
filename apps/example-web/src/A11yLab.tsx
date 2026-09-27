import { useEffect, useState } from "react";
import { BEANS } from "@gemma-e2e/example-shared";
import "./a11y-lab.css";

/**
 * Screens with deliberately planted visual problems, opened with `?lab=a11y`.
 *
 * The persona review had only ever been run against screens that happen to be
 * fine, where "no findings" cannot tell a working reviewer from one that sees
 * nothing. Each middle screen here plants one problem aimed at one of the
 * preset personas, and the first and last screens plant none, so a run over
 * them has a known answer: a finding on a planted screen is a hit, and a
 * finding on the bookend screens is a false positive.
 *
 * The screens carry product pictures like a real shop's, so the reviewer
 * has to find a planted problem among ordinary imagery rather than on a bare
 * page where the problem is the only thing to look at. The pictures are drawn
 * SVGs (public/lab/) with no lettering, so an image cannot itself become a
 * legibility finding, and they are decorative (`alt=""`) so the DOM walker --
 * and with it the operating model's view of each screen -- is unchanged.
 *
 * Nothing on a screen says it is a test or names its problem. The reviewer
 * reads the screenshot, so a caption like "colour-only status" would hand it
 * the answer. The Next buttons stay plainly styled for the same reason in
 * reverse: the operating model reads the DOM, not the pixels, and a planted
 * problem on the only way forward would turn a review check into a navigation
 * failure.
 */

const SCREENS = ["storeInfo", "stock", "brewGuide", "delivery", "quickActions", "done"] as const;
type LabScreen = (typeof SCREENS)[number];

/**
 * Every picture the lab shows, fetched as soon as it opens, so no screen waits
 * on the network for its pictures. The first showing of an SVG still takes a
 * frame or two to paint; a step captures its screen well after that (behind
 * the UI dump and the previous screen's review), so the review sees it whole.
 */
const LAB_IMAGES = [
  "/lab/store.svg",
  "/lab/bag.svg",
  ...BEANS.map((bean) => `/lab/beans/${bean.id}.svg`),
];

/** Sold-out beans for the stock screen; everything else is in stock. */
const SOLD_OUT = new Set(["huila", "geisha"]);

/** Iced-brew picks for the brewing guide; everything else is for hot brewing. */
const ICED = new Set(["yirgacheffe", "sidamo", "geisha"]);

/**
 * Icon-only actions for the crowded toolbar. Checkout sits among them with the
 * same size and colour as "Share" or "Print", which is the planted problem:
 * the one action that matters does not stand out.
 */
const QUICK_ACTIONS = [
  ["☕", "Order again"],
  ["♡", "Favourite"],
  ["☆", "Rate"],
  ["✎", "Edit order"],
  ["⚙", "Settings"],
  ["⌂", "Home"],
  ["✉", "Contact"],
  ["⟳", "Refresh"],
  ["✂", "Coupons"],
  ["☰", "Menu"],
  ["⚑", "Report"],
  ["✓", "Checkout"],
  ["✕", "Clear cart"],
  ["↺", "Undo"],
  ["⤓", "Download receipt"],
  ["⎙", "Print"],
  ["☏", "Call store"],
  ["✈", "Gift"],
  ["♺", "Recycle bags"],
  ["⌕", "Search"],
  ["⇪", "Share"],
  ["⚐", "Language"],
  ["⏏", "Sign out"],
  ["ⓘ", "About"],
] as const;

export function A11yLab() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    for (const src of LAB_IMAGES) {
      const image = new Image();
      image.src = src;
    }
  }, []);
  const screen: LabScreen = SCREENS[index] ?? "done";

  const next = () => setIndex((current) => Math.min(current + 1, SCREENS.length - 1));
  const restart = () => setIndex(0);

  switch (screen) {
    case "storeInfo":
      return <StoreInfoScreen onNext={next} />;
    case "stock":
      return <StockScreen onNext={next} />;
    case "brewGuide":
      return <BrewGuideScreen onNext={next} />;
    case "delivery":
      return <DeliveryScreen onNext={next} />;
    case "quickActions":
      return <QuickActionsScreen onNext={next} />;
    case "done":
      return <DoneScreen onRestart={restart} />;
  }
}

/** Bookend with nothing planted: large text, strong contrast, labelled actions. */
function StoreInfoScreen(props: { onNext: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Store info</h1>
      <img src="/lab/store.svg" alt="" className="lab-hero" />
      <p className="lab-body">Kexi Coffee Shop, Shibuya</p>
      <p className="lab-body">Open Monday to Friday, 8:00 to 18:00.</p>
      <p className="lab-body">Closed on weekends and public holidays.</p>
      <button id="nextButton" type="button" className="primary" onClick={props.onNext}>
        Next
      </button>
    </main>
  );
}

/** Planted for red-green: whether a bean is in stock is told by dot colour alone. */
function StockScreen(props: { onNext: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Today's stock</h1>
      <p className="lab-legend">
        <span className="stock-dot in" /> In stock <span className="stock-dot out" /> Sold out
      </p>
      <ul className="lab-rows">
        {BEANS.map((bean) => {
          const isSoldOut = SOLD_OUT.has(bean.id);
          return (
            <li key={bean.id}>
              <img src={`/lab/beans/${bean.id}.svg`} alt="" className="lab-thumb" />
              <span className={isSoldOut ? "stock-dot out" : "stock-dot in"} />
              {bean.name}
            </li>
          );
        })}
      </ul>
      <button id="nextButton" type="button" className="primary" onClick={props.onNext}>
        Next
      </button>
    </main>
  );
}

/** Planted for blue-yellow: hot versus iced is told by tag colour alone. */
function BrewGuideScreen(props: { onNext: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Brewing guide</h1>
      <p className="lab-legend">
        <span className="brew-tag hot" /> Best hot <span className="brew-tag iced" /> Best iced
      </p>
      <ul className="lab-rows">
        {BEANS.map((bean) => {
          const isIced = ICED.has(bean.id);
          return (
            <li key={bean.id}>
              <img src={`/lab/beans/${bean.id}.svg`} alt="" className="lab-thumb" />
              <span className={isIced ? "brew-tag iced" : "brew-tag hot"} />
              {bean.name}
            </li>
          );
        })}
      </ul>
      <button id="nextButton" type="button" className="primary" onClick={props.onNext}>
        Next
      </button>
    </main>
  );
}

/**
 * Planted for presbyopia and low vision: the two facts a customer must not
 * miss -- a fee and a cancellation cut-off -- are set in tiny, pale text.
 */
function DeliveryScreen(props: { onNext: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Delivery</h1>
      <img src="/lab/bag.svg" alt="" className="lab-bag" />
      <p className="lab-body">We deliver within Tokyo's 23 wards.</p>
      <p className="fine-print">
        A ¥500 delivery fee applies to orders under ¥3,000. Orders cannot be cancelled once roasting
        has started, which is about five minutes after the order is placed. Deliveries missed twice
        are returned to the store and refunded minus the delivery fee.
      </p>
      <button id="nextButton" type="button" className="primary" onClick={props.onNext}>
        Next
      </button>
    </main>
  );
}

/** Planted for low vision: two dozen small look-alike icons, checkout among them. */
function QuickActionsScreen(props: { onNext: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Quick actions</h1>
      <div className="quick-grid">
        {QUICK_ACTIONS.map(([icon, label]) => (
          <button key={label} type="button" aria-label={label} title={label}>
            {icon}
          </button>
        ))}
      </div>
      <button id="nextButton" type="button" className="primary" onClick={props.onNext}>
        Next
      </button>
    </main>
  );
}

/** Bookend with nothing planted. */
function DoneScreen(props: { onRestart: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">You're all set</h1>
      <img src="/lab/bag.svg" alt="" className="lab-bag" />
      <p className="lab-body">Thank you for visiting Kexi Coffee Shop.</p>
      <button id="restartButton" type="button" className="secondary" onClick={props.onRestart}>
        Back to start
      </button>
    </main>
  );
}
