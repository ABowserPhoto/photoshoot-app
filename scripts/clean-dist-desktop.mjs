import fs from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDesktop = path.join(root, "dist-desktop");

for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    if (fs.existsSync(distDesktop)) {
      fs.rmSync(distDesktop, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    break;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (attempt === 5) {
      console.warn(
        `[clean-dist-desktop] Could not remove ${distDesktop} (${code ?? "unknown"}). Close Studio Workflow Suite / Explorer windows and retry.`
      );
      break;
    }
    await setTimeout(500);
  }
}
