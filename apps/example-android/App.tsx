import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

// The fake coffee store the E2E agent drives. Its data, its flow and every
// string a scenario asserts on come from example-shared, which the web app
// imports too -- so the two fixtures cannot drift apart and start disagreeing
// about a total or an error message.

export default function App() {
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

  const signOut = () => {
    setCart([]);
    setCodeInput("");
    setCodeError("");
    setScreen({ name: "signIn" });
  };

  const placeOrder = () => {
    if (!codeMatches(codeInput)) {
      setCodeError(WRONG_CODE_ERROR);
      return;
    }
    setCodeError("");
    setScreen({ name: "orderComplete" });
  };

  if (screen.name === "signIn") {
    return <SignInScreen onSignedIn={() => setScreen({ name: "shop" })} />;
  }

  if (screen.name === "shop") {
    return (
      <ShopScreen
        itemCount={itemCount}
        onOpenBean={(beanId) => setScreen({ name: "bean", beanId })}
        onOpenCart={() => setScreen({ name: "cart" })}
        onSignOut={signOut}
      />
    );
  }

  if (screen.name === "bean") {
    return (
      <BeanDetailScreen
        bean={findBean(screen.beanId)}
        onAddToCart={addToCart}
        onBack={() => setScreen({ name: "shop" })}
      />
    );
  }

  if (screen.name === "cart") {
    return (
      <CartScreen
        cart={cart}
        total={cartTotal}
        onCheckout={() => setScreen({ name: "checkout" })}
        onBack={() => setScreen({ name: "shop" })}
      />
    );
  }

  if (screen.name === "checkout") {
    return <CheckoutScreen total={cartTotal} onContinue={() => setScreen({ name: "confirm" })} />;
  }

  if (screen.name === "confirm") {
    return (
      <ConfirmScreen
        code={codeInput}
        error={codeError}
        onChangeCode={setCodeInput}
        onPlaceOrder={placeOrder}
      />
    );
  }

  return (
    <OrderCompleteScreen
      onBackToShop={() => {
        setCart([]);
        setCodeInput("");
        setCodeError("");
        setScreen({ name: "shop" });
      }}
    />
  );
}

function SignInScreen(props: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const signIn = () => {
    if (!credentialsMatch(email, password)) {
      setError(SIGN_IN_ERROR);
      return;
    }
    setError("");
    props.onSignedIn();
  };

  return (
    <Screen centered>
      <Text style={styles.heading}>Sign in</Text>
      <Text style={styles.subheading}>Kexi Coffee Shop</Text>
      <TextInput
        accessibilityLabel="Email input"
        testID="emailInput"
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="email"
      />
      <TextInput
        accessibilityLabel="Password input"
        testID="passwordInput"
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      {/* Rendered as Text rather than an alert or toast: `uiautomator dump`
          only reports the view hierarchy, and the agent judges a run from that
          dump alone. Every state this app can be in is a Text for that reason. */}
      {error !== "" && (
        <Text accessibilityLabel="Error message" testID="errorMessage" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        label="Login"
        accessibilityLabel="Login button"
        testID="loginButton"
        onPress={signIn}
      />
    </Screen>
  );
}

function ShopScreen(props: {
  itemCount: number;
  onOpenBean: (beanId: string) => void;
  onOpenCart: () => void;
  onSignOut: () => void;
}) {
  return (
    <Screen>
      <View style={styles.headerRow}>
        <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
          Kexi Coffee Shop
        </Text>
        <View style={styles.headerActions}>
          <SmallButton
            label={`Cart (${props.itemCount})`}
            accessibilityLabel="Cart button"
            testID="cartButton"
            onPress={props.onOpenCart}
          />
          <SmallButton
            label="Sign out"
            accessibilityLabel="Sign out button"
            testID="signOutButton"
            onPress={props.onSignOut}
          />
        </View>
      </View>
      <Text accessibilityLabel="Cart item count" testID="cartCount" style={styles.muted}>
        Items in cart: {props.itemCount}
      </Text>
      {/* Six rows overflow a phone screen, so the list scrolls. The agent can
          swipe, but the rows are kept compact so the common ones need no swipe. */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {BEANS.map((bean) => (
          <Pressable
            key={bean.id}
            accessibilityRole="button"
            accessibilityLabel={`${bean.name} row`}
            testID={`beanRow-${bean.id}`}
            style={styles.row}
            onPress={() => props.onOpenBean(bean.id)}
          >
            <Text style={styles.rowTitle}>{bean.name}</Text>
            <Text style={styles.rowMeta}>
              {bean.origin} - {formatPrice(bean.price)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function BeanDetailScreen(props: {
  bean: Bean;
  onAddToCart: (beanId: string) => void;
  onBack: () => void;
}) {
  const { bean } = props;

  return (
    <Screen>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        {bean.name}
      </Text>
      <Text accessibilityLabel="Bean origin" testID="beanOrigin" style={styles.subheading}>
        Origin: {bean.origin}
      </Text>
      <Text accessibilityLabel="Bean roast" testID="beanRoast" style={styles.subheading}>
        Roast: {bean.roast}
      </Text>
      <Text accessibilityLabel="Bean price" testID="beanPrice" style={styles.subheading}>
        Price: {formatPrice(bean.price)}
      </Text>
      <Text accessibilityLabel="Bean description" testID="beanDescription" style={styles.paragraph}>
        {bean.description}
      </Text>
      <Button
        label="Add to cart"
        accessibilityLabel="Add to cart button"
        testID="addToCartButton"
        onPress={() => props.onAddToCart(bean.id)}
      />
      <SecondaryButton
        label="Back to shop"
        accessibilityLabel="Back button"
        testID="backButton"
        onPress={props.onBack}
      />
    </Screen>
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
    <Screen>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        Your cart
      </Text>
      {isEmpty && (
        <Text accessibilityLabel="Empty cart message" testID="emptyCart" style={styles.subheading}>
          Your cart is empty
        </Text>
      )}
      {props.cart.map((line) => {
        const bean = findBean(line.beanId);
        return (
          <View key={line.beanId} style={styles.row}>
            <Text style={styles.rowTitle}>{bean.name}</Text>
            <Text
              accessibilityLabel={`${bean.name} cart line`}
              testID={`cartLine-${bean.id}`}
              style={styles.rowMeta}
            >
              Qty {line.quantity} - {formatPrice(bean.price * line.quantity)}
            </Text>
          </View>
        );
      })}
      <Text accessibilityLabel="Cart total" testID="cartTotal" style={styles.total}>
        Total: {formatPrice(props.total)}
      </Text>
      {!isEmpty && (
        <Button
          label="Checkout"
          accessibilityLabel="Checkout button"
          testID="checkoutButton"
          onPress={props.onCheckout}
        />
      )}
      <SecondaryButton
        label="Back to shop"
        accessibilityLabel="Back button"
        testID="backButton"
        onPress={props.onBack}
      />
    </Screen>
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
    <Screen centered>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        Checkout
      </Text>
      <Text accessibilityLabel="Order total" testID="orderTotal" style={styles.subheading}>
        Order total: {formatPrice(props.total)}
      </Text>
      <Text accessibilityLabel="Confirmation code" testID="confirmationCode" style={styles.total}>
        Confirmation code: {CONFIRMATION_CODE}
      </Text>
      <Text style={styles.muted}>You will be asked for this code on the next screen.</Text>
      <Button
        label="Continue"
        accessibilityLabel="Continue button"
        testID="continueButton"
        onPress={props.onContinue}
      />
    </Screen>
  );
}

function ConfirmScreen(props: {
  code: string;
  error: string;
  onChangeCode: (code: string) => void;
  onPlaceOrder: () => void;
}) {
  return (
    <Screen centered>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        Confirm your order
      </Text>
      <Text style={styles.subheading}>Enter the confirmation code from the previous screen.</Text>
      <TextInput
        accessibilityLabel="Confirmation code input"
        testID="confirmationCodeInput"
        style={styles.input}
        placeholder="Confirmation code"
        value={props.code}
        onChangeText={props.onChangeCode}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="numeric"
      />
      {props.error !== "" && (
        <Text accessibilityLabel="Error message" testID="errorMessage" style={styles.error}>
          {props.error}
        </Text>
      )}
      <Button
        label="Place order"
        accessibilityLabel="Place order button"
        testID="placeOrderButton"
        onPress={props.onPlaceOrder}
      />
    </Screen>
  );
}

function OrderCompleteScreen(props: { onBackToShop: () => void }) {
  return (
    <Screen centered>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        Order placed!
      </Text>
      <Text accessibilityLabel="Order number" testID="orderNumber" style={styles.total}>
        Order number: {ORDER_NUMBER}
      </Text>
      <Button
        label="Back to shop"
        accessibilityLabel="Back to shop button"
        testID="backToShopButton"
        onPress={props.onBackToShop}
      />
    </Screen>
  );
}

function Screen(props: { children: ReactNode; centered?: boolean }) {
  const isCentered = props.centered === true;
  return (
    <View style={[styles.container, isCentered && styles.centered]}>
      {props.children}
      <StatusBar style="auto" />
    </View>
  );
}

interface ButtonProps {
  label: string;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}

function Button(props: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={styles.button}
      onPress={props.onPress}
    >
      <Text style={styles.buttonLabel}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={styles.secondaryButton}
      onPress={props.onPress}
    >
      <Text style={styles.secondaryButtonLabel}>{props.label}</Text>
    </Pressable>
  );
}

function SmallButton(props: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={styles.smallButton}
      onPress={props.onPress}
    >
      <Text style={styles.smallButtonLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "stretch",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 24,
  },
  centered: {
    justifyContent: "center",
    paddingTop: 24,
  },
  headerRow: {
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
  },
  subheading: {
    fontSize: 16,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
  },
  muted: {
    color: "#5f6368",
    fontSize: 14,
  },
  total: {
    fontSize: 20,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 8,
  },
  row: {
    borderColor: "#e0e0e0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    padding: 12,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  rowMeta: {
    color: "#5f6368",
    fontSize: 14,
  },
  input: {
    borderColor: "#c7c7cc",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    padding: 12,
  },
  error: {
    color: "#c62828",
    fontSize: 14,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#6d4c41",
    borderRadius: 8,
    padding: 14,
  },
  buttonLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#6d4c41",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  secondaryButtonLabel: {
    color: "#6d4c41",
    fontSize: 15,
    fontWeight: "600",
  },
  smallButton: {
    backgroundColor: "#efebe9",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallButtonLabel: {
    color: "#4e342e",
    fontSize: 14,
    fontWeight: "600",
  },
});
