import { createClient } from "@supabase/supabase-js";
import {
  authSessionStorage,
  reconcileAuthenticatedIdentity,
} from "./storage.js";

export const OTP_RESEND_MS = 60_000;
export const OTP_EXPIRES_MS = 600_000;
export const OTP_MAX_ATTEMPTS = 5;

const LOCAL_ONLY_MESSAGE =
  "Cloud sign-in couldn't safely resume on this device. Meal Rail still works locally.";
const REQUEST_ERROR = "We couldn't send a code. Wait a minute and try again.";
const REQUEST_NETWORK_ERROR = `${REQUEST_ERROR} Meal Rail still works locally. If a code arrives, you can still enter it.`;
const CODE_ERROR =
  "That code is invalid or expired. Request a new code and try again.";
const EXPIRED_ERROR = "That code has expired. Request a new one.";
const ATTEMPTS_ERROR = "Too many code attempts. Request a new code.";
const SUCCESS_MESSAGE =
  "If that address can receive Meal Rail email, enter the six-digit code we sent. It expires in 10 minutes.";

const initialState = () => ({
  status: "loading",
  userId: null,
  email: null,
  otpStep: "email",
  requestedAt: null,
  cooldownUntil: null,
  expiresAt: null,
  otpEmail: "",

  failedAttempts: 0,
  busy: false,
  message: "",
});

const configuredClient = () => {
  const env = import.meta.env || {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return createClient(url, key, {
      auth: {
        storage: authSessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
};

const isNetworkError = (error) =>
  error?.name === "TypeError" ||
  /network|fetch|failed to fetch/i.test(error?.message || "");

export function createAuthController({
  client = null,
  reconcileIdentity = reconcileAuthenticatedIdentity,
  clock = () => Date.now(),
} = {}) {
  let state = client
    ? initialState()
    : { ...initialState(), status: "unavailable" };
  let started = false;
  let subscription = null;
  let authenticated = false;
  let activation = Promise.resolve();
  const listeners = new Set();

  const snapshot = () => {
    if (
      state.otpStep === "code" &&
      state.expiresAt !== null &&
      clock() >= state.expiresAt &&
      state.message !== EXPIRED_ERROR
    ) {
      state = { ...state, message: EXPIRED_ERROR };
    }
    return { ...state };
  };
  const emit = () => {
    const next = snapshot();
    listeners.forEach((listener) => listener(next));
  };
  const setState = (patch) => {
    state = { ...state, ...patch };
    emit();
  };
  const signedOut = () => {
    authenticated = false;
    setState({
      status: "signed_out",
      userId: null,
      email: null,
      busy: false,
    });
  };
  const unavailable = (message = LOCAL_ONLY_MESSAGE) => {
    authenticated = false;
    setState({
      status: "unavailable",
      userId: null,
      email: null,
      busy: false,
      message,
    });
  };
  const activate = (session) => {
    activation = activation.then(async () => {
      const user = session?.user;
      if (!user?.id) return signedOut();
      const safe = await reconcileIdentity(user.id);
      if (!safe) return unavailable();
      authenticated = true;
      setState({
        status: "signed_in",
        userId: user.id,
        email: user.email || null,
        otpStep: "email",
        requestedAt: null,
        cooldownUntil: null,
        expiresAt: null,
        otpEmail: "",
        failedAttempts: 0,
        busy: false,
        message: "",
      });
    });
    return activation;
  };

  const startAuth = async () => {
    if (started) return snapshot();
    started = true;
    if (!client) {
      unavailable(
        "Cloud sign-in isn't configured. Meal Rail still works locally.",
      );
      return snapshot();
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const changed = client.auth.onAuthStateChange((event, session) => {
        if (
          ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)
        ) {
          void activate(session);
        } else if (event === "SIGNED_OUT") {
          signedOut();
        }
      });
      subscription =
        changed?.data?.subscription || changed?.subscription || null;
      await activate(data.session);
    } catch {
      unavailable();
    }
    return snapshot();
  };

  const requestEmailOtp = async ({ email, captchaToken }) => {
    const normalizedEmail = email?.trim();
    if (!client || !normalizedEmail || !captchaToken || state.busy)
      return snapshot();
    if (state.cooldownUntil && clock() < state.cooldownUntil) return snapshot();
    const requestedAt = clock();
    setState({
      otpEmail: normalizedEmail,
      busy: true,
      cooldownUntil: requestedAt + OTP_RESEND_MS,
      requestedAt,
      message: "",
    });
    try {
      const { error } = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true, captchaToken },
      });
      if (error) throw error;
      setState({
        busy: false,
        otpStep: "code",
        expiresAt: requestedAt + OTP_EXPIRES_MS,
        failedAttempts: 0,
        message: SUCCESS_MESSAGE,
      });
    } catch (error) {
      const network = isNetworkError(error);
      setState({
        busy: false,
        otpStep: network ? "code" : "email",
        expiresAt: network ? requestedAt + OTP_EXPIRES_MS : null,
        failedAttempts: network ? 0 : state.failedAttempts,
        message: network ? REQUEST_NETWORK_ERROR : REQUEST_ERROR,
      });
    }
    return snapshot();
  };

  const verifyEmailOtp = async ({ email, token }) => {
    const normalizedEmail = email?.trim();
    const normalizedToken = token?.trim();
    if (!client || state.busy || state.otpStep !== "code") return snapshot();
    if (state.expiresAt && clock() >= state.expiresAt) {
      setState({ message: EXPIRED_ERROR });
      return snapshot();
    }
    if (state.failedAttempts >= OTP_MAX_ATTEMPTS) {
      setState({ message: ATTEMPTS_ERROR });
      return snapshot();
    }
    if (!normalizedEmail || !/^\d{6}$/.test(normalizedToken)) return snapshot();
    setState({ busy: true, message: "" });
    try {
      const { data, error } = await client.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedToken,
        type: "email",
      });
      if (error || !data?.session) throw error || new Error("No session");
      await activate(data.session);
    } catch {
      const attempts = state.failedAttempts + 1;
      setState({
        busy: false,
        failedAttempts: attempts,
        message: attempts >= OTP_MAX_ATTEMPTS ? ATTEMPTS_ERROR : CODE_ERROR,
      });
    }
    return snapshot();
  };

  const refreshAuthSession = async () => {
    if (!client) return snapshot();
    setState({ busy: true });
    try {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data?.session) throw error || new Error("No session");
      await activate(data.session);
    } catch {
      authenticated = false;
      setState({
        status: "auth_required",
        userId: null,
        email: null,
        busy: false,
        message:
          "Cloud sign-in needs your email code again. Meal Rail still works locally.",
      });
    }
    return snapshot();
  };

  const signOutDevice = async () => {
    if (!client || state.busy) return snapshot();
    setState({ busy: true, message: "" });
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      signedOut();
    } catch {
      setState({
        busy: false,
        message: "We couldn't sign out this device. Try again.",
      });
    }
    return snapshot();
  };

  return {
    startAuth,
    getAuthState: snapshot,
    subscribeAuth(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestEmailOtp,
    verifyEmailOtp,
    refreshAuthSession,
    signOutDevice,
    getAuthenticatedSupabase: () =>
      authenticated && state.status === "signed_in" ? client : null,
    destroy() {
      subscription?.unsubscribe?.();
      subscription = null;
      started = false;
    },
  };
}

const controller = createAuthController({ client: configuredClient() });

export const startAuth = () => controller.startAuth();
export const getAuthState = () => controller.getAuthState();
export const subscribeAuth = (listener) => controller.subscribeAuth(listener);
export const requestEmailOtp = (input) => controller.requestEmailOtp(input);
export const verifyEmailOtp = (input) => controller.verifyEmailOtp(input);
export const refreshAuthSession = () => controller.refreshAuthSession();
export const signOutDevice = () => controller.signOutDevice();
export const getAuthenticatedSupabase = () =>
  controller.getAuthenticatedSupabase();
