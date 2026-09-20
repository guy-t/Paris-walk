/**
 * Copy the native web build into the Capacitor project.
 *
 * Capacitor wants its web assets inside its own project directory, and the
 * native build differs from the web one only in its base path (relative, so
 * the files resolve from the device rather than from a path on a domain).
 * Keeping the copy explicit means the app can never be shipped with the
 * GitHub Pages build by accident, which would point every asset at a URL the
 * phone may have no signal to reach.
 */
import { cp, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../web/dist-native");
const to = resolve(here, "../www");

try {
  await stat(from);
} catch {
  console.error(
    `No native web build at ${from}.\nRun: pnpm --filter @slownav/web build:native`,
  );
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`Copied web build -> ${to}`);
