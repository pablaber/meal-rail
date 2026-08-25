import { useEffect, useRef, useState } from "react";
import { C, FONT } from "../theme.js";

const SCRIPT_ID = "mealrail-turnstile";
let scriptPromise;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (window.turnstile) resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({ onToken, resetSignal }) {
  const container = useRef(null);
  const widgetId = useRef(null);
  const [problem, setProblem] = useState("");
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();

  useEffect(() => {
    if (!siteKey) {
      setProblem(
        "Cloud sign-in isn't configured. Meal Rail still works locally.",
      );
      return undefined;
    }
    let active = true;
    loadScript()
      .then(() => {
        if (!active || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          size: "flexible",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => {
        if (active)
          setProblem(
            "Cloud sign-in verification couldn't load. Meal Rail still works locally.",
          );
      });
    return () => {
      active = false;
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [onToken, siteKey]);

  useEffect(() => {
    if (widgetId.current !== null && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onToken("");
    }
  }, [onToken, resetSignal]);

  if (problem)
    return (
      <p
        role="alert"
        className="mt-4 text-xs"
        style={{ color: C.brass, fontFamily: FONT.mono }}
      >
        {problem}
      </p>
    );
  return (
    <div
      className="mt-4 min-h-16"
      ref={container}
      aria-label="Human verification"
    />
  );
}
