import { createClient } from "@supabase/supabase-js";

type SupabaseInstance = ReturnType<typeof createServerSupabase>;

export type PurgeResult = {
  ok: boolean;
  removedCount: number;
  buckets: string[];
  remainingCount?: number;
  remainingPaths?: string[];
  error?: string;
};

function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Recursively lists every object path under `prefix` in the given bucket.
 * Uses BFS so deeply-nested virtual folders are always visited.
 * Returns full storage paths (e.g. "localFolder/1_Raw/DSC001.jpg").
 */
async function listAllPathsUnderPrefix(
  supabase: SupabaseInstance,
  bucket: string,
  prefix: string
): Promise<string[]> {
  if (!supabase) return [];

  const queue: string[] = [prefix];
  const files: string[] = [];
  const PAGE_SIZE = 1000;

  while (queue.length > 0) {
    const current = queue.shift()!;
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(current, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        console.warn(`[purgeTaskStorage] list error in ${bucket}/${current}:`, error.message);
        break;
      }
      if (!data || data.length === 0) {
        break;
      }

      for (const entry of data) {
        if (!entry?.name || entry.name === ".emptyFolderPlaceholder") continue;

        // In Supabase Storage, virtual directories have id === null.
        // Be defensive: also treat entries with no metadata as potential folders.
        const fullPath = `${current}/${entry.name}`;
        const isVirtualFolder = !entry.id;

        if (isVirtualFolder) {
          queue.push(fullPath);
        } else {
          files.push(fullPath);
        }
      }

      if (data.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }
  }

  return files;
}

/** Attempts to remove all paths in a bucket, in batches of 100. Returns count of removed files. */
async function removePaths(
  supabase: SupabaseInstance,
  bucket: string,
  paths: string[]
): Promise<{ removed: number; failed: string[] }> {
  if (!supabase || paths.length === 0) return { removed: 0, failed: [] };

  let removed = 0;
  const failed: string[] = [];

  for (const batch of chunkArray(paths, 100)) {
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      console.warn(`[purgeTaskStorage] remove error in ${bucket}:`, error.message, "paths:", batch);
      failed.push(...batch);
    } else {
      removed += batch.length;
    }
  }

  return { removed, failed };
}

async function resolveTaskLocalFolderName(
  supabase: SupabaseInstance,
  taskId: string
): Promise<string> {
  if (!supabase) return "";
  const { data, error } = await supabase
    .from("tasks")
    .select("local_folder_name")
    .eq("id", taskId)
    .maybeSingle();
  if (error) return "";
  const localFolderName = (data as { local_folder_name?: unknown } | null)?.local_folder_name;
  return typeof localFolderName === "string" ? localFolderName.trim() : "";
}

/**
 * Purges all Supabase Storage objects associated with a task.
 *
 * Strategy:
 *  1. List all objects under every known prefix (task UUID + local folder name).
 *  2. Delete them in batches of 100.
 *  3. Re-scan for any survivors and attempt a second-pass deletion.
 *  4. Return the final count of any remaining objects so callers can decide
 *     whether to treat residual files as a hard error or a soft warning.
 *
 * `strict` (default false) is now advisory only — it no longer blocks callers.
 * The DELETE route always proceeds with the database deletion regardless of
 * whether a stray file was left behind, logging a warning instead.
 */
export async function purgeTaskStorage(
  taskId: string,
  options?: { strict?: boolean }
): Promise<PurgeResult> {
  void options; // strict is kept in the signature for backwards-compat but no longer blocks
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return { ok: true, removedCount: 0, buckets: [] };
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return {
      ok: false,
      removedCount: 0,
      buckets: [],
      error: "Supabase storage credentials are not configured.",
    };
  }

  const candidates = [
    process.env.SUPABASE_PREVIEWS_BUCKET?.trim() || "previews",
    process.env.SUPABASE_FINALS_BUCKET?.trim() || "finals",
    process.env.SUPABASE_RAW_TEMP_BUCKET?.trim() || "raw_temp",
  ]
    .map((b) => b.trim())
    .filter(Boolean);
  const buckets = Array.from(new Set(candidates));

  const localFolderName = await resolveTaskLocalFolderName(supabase, trimmedTaskId);
  const prefixes = Array.from(
    new Set(
      [trimmedTaskId, localFolderName]
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );

  let totalRemoved = 0;
  const allRemainingPaths: string[] = [];

  for (const bucket of buckets) {
    try {
      // Cover image lives at the bucket root, not under a folder prefix.
      const directFiles = bucket === "previews" ? [`cover_${trimmedTaskId}.jpg`] : [];

      // ── First pass: list → delete ────────────────────────────────────────
      const firstPassNested = (
        await Promise.all(prefixes.map((p) => listAllPathsUnderPrefix(supabase, bucket, p)))
      ).flat();
      const firstPassPaths = Array.from(new Set([...directFiles, ...firstPassNested]));

      const { removed: pass1Removed } = await removePaths(supabase, bucket, firstPassPaths);
      totalRemoved += pass1Removed;

      // ── Second pass: verify and retry any survivors ──────────────────────
      const secondPassNested = (
        await Promise.all(prefixes.map((p) => listAllPathsUnderPrefix(supabase, bucket, p)))
      ).flat();
      const secondPassDirect = bucket === "previews"
        ? await (async () => {
            // Check whether the cover image is still there.
            const coverPath = `cover_${trimmedTaskId}.jpg`;
            const parentDir = "";
            const { data } = await supabase.storage.from(bucket).list(parentDir, { limit: 1000 });
            return (data ?? []).some((e) => e.name === coverPath) ? [coverPath] : [];
          })()
        : [];
      const survivors = Array.from(new Set([...secondPassDirect, ...secondPassNested]));

      if (survivors.length > 0) {
        console.warn(
          `[purgeTaskStorage] ${survivors.length} file(s) survived first pass in bucket "${bucket}". Retrying…`,
          survivors
        );
        const { removed: pass2Removed } = await removePaths(supabase, bucket, survivors);
        totalRemoved += pass2Removed;

        // Final check — anything still left is logged as orphaned.
        const finalNestedPaths = (
          await Promise.all(prefixes.map((p) => listAllPathsUnderPrefix(supabase, bucket, p)))
        ).flat();
        if (finalNestedPaths.length > 0) {
          console.warn(
            `[purgeTaskStorage] ${finalNestedPaths.length} orphaned file(s) remain in bucket "${bucket}" for task ${trimmedTaskId}. Proceeding with DB deletion anyway.`,
            finalNestedPaths
          );
          allRemainingPaths.push(...finalNestedPaths);
        }
      }
    } catch (err) {
      console.error(
        `[purgeTaskStorage] Unexpected error purging bucket "${bucket}" for task ${trimmedTaskId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Always return ok:true so the caller can proceed with the DB row deletion.
  // Orphaned files are surfaced in remainingPaths/remainingCount for visibility.
  if (allRemainingPaths.length > 0) {
    return {
      ok: true,
      removedCount: totalRemoved,
      buckets,
      remainingCount: allRemainingPaths.length,
      remainingPaths: allRemainingPaths,
      error: `${allRemainingPaths.length} orphaned storage file(s) could not be removed. Task deleted anyway.`,
    };
  }

  return { ok: true, removedCount: totalRemoved, buckets, remainingCount: 0 };
}
