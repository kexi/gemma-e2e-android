import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// The credentials scenarios/login.yaml tells the agent to enter. Hardcoded on
// purpose: this app is only a target for the E2E agent, so there is no backend
// to authenticate against.
const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo1234";

const ERROR_MESSAGE = "Invalid email or password";

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");

  const signIn = () => {
    const credentialsMatch = email.trim() === DEMO_EMAIL && password === DEMO_PASSWORD;
    if (!credentialsMatch) {
      setError(ERROR_MESSAGE);
      return;
    }
    setError("");
    setLoggedIn(true);
  };

  const signOut = () => {
    setEmail("");
    setPassword("");
    setError("");
    setLoggedIn(false);
  };

  if (loggedIn) {
    return (
      <View style={styles.container}>
        <Text accessibilityLabel="Greeting" testID="greeting" style={styles.heading}>
          Welcome, {DEMO_EMAIL}!
        </Text>
        <Text style={styles.subheading}>You are signed in.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out button"
          testID="signOutButton"
          style={styles.button}
          onPress={signOut}
        >
          <Text style={styles.buttonLabel}>Sign out</Text>
        </Pressable>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Sign in</Text>
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
          dump alone. */}
      {error !== "" && (
        <Text accessibilityLabel="Error message" testID="errorMessage" style={styles.error}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Login button"
        testID="loginButton"
        style={styles.button}
        onPress={signIn}
      >
        <Text style={styles.buttonLabel}>Login</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  heading: {
    fontSize: 24,
    fontWeight: "600",
    textAlign: "center",
  },
  subheading: {
    fontSize: 16,
    textAlign: "center",
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
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#1565c0",
    borderRadius: 8,
    padding: 14,
  },
  buttonLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
