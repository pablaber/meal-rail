import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
const url = status.API_URL || status.api_url;
const key = status.PUBLISHABLE_KEY || status.ANON_KEY || status.anon_key;
if (!url || !key)
  throw new Error("Local Supabase URL or publishable key is unavailable");

const local = `mealrail-auth-${Date.now()}`;
const email = `${local}@example.com`;
const storage = new Map();
const adapter = {
  getItem: (name) => storage.get(name) || null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};
const client = createClient(url, key, {
  auth: { storage: adapter, persistSession: true, detectSessionInUrl: false },
});
const request = await client.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: true, captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
});
assert.equal(request.error, null);

const mailboxResponse = await globalThis.fetch(
  `http://127.0.0.1:54324/api/v1/mailbox/${local}`,
);
let mailbox;
if (mailboxResponse.ok) {
  mailbox = await mailboxResponse.json();
} else {
  const allMessages = await globalThis
    .fetch("http://127.0.0.1:54324/api/v1/messages")
    .then((response) => response.json());
  mailbox = allMessages.messages.filter((entry) =>
    entry.To?.some((recipient) => recipient.Address === email),
  );
}
assert.ok(mailbox.length, "Local mail service did not receive the OTP email");
const message = await globalThis
  .fetch(
    `http://127.0.0.1:54324/api/v1/message/${mailbox[0].id || mailbox[0].ID}`,
  )
  .then((response) => response.json());
const token = /\b(\d{6})\b/.exec(
  message.text || message.Text || message.html || message.HTML || "",
)?.[1];
assert.ok(token, "OTP email did not contain a six-digit code");

const wrong = await client.auth.verifyOtp({
  email,
  token: "000000",
  type: "email",
});
assert.ok(wrong.error);
const verified = await client.auth.verifyOtp({ email, token, type: "email" });
assert.equal(verified.error, null);
assert.ok(verified.data.session);

const restored = createClient(url, key, {
  auth: { storage: adapter, persistSession: true, detectSessionInUrl: false },
});
const recovered = await restored.auth.getSession();
assert.equal(recovered.error, null);
assert.equal(recovered.data.session?.user.email, email);
const reused = await client.auth.verifyOtp({ email, token, type: "email" });
assert.ok(reused.error);
