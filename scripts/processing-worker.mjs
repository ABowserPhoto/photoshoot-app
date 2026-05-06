import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { buildLocalFolderNameFromTask } from "./localFolderName.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const FOLDER_POLL_INTERVAL_MS = 15 * 1000;
const PROCESSING_POLL_INTERVAL_MS = 5 * 60 * 1000;

const AWAITING_FOLDER_STATUS = "awaiting_folder_creation";
const BOOKING_STATUS = "Booking";

const CLAIM_STATUS = "pending_processing";
const ACTIVE_STATUS = "Processing";
const DONE_STATUS = "Completed";
const ERROR_STATUS = "Selection Available";

const DEFAULT_PHOTOS_ROOT = "D:\\Photos_2026";

/**
 * Root for shoot folders.
 * We allow env configuration, but enforce that the effective root remains under D:\Photos_2026.
 */
function getShootFoldersRoot() {
  const fromBaseDir = process.env.BASE_DIR?.trim();
  const fromComfyInputDir = process.env.COMFYUI_INPUT_DIR?.trim();
  const configuredRoot = fromBaseDir || fromComfyInputDir || DEFAULT_PHOTOS_ROOT;

  const defaultResolved = path.resolve(DEFAULT_PHOTOS_ROOT);
  const configuredResolved = path.resolve(configuredRoot);
  const rel = path.relative(defaultResolved, configuredResolved);
  const isWithinDefaultRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!isWithinDefaultRoot) {
    console.warn(
      `[worker] Ignoring BASE_DIR/COMFYUI_INPUT_DIR="${configuredRoot}" because local task folders must stay under ${DEFAULT_PHOTOS_ROOT}.`
    );
    return DEFAULT_PHOTOS_ROOT;
  }

  return configuredResolved;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseClient() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function claimTask(supabase, taskId) {
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: ACTIVE_STATUS })
    .eq("id", taskId)
    .eq("status", CLAIM_STATUS)
    .select("id")
    .limit(1);

  if (error) {
    throw new Error(`Failed to claim task ${taskId}: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

async function processTaskLocally(task) {
  const localOrigin = process.env.LOCAL_APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  const workerSecret = requiredEnv("LOCAL_WORKER_SECRET");
  const url = `${localOrigin.replace(/\/$/, "")}/api/worker/process-task`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": workerSecret,
    },
    body: JSON.stringify({
      taskId: String(task.id),
      local_folder_name: task.local_folder_name,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message =
      payload?.error || `Local processing failed for task ${task.id} (HTTP ${response.status}).`;
    throw new Error(message);
  }
}

async function finalizeTask(supabase, taskId, status) {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) {
    throw new Error(`Failed to set status ${status} for task ${taskId}: ${error.message}`);
  }
}

/**
 * Creates `1_Raw` … `4_Final` under D:\Photos_2026 (effective root), then sets status to Booking.
 */
async function processAwaitingFolderCreation(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, company_name, shoot_location, photoshoot_date")
    .eq("status", AWAITING_FOLDER_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Folder queue poll failed: ${error.message}`);
  }

  const queue = data ?? [];
  if (queue.length === 0) {
    return;
  }

  console.info(`[worker] Found ${queue.length} task(s) awaiting local folder creation.`);
  const root = getShootFoldersRoot();

  for (const row of queue) {
    const taskId = String(row.id);
    try {
      const folderName = buildLocalFolderNameFromTask(row);
      const base = path.join(root, folderName);

      for (const sub of ["1_Raw", "2_Selects", "3_Merged", "4_Final"]) {
        fs.mkdirSync(path.join(base, sub), { recursive: true });
      }

      const { error: updateError } = await supabase
        .from("tasks")
        .update({ local_folder_name: folderName, status: BOOKING_STATUS })
        .eq("id", taskId)
        .eq("status", AWAITING_FOLDER_STATUS);

      if (updateError) {
        console.error(`[worker] Could not save folder name for task ${taskId}:`, updateError.message);
        continue;
      }

      console.info(`[worker] Created shoot folders for task ${taskId} under ${base}`);
    } catch (err) {
      console.error(`[worker] Folder creation failed for task ${taskId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function processPendingProcessing(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, local_folder_name, status")
    .eq("status", CLAIM_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Polling failed: ${error.message}`);
  }

  const queue = data ?? [];
  if (queue.length === 0) {
    console.info(`[worker] No ${CLAIM_STATUS} tasks found.`);
    return;
  }

  console.info(`[worker] Found ${queue.length} queued task(s).`);
  for (const task of queue) {
    const taskId = String(task.id);
    const localFolderName = String(task.local_folder_name ?? "").trim();
    if (!localFolderName) {
      console.warn(`[worker] Skipping task ${taskId}: missing local_folder_name.`);
      continue;
    }

    try {
      const claimed = await claimTask(supabase, taskId);
      if (!claimed) {
        console.info(`[worker] Task ${taskId} already claimed by another worker.`);
        continue;
      }

      console.info(`[worker] Processing task ${taskId}...`);
      await processTaskLocally({ id: taskId, local_folder_name: localFolderName });
      await finalizeTask(supabase, taskId, DONE_STATUS);
      console.info(`[worker] Task ${taskId} completed.`);
    } catch (err) {
      console.error(`[worker] Task ${taskId} failed:`, err instanceof Error ? err.message : err);
      try {
        await finalizeTask(supabase, taskId, ERROR_STATUS);
      } catch (statusErr) {
        console.error(
          `[worker] Could not set fallback status for ${taskId}:`,
          statusErr instanceof Error ? statusErr.message : statusErr
        );
      }
    }
  }
}

async function main() {
  console.info("[worker] Starting processing worker...");
  console.info(`[worker] Shoot folders root: ${getShootFoldersRoot()}`);

  await processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial folder run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
      console.error("[worker] Folder poll failed:", err instanceof Error ? err.message : err);
    });
  }, FOLDER_POLL_INTERVAL_MS);

  await processPendingProcessing(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial processing run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void processPendingProcessing(getSupabaseClient()).catch((err) => {
      console.error("[worker] Processing poll failed:", err instanceof Error ? err.message : err);
    });
  }, PROCESSING_POLL_INTERVAL_MS);
}

void main();
