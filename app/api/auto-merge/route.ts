import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { resolvePublicOrigin } from "@/lib/publicOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

const ENFUSE_PATH = "F:\\Enfuse\\bin\\enfuse.exe";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
]);

function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

function quoteArg(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function chunkHasSqiInName(filenames: string[]): boolean {
  return filenames.some((n) => n.toLowerCase().includes("_sqi"));
}

function getBaseNameForChunk(firstFilename: string): string {
  const stem = path.basename(firstFilename, path.extname(firstFilename));
  const withoutSqi = stem.replace(/_sqi$/i, "");
  const withoutIndex = withoutSqi.replace(/[_-]\d+$/i, "");
  const normalized = withoutIndex.trim().replace(/[<>:"/\\|?*]/g, "_");
  return normalized || "merged";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupComfyFinalFilename(params: {
  localFolderName: string;
  mergedFilename: string;
  baseName: string;
  bracketIndex: number;
}): Promise<void> {
  const { localFolderName, mergedFilename, baseName, bracketIndex } = params;
  const finalDir = path.join(PHOTOS_ROOT, localFolderName, "4_Final");
  const mergedStem = path.basename(mergedFilename, path.extname(mergedFilename));
  const comfyPrefix = `AI_${mergedStem}`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entries = await fs.promises.readdir(finalDir, { withFileTypes: true }).catch(() => []);
    const candidates = entries
      .filter((e) => e.isFile() && e.name.startsWith(comfyPrefix))
      .map((e) => e.name);

    if (candidates.length > 0) {
      const stats = await Promise.all(
        candidates.map(async (name) => {
          const fullPath = path.join(finalDir, name);
          const stat = await fs.promises.stat(fullPath);
          return { name, fullPath, mtimeMs: stat.mtimeMs };
        })
      );
      stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const newest = stats[0];
      const ext = path.extname(newest.name) || ".jpg";
      const cleanName = `${baseName}_${bracketIndex}${ext}`;
      const cleanPath = path.join(finalDir, cleanName);

      if (newest.fullPath.toLowerCase() === cleanPath.toLowerCase()) {
        return;
      }

      // Avoid rename failures when a previous run already produced the clean name.
      if (fs.existsSync(cleanPath)) {
        await fs.promises.unlink(cleanPath);
      }
      await fs.promises.rename(newest.fullPath, cleanPath);
      return;
    }

    await sleep(300);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      bracket_size?: number;
    };

    const localFolderName =
      typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";
    const bracketSize = Number(body.bracket_size);

    if (!localFolderName) {
      return NextResponse.json({ error: "local_folder_name is required." }, { status: 400 });
    }

    if (bracketSize !== 3 && bracketSize !== 5) {
      return NextResponse.json({ error: "bracket_size must be 3 or 5." }, { status: 400 });
    }

    const selectsDir = path.join(PHOTOS_ROOT, localFolderName, "2_Selects");
    const mergedDir = path.join(PHOTOS_ROOT, localFolderName, "3_Merged");

    if (!fs.existsSync(selectsDir)) {
      return NextResponse.json(
        { error: `Selects directory does not exist: ${selectsDir}` },
        { status: 400 }
      );
    }

    fs.mkdirSync(mergedDir, { recursive: true });

    const entries = fs.readdirSync(selectsDir, { withFileTypes: true });
    const imageFiles = entries
      .filter((e) => e.isFile() && isImageFile(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    const totalImages = imageFiles.length;

    if (totalImages % bracketSize !== 0) {
      return NextResponse.json(
        {
          error: `Mismatch Error: Found ${totalImages} photos in the Selects folder, which is not perfectly divisible by your bracket size of ${bracketSize}. Please check your folder.`,
        },
        { status: 400 }
      );
    }

    const groups: string[][] = [];
    for (let i = 0; i < imageFiles.length; i += bracketSize) {
      const chunk = imageFiles.slice(i, i + bracketSize);
      if (chunk.length === bracketSize) {
        groups.push(chunk);
      }
    }

    const outputs: string[] = [];
    const origin = resolvePublicOrigin(request);
    let bracketIndex = 1;
    let sqiAutoTriggerAttempts = 0;
    for (const group of groups) {
      if (group.length !== bracketSize) {
        continue;
      }
      const inputs = group.map((name) => path.join(selectsDir, name));
      const baseName = getBaseNameForChunk(group[0]);
      const hasSqi = chunkHasSqiInName(group);
      const outBaseName = `${baseName}_${bracketIndex}${hasSqi ? "_sqi" : ""}.jpg`;
      const outFile = path.join(mergedDir, outBaseName);
      const parts = [
        quoteArg(ENFUSE_PATH),
        "-o",
        quoteArg(outFile),
        ...inputs.map(quoteArg),
      ];
      const cmd = parts.join(" ");
      await execAsync(cmd, { windowsHide: true });
      outputs.push(outFile);
      if (hasSqi) {
        sqiAutoTriggerAttempts += 1;
        try {
          const aiRes = await fetch(`${origin}/api/ai-edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              local_folder_name: localFolderName,
              filename: path.basename(outFile),
            }),
          });
          const aiPayload = (await aiRes.json().catch(() => null)) as { error?: string } | null;
          if (!aiRes.ok) {
            console.error("[auto-merge] /api/ai-edit failed:", aiRes.status, aiPayload?.error ?? aiPayload);
          } else {
            try {
              await cleanupComfyFinalFilename({
                localFolderName,
                mergedFilename: path.basename(outFile),
                baseName,
                bracketIndex,
              });
            } catch (renameErr) {
              console.error("[auto-merge] Comfy output rename skipped:", renameErr);
            }
          }
        } catch (err) {
          console.error("[auto-merge] /api/ai-edit request error:", err);
        }
      }
      bracketIndex += 1;
    }

    return NextResponse.json({
      success: true,
      mergedCount: groups.length,
      outputPaths: outputs,
      selectsDir,
      mergedDir,
      totalImages,
      sqiAutoTriggerAttempts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Merge failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
