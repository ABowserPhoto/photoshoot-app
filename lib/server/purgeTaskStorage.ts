import { createClient } from "@supabase/supabase-js";

type PurgeResult = {
  ok: boolean;
  removedCount: number;
  buckets: string[];
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

async function listAllPathsUnderPrefix(
  supabase: ReturnType<typeof createServerSupabase>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  if (!supabase) return [];
  const queue = [prefix];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const { data, error } = await supabase.storage.from(bucket).list(current, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !data) {
      continue;
    }
    for (const entry of data) {
      if (!entry?.name) continue;
      const fullPath = `${current}/${entry.name}`;
      const isFolder = !entry.id;
      if (isFolder) {
        queue.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function resolveTaskLocalFolderName(
  supabase: ReturnType<typeof createServerSupabase>,
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

export async function purgeTaskStorage(taskId: string): Promise<PurgeResult> {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return { ok: true, removedCount: 0, buckets: [] };
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return { ok: false, removedCount: 0, buckets: [] };
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
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  let removedCount = 0;

  for (const bucket of buckets) {
    try {
      const directFiles = bucket === "previews" ? [`cover_${trimmedTaskId}.jpg`] : [];
      const nestedPaths = (
        await Promise.all(prefixes.map((prefix) => listAllPathsUnderPrefix(supabase, bucket, prefix)))
      ).flat();
      const paths = Array.from(new Set([...directFiles, ...nestedPaths]));
      if (paths.length === 0) {
        continue;
      }
      for (const batch of chunkArray(paths, 100)) {
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (!error) {
          removedCount += batch.length;
        }
      }
    } catch {
      // Silent fail by design for already-empty/missing paths.
    }
  }

  return { ok: true, removedCount, buckets };
}

