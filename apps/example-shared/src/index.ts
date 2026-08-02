/**
 * The Kexi Coffee Shop's domain, with no presentation in it.
 *
 * Both example apps import this so the two never drift: a scenario asserting
 * a total, a code or an error message must find the same value whichever
 * platform it runs on, and a fixture app whose halves disagreed would fail
 * runs for reasons that have nothing to do with the agent.
 *
 * Everything is hardcoded and deterministic -- there is no backend -- so the
 * same prompt produces the same expected values on every run and machine.
 */

export const DEMO_EMAIL = "demo@example.com";
export const DEMO_PASSWORD = "demo1234";

export const SIGN_IN_ERROR = "Invalid email or password";

/** Shown on the checkout screen, typed back on the one after it. */
export const CONFIRMATION_CODE = "4821";
export const WRONG_CODE_ERROR = "Wrong confirmation code";
export const ORDER_NUMBER = "KCS-1001";

export interface Bean {
  id: string;
  name: string;
  origin: string;
  /** Whole dollars: prices render as `$18.00` and totals stay exact in cents. */
  price: number;
  roast: string;
  description: string;
}

export const BEANS: Bean[] = [
  {
    id: "yirgacheffe",
    name: "Yirgacheffe",
    origin: "Ethiopia",
    price: 18,
    roast: "Light",
    description: "Floral and citric, with a jasmine aroma and a clean tea-like body.",
  },
  {
    id: "huila",
    name: "Huila",
    origin: "Colombia",
    price: 16,
    roast: "Medium",
    description: "Caramel sweetness with red apple acidity and a syrupy finish.",
  },
  {
    id: "antigua",
    name: "Antigua",
    origin: "Guatemala",
    price: 17,
    roast: "Medium",
    description: "Cocoa and toasted almond, balanced by a gentle orange acidity.",
  },
  {
    id: "sidamo",
    name: "Sidamo",
    origin: "Ethiopia",
    price: 19,
    roast: "Light",
    description: "Blueberry and bergamot, fermented slowly on the raised bed.",
  },
  {
    id: "geisha",
    name: "Geisha",
    origin: "Panama",
    price: 42,
    roast: "Light",
    description: "Peach, honeysuckle and lime. The most delicate lot on the shelf.",
  },
  {
    id: "toraja",
    name: "Toraja",
    origin: "Indonesia",
    price: 21,
    roast: "Dark",
    description: "Earthy and herbal, with cedar, dark chocolate and a heavy body.",
  },
];

/** `18` -> `"$18.00"`. One helper so a price reads the same on every screen. */
export function formatPrice(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

export function findBean(beanId: string): Bean {
  const bean = BEANS.find((candidate) => candidate.id === beanId);
  // The id always comes from BEANS itself, so this is unreachable in practice;
  // throwing keeps the return type non-optional for every caller.
  if (bean === undefined) {
    throw new Error(`unknown bean: ${beanId}`);
  }
  return bean;
}

export interface CartLine {
  beanId: string;
  quantity: number;
}

export function itemCountOf(cart: CartLine[]): number {
  return cart.reduce((total, line) => total + line.quantity, 0);
}

export function cartTotalOf(cart: CartLine[]): number {
  return cart.reduce((total, line) => total + findBean(line.beanId).price * line.quantity, 0);
}

/** Adds one of a bean, or raises the quantity when it is already in the cart. */
export function addLine(cart: CartLine[], beanId: string): CartLine[] {
  const existing = cart.find((line) => line.beanId === beanId);
  if (existing === undefined) {
    return [...cart, { beanId, quantity: 1 }];
  }
  return cart.map((line) =>
    line.beanId === beanId ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

export function credentialsMatch(email: string, password: string): boolean {
  return email.trim() === DEMO_EMAIL && password === DEMO_PASSWORD;
}

export function codeMatches(code: string): boolean {
  return code.trim() === CONFIRMATION_CODE;
}

/** Which screen is on top. Shared so both apps step through the same flow. */
export type ScreenName =
  | { name: "signIn" }
  | { name: "shop" }
  | { name: "bean"; beanId: string }
  | { name: "cart" }
  | { name: "checkout" }
  | { name: "confirm" }
  | { name: "orderComplete" };
