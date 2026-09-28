import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from "react-native";
import { BEANS } from "@gemma-e2e/example-shared";

/**
 * The web app's `?lab=a11y` screens, for the Android fixture: the same six
 * screens, the same wording, and the same planted problems, opened from the
 * sign-in screen's "Store information" link.
 *
 * As on the web, each middle screen plants one problem aimed at one of the
 * preset personas and the first and last plant none, so a run over them has a
 * known answer. Nothing on a screen says it is a test or names its problem --
 * the reviewer reads the screenshot, and a caption would hand it the answer --
 * and the Next buttons stay plainly styled, because the operating model reads
 * the UI dump and a planted problem on the only way forward would turn a review
 * check into a navigation failure.
 *
 * The pictures are the web lab's SVGs rendered to PNG (assets/lab/), since
 * React Native has no SVG support without a native module. They carry no
 * lettering and are hidden from accessibility, so the UI dump -- and with it
 * the operating model's view of each screen -- is the same as without them.
 */

const SCREENS = ["storeInfo", "stock", "brewGuide", "delivery", "quickActions", "done"] as const;
type LabScreen = (typeof SCREENS)[number];

// `require` needs a literal path, hence a table rather than a template string.
const BEAN_PICTURES: Record<string, ImageSourcePropType> = {
  yirgacheffe: require("./assets/lab/beans/yirgacheffe.png"),
  huila: require("./assets/lab/beans/huila.png"),
  sidamo: require("./assets/lab/beans/sidamo.png"),
  toraja: require("./assets/lab/beans/toraja.png"),
  antigua: require("./assets/lab/beans/antigua.png"),
  geisha: require("./assets/lab/beans/geisha.png"),
};
const STORE_PICTURE: ImageSourcePropType = require("./assets/lab/store.png");
const BAG_PICTURE: ImageSourcePropType = require("./assets/lab/bag.png");

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
    <LabScreenFrame title="Store info">
      <Picture source={STORE_PICTURE} style={styles.hero} />
      <Text style={styles.body}>Kexi Coffee Shop, Shibuya</Text>
      <Text style={styles.body}>Open Monday to Friday, 8:00 to 18:00.</Text>
      <Text style={styles.body}>Closed on weekends and public holidays.</Text>
      <NextButton onPress={props.onNext} />
    </LabScreenFrame>
  );
}

/** Planted for red-green: whether a bean is in stock is told by dot colour alone. */
function StockScreen(props: { onNext: () => void }) {
  return (
    <LabScreenFrame title="Today's stock">
      <View style={styles.legend}>
        <View style={[styles.stockDot, styles.stockIn]} />
        <Text style={styles.legendText}>In stock</Text>
        <View style={[styles.stockDot, styles.stockOut]} />
        <Text style={styles.legendText}>Sold out</Text>
      </View>
      <View style={styles.rows}>
        {BEANS.map((bean) => {
          const isSoldOut = SOLD_OUT.has(bean.id);
          return (
            <View key={bean.id} style={styles.row}>
              <Picture source={BEAN_PICTURES[bean.id]} style={styles.thumb} />
              <View style={[styles.stockDot, isSoldOut ? styles.stockOut : styles.stockIn]} />
              <Text style={styles.rowText}>{bean.name}</Text>
            </View>
          );
        })}
      </View>
      <NextButton onPress={props.onNext} />
    </LabScreenFrame>
  );
}

/** Planted for blue-yellow: hot versus iced is told by tag colour alone. */
function BrewGuideScreen(props: { onNext: () => void }) {
  return (
    <LabScreenFrame title="Brewing guide">
      <View style={styles.legend}>
        <View style={[styles.brewTag, styles.brewHot]} />
        <Text style={styles.legendText}>Best hot</Text>
        <View style={[styles.brewTag, styles.brewIced]} />
        <Text style={styles.legendText}>Best iced</Text>
      </View>
      <View style={styles.rows}>
        {BEANS.map((bean) => {
          const isIced = ICED.has(bean.id);
          return (
            <View key={bean.id} style={styles.row}>
              <Picture source={BEAN_PICTURES[bean.id]} style={styles.thumb} />
              <View style={[styles.brewTag, isIced ? styles.brewIced : styles.brewHot]} />
              <Text style={styles.rowText}>{bean.name}</Text>
            </View>
          );
        })}
      </View>
      <NextButton onPress={props.onNext} />
    </LabScreenFrame>
  );
}

/**
 * Planted for presbyopia and low vision: the two facts a customer must not
 * miss -- a fee and a cancellation cut-off -- are set in tiny, pale text.
 */
function DeliveryScreen(props: { onNext: () => void }) {
  return (
    <LabScreenFrame title="Delivery">
      <Picture source={BAG_PICTURE} style={styles.bag} />
      <Text style={styles.body}>We deliver within Tokyo's 23 wards.</Text>
      <Text style={styles.finePrint}>
        A ¥500 delivery fee applies to orders under ¥3,000. Orders cannot be cancelled once roasting
        has started, which is about five minutes after the order is placed. Deliveries missed twice
        are returned to the store and refunded minus the delivery fee.
      </Text>
      <NextButton onPress={props.onNext} />
    </LabScreenFrame>
  );
}

/** Planted for low vision: two dozen small look-alike icons, checkout among them. */
function QuickActionsScreen(props: { onNext: () => void }) {
  return (
    <LabScreenFrame title="Quick actions">
      <View style={styles.quickGrid}>
        {QUICK_ACTIONS.map(([icon, label]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.quickButton}
          >
            <Text style={styles.quickIcon}>{icon}</Text>
          </Pressable>
        ))}
      </View>
      <NextButton onPress={props.onNext} />
    </LabScreenFrame>
  );
}

/** Bookend with nothing planted. */
function DoneScreen(props: { onRestart: () => void }) {
  return (
    <LabScreenFrame title="You're all set">
      <Picture source={BAG_PICTURE} style={styles.bag} />
      <Text style={styles.body}>Thank you for visiting Kexi Coffee Shop.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to start button"
        testID="restartButton"
        style={styles.secondaryButton}
        onPress={props.onRestart}
      >
        <Text style={styles.secondaryButtonLabel}>Back to start</Text>
      </Pressable>
    </LabScreenFrame>
  );
}

function LabScreenFrame(props: { title: string; children: ReactNode }) {
  return (
    <View style={styles.container}>
      <Text accessibilityLabel="Screen title" testID="screenTitle" style={styles.heading}>
        {props.title}
      </Text>
      {props.children}
      <StatusBar style="auto" />
    </View>
  );
}

/** A decorative picture: kept out of the accessibility tree, like the web's `alt=""`. */
function Picture(props: { source: ImageSourcePropType | undefined; style: object }) {
  return (
    <Image
      source={props.source}
      style={props.style}
      accessible={false}
      importantForAccessibility="no"
      resizeMode="contain"
    />
  );
}

// The same look as App.tsx's primary button. Why not import it from there: App
// imports this module, and a cycle back would make the two load-order dependent.
function NextButton(props: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Next button"
      testID="nextButton"
      style={styles.button}
      onPress={props.onPress}
    >
      <Text style={styles.buttonLabel}>Next</Text>
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
  heading: {
    fontSize: 24,
    fontWeight: "600",
  },
  body: {
    fontSize: 18,
    lineHeight: 29,
  },
  hero: {
    aspectRatio: 640 / 180,
    borderRadius: 12,
    height: undefined,
    width: "100%",
  },
  bag: {
    height: 120,
    width: 120,
  },
  thumb: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  legend: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  legendText: {
    fontSize: 15,
  },
  rows: {
    gap: 10,
  },
  row: {
    alignItems: "center",
    borderColor: "#e0e0e0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingBottom: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingTop: 8,
  },
  rowText: {
    fontSize: 17,
  },
  // Planted (red-green): status is a red or green dot and nothing else.
  stockDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  stockIn: {
    backgroundColor: "#43a047",
  },
  stockOut: {
    backgroundColor: "#e53935",
  },
  // Planted (blue-yellow): the hot/iced tag is a blue or yellow square and nothing else.
  brewTag: {
    borderRadius: 3,
    height: 14,
    width: 14,
  },
  brewHot: {
    backgroundColor: "#f2d64b",
  },
  brewIced: {
    backgroundColor: "#5b8fd9",
  },
  // Planted (presbyopia, low vision): the fee and the cut-off in tiny, pale type.
  finePrint: {
    color: "#c2c2c2",
    fontSize: 10,
    lineHeight: 13.5,
  },
  // Planted (low vision): small look-alike icons packed together, checkout
  // included. Eight 24dp columns with 3dp gaps, as the web's CSS grid.
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    width: 8 * 24 + 7 * 3,
  },
  quickButton: {
    alignItems: "center",
    backgroundColor: "#f3f3f3",
    borderRadius: 4,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  quickIcon: {
    color: "#9e9e9e",
    fontSize: 12,
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
});
