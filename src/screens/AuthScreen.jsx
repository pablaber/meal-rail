import { useEffect, useRef, useState } from "react";
import { signOutDevice, requestEmailOtp, verifyEmailOtp } from "../auth.js";
import { Turnstile } from "../components/Turnstile.jsx";
import { Screen } from "../components/Screen.jsx";
import { C, FONT } from "../theme.js";

const BUTTON =
  "w-full rounded-lg px-3 py-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50";

function remaining(until, now) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function AuthScreen({ auth, onBack }) {
  const [email, setEmail] = useState(auth.otpEmail || "");
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (auth.otpStep === "code") codeRef.current?.focus();
  }, [auth.otpStep]);
  useEffect(() => {
    if (auth.otpEmail) setEmail(auth.otpEmail);
  }, [auth.otpEmail]);
  useEffect(() => {
    setNow(Date.now());
  }, [auth.cooldownUntil, auth.expiresAt]);

  const cooling = auth.cooldownUntil && now < auth.cooldownUntil;
  const expired = auth.expiresAt && now >= auth.expiresAt;
  const actionableError =
    auth.message && !auth.message.startsWith("If that address");

  const cooldownText = cooling
    ? `You can request another code in ${remaining(auth.cooldownUntil, now)} seconds.`
    : "";

  return (
    <Screen>
      <header className="flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="Back"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.surface }}
        >
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <h1
            className="text-3xl leading-tight"
            style={{ fontFamily: FONT.display }}
          >
            Sync account
          </h1>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>
            Optional account for a future cloud sync. Your meal history stays on
            this device.
          </p>
        </div>
      </header>

      {auth.status === "signed_in" ? (
        <section className="mt-8">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Signed in
          </p>
          <p className="mt-3 break-words text-lg">{auth.email}</p>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            Signing out keeps this device's local meal history.
          </p>
          <button
            onClick={() => void signOutDevice()}
            disabled={auth.busy}
            className={`${BUTTON} mt-6`}
            style={{ background: C.surfaceHi, color: C.chalk }}
          >
            Sign out this device
          </button>
        </section>
      ) : auth.status === "unavailable" ? (
        <p
          role="alert"
          className="mt-8 text-sm"
          style={{ color: C.brass, fontFamily: FONT.mono }}
        >
          {auth.message ||
            "Cloud sign-in isn't configured. Meal Rail still works locally."}
        </p>
      ) : (
        <section className="mt-8">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void requestEmailOtp({ email, captchaToken }).finally(() => {
                setCaptchaToken("");
                setResetSignal((value) => value + 1);
              });
            }}
          >
            <label htmlFor="auth-email" className="block text-sm">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={auth.busy || auth.otpStep === "code"}
              className="mt-2 w-full rounded-lg px-3 py-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
              style={{ background: C.surfaceHi, color: C.chalk }}
            />
            {auth.otpStep === "email" && (
              <Turnstile onToken={setCaptchaToken} resetSignal={resetSignal} />
            )}
            {auth.otpStep === "email" && (
              <button
                type="submit"
                disabled={auth.busy || !captchaToken || cooling}
                className={`${BUTTON} mt-4`}
                style={{ background: C.done, color: C.ground }}
              >
                {cooling
                  ? `Request another code in ${remaining(auth.cooldownUntil, now)}s`
                  : "Email me a code"}
              </button>
            )}
            {cooldownText && (
              <p
                className="mt-3 text-xs"
                style={{ color: C.faintText, fontFamily: FONT.mono }}
                aria-live="polite"
              >
                {cooldownText}
              </p>
            )}
          </form>

          {auth.otpStep === "code" && (
            <>
              <form
                className="mt-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void verifyEmailOtp({ email, token: code });
                }}
              >
                <label htmlFor="auth-code" className="block text-sm">
                  Six-digit code
                </label>
                <input
                  ref={codeRef}
                  id="auth-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  disabled={auth.busy || expired || auth.failedAttempts >= 5}
                  className="mt-2 w-full rounded-lg px-3 py-3 text-base tracking-[0.35em] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
                  style={{ background: C.surfaceHi, color: C.chalk }}
                />
                <button
                  type="submit"
                  disabled={
                    auth.busy ||
                    expired ||
                    auth.failedAttempts >= 5 ||
                    code.length !== 6
                  }
                  className={`${BUTTON} mt-4`}
                  style={{ background: C.done, color: C.ground }}
                >
                  Verify code
                </button>
              </form>
              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestEmailOtp({ email, captchaToken }).finally(() => {
                    setCaptchaToken("");
                    setResetSignal((value) => value + 1);
                  });
                }}
              >
                <Turnstile
                  onToken={setCaptchaToken}
                  resetSignal={resetSignal}
                />
                <button
                  type="submit"
                  disabled={auth.busy || !captchaToken || cooling}
                  className={`${BUTTON} mt-2`}
                  style={{ background: C.surfaceHi, color: C.chalk }}
                >
                  {cooling
                    ? `Request another code in ${remaining(auth.cooldownUntil, now)}s`
                    : "Request a new code"}
                </button>
              </form>
            </>
          )}

          {auth.message && (
            <p
              className="mt-4 text-sm"
              style={{
                color: actionableError ? C.brass : C.faintText,
                fontFamily: FONT.mono,
              }}
              aria-live={actionableError ? undefined : "polite"}
              role={actionableError ? "alert" : undefined}
            >
              {auth.message}
            </p>
          )}
        </section>
      )}
    </Screen>
  );
}
