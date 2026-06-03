import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { resolvePublicOrigin } from "@/lib/publicOrigin";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNS_HDR_PATH =
  process.env.SNSHDR_PATH?.trim() || "C:\\Program Files\\SNS-HDR Pro 2\\SNS-HDR.exe";
const SNS_HDR_PRESET = process.env.SNSHDR_PRESET?.trim() || "Hero_Interior";
const SNS_HDR_PRESET_PATH = process.env.SNSHDR_PRESET_PATH?.trim() || "";
const SNSHDR_TEMPLATE_PATH =
  process.env.SNSHDR_TEMPLATE_PATH?.trim() || path.join(process.cwd(), "lib", "comfy", "workflow_api.json");

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

function resolveSnsPresetArg(): string {
  const fromExplicitPath = SNS_HDR_PRESET_PATH.trim();
  if (fromExplicitPath) {
    return path.isAbsolute(fromExplicitPath)
      ? fromExplicitPath
      : path.resolve(process.cwd(), fromExplicitPath);
  }

  const presetValue = SNS_HDR_PRESET.trim();
  const looksLikePresetFile = /\.(xrs|prs)$/i.test(presetValue);
  if (!looksLikePresetFile) {
    return presetValue;
  }
  return path.isAbsolute(presetValue) ? presetValue : path.resolve(process.cwd(), presetValue);
}

type CommandRunResult = {
  stdout: string;
  stderr: string;
};

async function runCommandWithDiagnostics(
  command: string,
  args: string[],
  context: Record<string, unknown>
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      console.error("[auto-merge] merge command process error", {
        ...context,
        command,
        args,
        error: error.message,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
      reject(
        new Error(
          `Merge process failed to start: ${error.message}${
            stderr.trim() ? ` | stderr=${stderr.trim()}` : ""
          }`
        )
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      console.error("[auto-merge] merge command non-zero exit", {
        ...context,
        command,
        args,
        exitCode: code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
      reject(
        new Error(
          `Merge command failed (exit=${code ?? "null"}${signal ? `, signal=${signal}` : ""})${
            stderr.trim() ? ` | stderr=${stderr.trim()}` : ""
          }`
        )
      );
    });
  });
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
    const snsPreset = resolveSnsPresetArg();
    const templateExists = fs.existsSync(SNSHDR_TEMPLATE_PATH);
    console.info("[auto-merge] snsHDR template diagnostics", {
      templatePath: SNSHDR_TEMPLATE_PATH,
      templateExists,
      snsHdrPath: SNS_HDR_PATH,
      snsHdrExists: fs.existsSync(SNS_HDR_PATH),
      snsHdrPreset: snsPreset,
      snsHdrPresetExists: /\.(xrs|prs)$/i.test(snsPreset) ? fs.existsSync(snsPreset) : "n/a",
      localFolderName,
      bracketSize,
    });

    let bracketIndex = 1;
    let sqiAutoTriggerAttempts = 0;
    for (const group of groups) {
      if (group.length !== bracketSize) {
        continue;
      }
      try {
        const inputs = group.map((name) => path.join(selectsDir, name));
        const baseName = getBaseNameForChunk(group[0]);
        const hasSqi = chunkHasSqiInName(group);
        const outBaseName = `${baseName}_${bracketIndex}${hasSqi ? "_sqi" : ""}.jpg`;
        const outFile = path.join(mergedDir, outBaseName);
        const tempOutFile = path.join(
          mergedDir,
          `${baseName}_${bracketIndex}${hasSqi ? "_sqi" : ""}.__tmp_${Date.now()}_${Math.random()
            .toString(16)
            .slice(2)}.jpg`
        );
        const snsArgs = ["-preset", snsPreset, "-srgb", "-o", tempOutFile, ...inputs];
        const constructedCommandString = `${quoteArg(SNS_HDR_PATH)} ${snsArgs.map(quoteArg).join(" ")}`;
        console.log(`EXECUTING: ${constructedCommandString}`);
        await runCommandWithDiagnostics(
          SNS_HDR_PATH,
          snsArgs,
          {
            bracketIndex,
            localFolderName,
            outFile,
            tempOutFile,
            inputs,
            snsPreset,
            commandPreview: constructedCommandString,
          }
        );
        if (fs.existsSync(outFile)) {
          await fs.promises.unlink(outFile);
        }
        await fs.promises.rename(tempOutFile, outFile);
        outputs.push(outFile);
        if (hasSqi) {
          sqiAutoTriggerAttempts += 1;
          if (!templateExists) {
            const errorMessage = `snsHDR template not found at ${SNSHDR_TEMPLATE_PATH}`;
            console.error("[auto-merge] missing snsHDR template", {
              bracketIndex,
              localFolderName,
              outFile,
              templatePath: SNSHDR_TEMPLATE_PATH,
            });
            return NextResponse.json(
              {
                error: errorMessage,
                stage: "snshdr-template-check",
                bracketIndex,
                mergedFile: path.basename(outFile),
                outputPaths: outputs,
              },
              { status: 500 }
            );
          }
          try {
            const aiRes = await fetchWithTimeout(
              `${origin}/api/ai-edit`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  local_folder_name: localFolderName,
                  filename: path.basename(outFile),
                  snshdr_template_path: SNSHDR_TEMPLATE_PATH,
                }),
              },
              20_000
            );
            const aiPayload = (await aiRes.json().catch(() => null)) as { error?: string } | null;
            if (!aiRes.ok) {
              const aiError = aiPayload?.error ?? `HTTP ${aiRes.status}`;
              console.error("[auto-merge] /api/ai-edit failed", {
                bracketIndex,
                localFolderName,
                mergedFile: path.basename(outFile),
                status: aiRes.status,
                error: aiError,
                templatePath: SNSHDR_TEMPLATE_PATH,
              });
              return NextResponse.json(
                {
                  error: `snsHDR/ai-edit failed for ${path.basename(outFile)}: ${aiError}`,
                  stage: "ai-edit",
                  bracketIndex,
                  mergedFile: path.basename(outFile),
                  status: aiRes.status,
                  outputPaths: outputs,
                },
                { status: 502 }
              );
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
            const message = err instanceof Error ? err.message : "Unknown request error";
            console.error("[auto-merge] /api/ai-edit request error", {
              bracketIndex,
              localFolderName,
              mergedFile: path.basename(outFile),
              error: message,
              templatePath: SNSHDR_TEMPLATE_PATH,
            });
            return NextResponse.json(
              {
                error: `snsHDR/ai-edit request failed for ${path.basename(outFile)}: ${message}`,
                stage: "ai-edit-request",
                bracketIndex,
                mergedFile: path.basename(outFile),
                outputPaths: outputs,
              },
              { status: 502 }
            );
          }
        }
      } catch (loopError) {
        const loopMessage = loopError instanceof Error ? loopError.message : "Unknown merge loop error";
        console.error("[auto-merge] bracket loop failed", {
          bracketIndex,
          localFolderName,
          group,
          error: loopMessage,
        });
        return NextResponse.json(
          {
            error: `Merge failed on bracket ${bracketIndex}: ${loopMessage}`,
            stage: "merge-loop",
            bracketIndex,
            outputPaths: outputs,
            keepCurrentStatus: true,
          },
          { status: 500 }
        );
      } finally {
        bracketIndex += 1;
      }
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
