import { type FormEvent, useState } from "react";
import {
  addLine,
  type Bean,
  BEANS,
  cartTotalOf,
  type CartLine,
  codeMatches,
  CONFIRMATION_CODE,
  credentialsMatch,
  findBean,
  formatPrice,
  itemCountOf,
  ORDER_NUMBER,
  type ScreenName,
  SIGN_IN_ERROR,
  WRONG_CODE_ERROR,
} from "@gemma-e2e/example-shared";

/**
 * The Kexi Coffee Shop, in the browser.
 *
 * Written in plain HTML elements on purpose. A `<button>` is a button, a
 * `<input>` is a field, and a label names them -- which is precisely what the
 * DOM walker reads and what the model then sees as `[0] button text="Login"`.
 * Rendering the same screens through a component library, or through
 * react-native-web, would emit nested divs instead and leave the walker with
 * nothing to recognise, so this fixture would stop testing what it exists to
 * test.
 *
 * The flow, the data, and every string a scenario asserts on come from
 * `@gemma-e2e/example-shared`, which the Android app imports too.
 */
export function App() {
  const [screen, setScreen] = useState<ScreenName>({ name: "signIn" });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");

  const itemCount = itemCountOf(cart);
  const cartTotal = cartTotalOf(cart);

  const addToCart = (beanId: string) => {
    setCart((lines) => addLine(lines, beanId));
    setScreen({ name: "cart" });
  };

  const startOver = () => {
    setCart([]);
    setCodeInput("");
    setCodeError("");
  };

  const placeOrder = () => {
    if (!codeMatches(codeInput)) {
      setCodeError(WRONG_CODE_ERROR);
      return;
    }
    setCodeError("");
    setScreen({ name: "orderComplete" });
  };

  switch (screen.name) {
    case "signIn":
      return <SignInScreen onSignedIn={() => setScreen({ name: "shop" })} />;
    case "shop":
      return (
        <ShopScreen
          itemCount={itemCount}
          onOpenBean={(beanId) => setScreen({ name: "bean", beanId })}
          onOpenCart={() => setScreen({ name: "cart" })}
          onSignOut={() => {
            startOver();
            setScreen({ name: "signIn" });
          }}
        />
      );
    case "bean":
      return (
        <BeanDetailScreen
          bean={findBean(screen.beanId)}
          onAddToCart={addToCart}
          onBack={() => setScreen({ name: "shop" })}
        />
      );
    case "cart":
      return (
        <CartScreen
          cart={cart}
          total={cartTotal}
          onCheckout={() => setScreen({ name: "checkout" })}
          onBack={() => setScreen({ name: "shop" })}
        />
      );
    case "checkout":
      return <CheckoutScreen total={cartTotal} onContinue={() => setScreen({ name: "confirm" })} />;
    case "confirm":
      return (
        <ConfirmScreen
          code={codeInput}
          error={codeError}
          onChangeCode={setCodeInput}
          onPlaceOrder={placeOrder}
        />
      );
    case "orderComplete":
      return (
        <OrderCompleteScreen
          onBackToShop={() => {
            startOver();
            setScreen({ name: "shop" });
          }}
        />
      );
  }
}

function SignInScreen(props: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // A real <form>, so Enter submits it. That is what makes the loop's
  // `key_event: enter` mean the same thing here as it does on a phone.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentialsMatch(email, password)) {
      setError(SIGN_IN_ERROR);
      return;
    }
    setError("");
    props.onSignedIn();
  };

  return (
    <main>
      <h1>Sign in</h1>
      <h2>Kexi Coffee Shop</h2>
      <form onSubmit={submit}>
        <label htmlFor="email">
          Email
          <input
            id="email"
            name="email"
            type="email"
            placeholder="Email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {/* Rendered into the page rather than shown as an alert: the agent
            judges a run from what it can read on screen, and a dialog is not
            part of the document. Every state this app reaches is text. */}
        {error !== "" && (
          <p id="errorMessage" role="alert" className="error">
            {error}
          </p>
        )}
        <button id="loginButton" type="submit" className="primary">
          Login
        </button>
      </form>
    </main>
  );
}

function ShopScreen(props: {
  itemCount: number;
  onOpenBean: (beanId: string) => void;
  onOpenCart: () => void;
  onSignOut: () => void;
}) {
  return (
    <main>
      <div className="header">
        <h1 id="screenTitle">Kexi Coffee Shop</h1>
        <div className="header-actions">
          <button id="cartButton" type="button" className="small" onClick={props.onOpenCart}>
            Cart ({props.itemCount})
          </button>
          <button id="signOutButton" type="button" className="small" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </div>
      <p id="cartCount" className="muted">
        Items in cart: {props.itemCount}
      </p>
      <ul className="beans">
        {BEANS.map((bean) => (
          <li key={bean.id}>
            <button
              id={`beanRow-${bean.id}`}
              type="button"
              onClick={() => props.onOpenBean(bean.id)}
            >
              <span className="row-title">{bean.name}</span>
              <span className="row-meta">
                {bean.origin} - {formatPrice(bean.price)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

function BeanDetailScreen(props: {
  bean: Bean;
  onAddToCart: (beanId: string) => void;
  onBack: () => void;
}) {
  const { bean } = props;

  return (
    <main>
      <h1 id="screenTitle">{bean.name}</h1>
      <p id="beanOrigin">Origin: {bean.origin}</p>
      <p id="beanRoast">Roast: {bean.roast}</p>
      <p id="beanPrice">Price: {formatPrice(bean.price)}</p>
      <p id="beanDescription">{bean.description}</p>
      <button
        id="addToCartButton"
        type="button"
        className="primary"
        onClick={() => props.onAddToCart(bean.id)}
      >
        Add to cart
      </button>
      <button id="backButton" type="button" className="secondary" onClick={props.onBack}>
        Back to shop
      </button>
    </main>
  );
}

function CartScreen(props: {
  cart: CartLine[];
  total: number;
  onCheckout: () => void;
  onBack: () => void;
}) {
  const isEmpty = props.cart.length === 0;

  return (
    <main>
      <h1 id="screenTitle">Your cart</h1>
      {isEmpty && <p id="emptyCart">Your cart is empty</p>}
      {props.cart.map((line) => {
        const bean = findBean(line.beanId);
        return (
          <div key={line.beanId} className="cart-line">
            <span className="row-title">{bean.name}</span>
            <span id={`cartLine-${bean.id}`} className="row-meta">
              Qty {line.quantity} - {formatPrice(bean.price * line.quantity)}
            </span>
          </div>
        );
      })}
      <p id="cartTotal" className="total">
        Total: {formatPrice(props.total)}
      </p>
      {!isEmpty && (
        <button id="checkoutButton" type="button" className="primary" onClick={props.onCheckout}>
          Checkout
        </button>
      )}
      <button id="backButton" type="button" className="secondary" onClick={props.onBack}>
        Back to shop
      </button>
    </main>
  );
}

/**
 * Shows the confirmation code, and is the only screen that ever does. The next
 * screen asks for it back, so an agent that navigates on without recording it
 * has no way to recover the value -- which is the point: this is what exercises
 * the `remember` action.
 */
function CheckoutScreen(props: { total: number; onContinue: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Checkout</h1>
      <p id="orderTotal">Order total: {formatPrice(props.total)}</p>
      <p id="confirmationCode" className="total">
        Confirmation code: {CONFIRMATION_CODE}
      </p>
      <p className="muted">You will be asked for this code on the next screen.</p>
      <button id="continueButton" type="button" className="primary" onClick={props.onContinue}>
        Continue
      </button>
    </main>
  );
}

function ConfirmScreen(props: {
  code: string;
  error: string;
  onChangeCode: (code: string) => void;
  onPlaceOrder: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onPlaceOrder();
  };

  return (
    <main>
      <h1 id="screenTitle">Confirm your order</h1>
      <h2>Enter the confirmation code from the previous screen.</h2>
      <form onSubmit={submit}>
        <label htmlFor="confirmationCodeInput">
          Confirmation code
          <input
            id="confirmationCodeInput"
            name="confirmationCode"
            inputMode="numeric"
            placeholder="Confirmation code"
            autoComplete="off"
            value={props.code}
            onChange={(event) => props.onChangeCode(event.target.value)}
          />
        </label>
        {props.error !== "" && (
          <p id="errorMessage" role="alert" className="error">
            {props.error}
          </p>
        )}
        <button id="placeOrderButton" type="submit" className="primary">
          Place order
        </button>
      </form>
    </main>
  );
}

function OrderCompleteScreen(props: { onBackToShop: () => void }) {
  return (
    <main>
      <h1 id="screenTitle">Order placed!</h1>
      <p id="orderNumber" className="total">
        Order number: {ORDER_NUMBER}
      </p>
      <button id="backToShopButton" type="button" className="primary" onClick={props.onBackToShop}>
        Back to shop
      </button>
    </main>
  );
}
