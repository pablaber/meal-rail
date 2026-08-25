import assert from "node:assert/strict";
import test from "node:test";
import { createAuthController, OTP_EXPIRES_MS } from "../src/auth.js";

function fakeClient({
  session = null,
  requestError = null,
  verifyError = null,
} = {}) {
  const calls = { request: [], verify: [], signOut: [] };
  let handler;
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (next) => {
        handler = next;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithOtp: async (input) => {
        calls.request.push(input);
        return { error: requestError };
      },
      verifyOtp: async (input) => {
        calls.verify.push(input);
        return {
          data: verifyError
            ? { session: null }
            : { session: { user: { id: "user-1", email: input.email } } },
          error: verifyError,
        };
      },
      refreshSession: async () => ({
        data: { session: null },
        error: new Error("expired"),
      }),
      signOut: async (input) => {
        calls.signOut.push(input);
        return { error: null };
      },
      emit: (event, nextSession) => handler(event, nextSession),
    },
  };
}

async function started(options = {}) {
  const client = fakeClient(options);
  let clock = 1_000;
  const reconciled = [];
  const controller = createAuthController({
    client,
    clock: () => clock,
    reconcileIdentity: async (userId) => {
      reconciled.push(userId);
      return true;
    },
  });
  await controller.startAuth();
  return {
    client,
    controller,
    reconciled,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("requests OTPs with creation and CAPTCHA while hiding provider errors", async () => {
  const { client, controller } = await started();
  await controller.requestEmailOtp({
    email: " user@example.com ",
    captchaToken: "captcha",
  });
  assert.deepEqual(client.calls.request[0], {
    email: "user@example.com",
    options: { shouldCreateUser: true, captchaToken: "captcha" },
  });
  assert.equal(controller.getAuthState().otpStep, "code");

  const rejected = await started({
    requestError: new Error("User already registered"),
  });
  await rejected.controller.requestEmailOtp({
    email: "user@example.com",
    captchaToken: "captcha",
  });
  assert.equal(
    rejected.controller.getAuthState().message,
    "We couldn't send a code. Wait a minute and try again.",
  );
  assert.equal(rejected.controller.getAuthState().otpStep, "email");
});

test("resend cooldown and expiry prevent excess provider calls", async () => {
  const { client, controller, advance } = await started();
  await controller.requestEmailOtp({
    email: "user@example.com",
    captchaToken: "captcha",
  });
  await controller.requestEmailOtp({
    email: "user@example.com",
    captchaToken: "captcha",
  });
  assert.equal(client.calls.request.length, 1);
  advance(60_000);
  await controller.requestEmailOtp({
    email: "user@example.com",
    captchaToken: "captcha",
  });
  assert.equal(client.calls.request.length, 2);
  advance(OTP_EXPIRES_MS);
  assert.equal(
    controller.getAuthState().message,
    "That code has expired. Request a new one.",
  );
});

test("verification uses email OTP and locally caps rejected attempts", async () => {
  const { client, controller } = await started({
    verifyError: new Error("reused token"),
  });
  await controller.requestEmailOtp({
    email: "user@example.com",
    captchaToken: "captcha",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await controller.verifyEmailOtp({
      email: "user@example.com",
      token: "123456",
    });
  }
  assert.equal(client.calls.verify.length, 5);
  assert.equal(client.calls.verify[0].type, "email");
  assert.equal(
    controller.getAuthState().message,
    "Too many code attempts. Request a new code.",
  );
  await controller.verifyEmailOtp({
    email: "user@example.com",
    token: "123456",
  });
  assert.equal(client.calls.verify.length, 5);
});

test("session activation is gated by identity reconciliation and refresh failures require auth", async () => {
  const client = fakeClient({
    session: { user: { id: "user-1", email: "user@example.com" } },
  });
  const denied = createAuthController({
    client,
    reconcileIdentity: async () => false,
  });
  await denied.startAuth();
  assert.equal(denied.getAuthState().status, "unavailable");
  assert.equal(denied.getAuthenticatedSupabase(), null);

  const active = await started({
    session: { user: { id: "user-1", email: "user@example.com" } },
  });
  assert.equal(active.controller.getAuthState().status, "signed_in");
  assert.equal(active.controller.getAuthenticatedSupabase(), active.client);
  await active.controller.refreshAuthSession();
  assert.equal(active.controller.getAuthState().status, "auth_required");
});

test("sign out is local and does not call data mutation boundaries", async () => {
  const { client, controller } = await started({
    session: { user: { id: "user-1", email: "user@example.com" } },
  });
  await controller.signOutDevice();
  assert.deepEqual(client.calls.signOut, [{ scope: "local" }]);
  assert.equal(controller.getAuthState().status, "signed_out");
});
