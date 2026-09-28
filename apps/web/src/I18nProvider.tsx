import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Code, initialLocale, type Locale, type Messages, messagesFor } from "./i18n.ts";

const STORAGE_KEY = "gemma-e2e.locale";

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be denied outright (private mode, blocked cookies). The
    // switch still works, it just forgets between visits.
    return null;
  }
}

export interface I18n {
  locale: Locale;
  t: Messages;
  setLocale: (next: Locale) => void;
}

// English without a provider, rather than a throw: a component rendered in
// isolation (a future test, a storybook) still reads as it did before there
// was a second language.
const I18nContext = createContext<I18n>({
  locale: "en",
  t: messagesFor("en"),
  setLocale: () => {},
});

/**
 * Holds the active language for the whole dashboard.
 *
 * Kept out of the URL for the same reason as the live view's platform: it is a
 * preference about the reader, not about what they are looking at, so it has to
 * survive navigating between runs and a link shared with a colleague must not
 * carry it along.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale(stored(), navigator.language),
  );

  // Screen readers pick their voice from `lang`, and the browser picks line
  // breaking and fonts from it, so it has to follow the switch rather than
  // stay at the "en" index.html starts with.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // As above: remembering is a convenience, not a requirement.
    }
  }, []);

  const value = useMemo(() => ({ locale, t: messagesFor(locale), setLocale }), [locale, setLocale]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

/** The active language, its messages, and the setter the AppBar switch calls. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}

/**
 * The code span a message places inside its sentence.
 *
 * Keyed by its text because a message returns its pieces as a list, and React
 * wants a key on every element in one; no message repeats the same span, so the
 * text is unique among its siblings.
 */
export const code: Code = (text) => <code key={text}>{text}</code>;
