import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const envFile = ".env";
const localConfig = "supabase/config.toml";
const productionConfig = "supabase/config.production.toml";
const required = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_ID",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "SMTP_SENDER_EMAIL",
];

if (!existsSync(envFile)) {
  throw new Error(
    `Missing ${envFile}. Copy .env.example and fill its production values.`,
  );
}
process.loadEnvFile(envFile);

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing required environment values: ${missing.join(", ")}`);
}

const rendered = readFileSync(productionConfig, "utf8");
if (
  !rendered.includes('site_url = "https://pablaber.github.io/meal-rail/"') ||
  !rendered.includes('secret = "env(TURNSTILE_SECRET_KEY)"') ||
  !rendered.includes('pass = "env(RESEND_API_KEY)"')
) {
  throw new Error(
    "Production Supabase config is missing its required Auth settings.",
  );
}

const backupDirectory = mkdtempSync(join(tmpdir(), "meal-rail-supabase-"));
const backup = join(backupDirectory, "config.toml");
copyFileSync(localConfig, backup);

try {
  writeFileSync(localConfig, rendered);
  execFileSync(
    "npx",
    [
      "supabase",
      "config",
      "push",
      "--project-ref",
      process.env.SUPABASE_PROJECT_ID,
    ],
    { stdio: "inherit", env: process.env },
  );
} finally {
  copyFileSync(backup, localConfig);
  rmSync(backupDirectory, { recursive: true, force: true });
}
