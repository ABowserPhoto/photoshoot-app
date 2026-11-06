import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

/** Default fail-safe for RawTherapee / SNS-HDR bracket processing. */
export const DEFAULT_CLI_TIMEOUT_MS = 15 * 60 * 1000;

export type CliRunResult = {
  stdout: string;
  stderr: string;
};

export class CliProcessError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(
    message: string,
    details: { stdout: string; stderr: string; exitCode: number | null }
  ) {
    super(message);
    this.name = "CliProcessError";
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.exitCode = details.exitCode;
  }
}

export type SpawnCliOptions = {
  timeoutMs?: number;
  context?: Record<string, unknown>;
  logPrefix?: string;
  /** When false, skip existsSync (e.g. `cmd.exe` on PATH). Default true. */
  verifyExists?: boolean;
  envVar?: string;
  label?: string;
  /** Written to stdin then closed. Used to answer overwrite prompts (`y`). */
  stdinText?: string;
  /** Log the child stderr with `Merge CLI Error` when the process fails. */
  emitMergeCliError?: boolean;
};

export function assertCliExecutableExists(
  executablePath: string,
  options?: { envVar?: string; label?: string }
): void {
  const resolved = executablePath.trim();
  const label = options?.label ?? (path.basename(resolved) || "CLI executable");
  if (!resolved) {
    throw new Error(
      `${label} path is empty${options?.envVar ? ` — set ${options.envVar} in your environment` : ""}.`
    );
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `${label} not found at ${resolved}${
        options?.envVar ? ` — check ${options.envVar} in .env.local` : ""
      }.`
    );
  }
}

function logStreamLines(logPrefix: string, stream: "stdout" | "stderr", chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    console.log(`${logPrefix} ${stream}:`, line);
  }
}

/**
 * Spawn a CLI process with real-time logging, existsSync guard, error/close handling,
 * and a fail-safe timeout that kills the child if it runs too long.
 */
export function spawnCliWithDiagnostics(
  command: string,
  args: string[],
  options: SpawnCliOptions = {}
): Promise<CliRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const logPrefix = options.logPrefix ?? "[CLI]";
  const verifyExists = options.verifyExists !== false;

  if (verifyExists) {
    assertCliExecutableExists(command, {
      envVar: options.envVar,
      label: options.label ?? path.basename(command),
    });
  }

  console.log(`${logPrefix} Spawning command:`, command, args.join(" "));

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child: ChildProcess | null = null;
    let timer: NodeJS.Timeout | null = null;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn();
    };

    const killChild = () => {
      if (!child?.pid) {
        return;
      }
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    };

    const writeStdin = typeof options.stdinText === "string";
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: [writeStdin ? "pipe" : "ignore", "pipe", "pipe"],
      });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      if (options.emitMergeCliError) {
        console.error("Merge CLI Error:", message);
      }
      reject(
        new CliProcessError(`CLI failed to spawn (${command}): ${message}`, {
          stdout: "",
          stderr: message,
          exitCode: null,
        })
      );
      return;
    }

    if (writeStdin && child.stdin) {
      child.stdin.write(options.stdinText ?? "");
      child.stdin.end();
    }

    console.log(`${logPrefix} Process started (pid=${child.pid ?? "unknown"})`);

    timer = setTimeout(() => {
      console.error(`${logPrefix} Timeout after ${timeoutMs}ms`, {
        command,
        args,
        pid: child?.pid ?? null,
        ...(options.context ?? {}),
      });
      if (options.emitMergeCliError) {
        console.error("Merge CLI Error:", stderr);
      }
      killChild();
      settle(() =>
        reject(
          new CliProcessError(
            `CLI timed out after ${Math.round(timeoutMs / 1000)}s: ${command} ${args.join(" ")}${
              stderr.trim() ? ` | stderr=${stderr.trim().slice(0, 4000)}` : ""
            }`,
            { stdout, stderr, exitCode: null }
          )
        )
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      stdout += text;
      logStreamLines(logPrefix, "stdout", text);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      stderr += text;
      logStreamLines(logPrefix, "stderr", text);
    });

    child.on("error", (error) => {
      console.error(`${logPrefix} Process error`, {
        command,
        args,
        error: error.message,
        ...(options.context ?? {}),
      });
      const combinedStderr = [stderr, error.message].filter((part) => part.trim()).join("\n");
      if (options.emitMergeCliError) {
        console.error("Merge CLI Error:", combinedStderr);
      }
      settle(() =>
        reject(
          new CliProcessError(
            `CLI failed to start (${command}): ${error.message}${
              stderr.trim() ? ` | stderr=${stderr.trim().slice(0, 4000)}` : ""
            }`,
            { stdout, stderr: combinedStderr, exitCode: null }
          )
        )
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        console.log(`${logPrefix} Completed successfully (exit 0, pid=${child?.pid ?? "unknown"})`);
        settle(() => resolve({ stdout, stderr }));
        return;
      }
      console.error(`${logPrefix} Non-zero exit`, {
        command,
        args,
        exitCode: code,
        signal,
        ...(options.context ?? {}),
      });
      if (options.emitMergeCliError) {
        console.error("Merge CLI Error:", stderr);
      }
      settle(() =>
        reject(
          new CliProcessError(
            `CLI failed (exit=${code ?? "null"}${signal ? `, signal=${signal}` : ""}): ${command}${
              stderr.trim() ? ` | stderr=${stderr.trim().slice(0, 4000)}` : ""
            }`,
            { stdout, stderr, exitCode: code }
          )
        )
      );
    });
  });
}
