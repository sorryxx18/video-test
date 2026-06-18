declare const Bun: {
  serve: (config: {
    port: number;
    fetch: (req: Request) => Promise<Response> | Response;
  }) => { stop: () => void; port: number };
};

declare module "node:crypto" {
  export function createHmac(
    algorithm: string,
    key: string | Uint8Array,
  ): {
    update(data: string | Uint8Array): { digest(encoding: "base64" | "hex"): string };
    digest(encoding: "base64" | "hex"): string;
  };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function rm(
    path: string,
    options?: { force?: boolean; recursive?: boolean },
  ): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function basename(path: string): string;
}

declare module "node:child_process" {
  interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: "pipe" | "ignore" | Array<"pipe" | "ignore">;
  }

  interface ReadableStreamLike {
    on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
  }

  interface ChildProcessLike {
    stdout: ReadableStreamLike | null;
    stderr: ReadableStreamLike | null;
    killed: boolean;
    kill(signal?: string): boolean;
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
  }

  export function spawn(
    command: string,
    args?: string[],
    options?: SpawnOptions,
  ): ChildProcessLike;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

interface EnvConfig {
  port: number;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  lineUserId: string;
  pexelsApiKey: string;
  githubToken: string;
  githubRepo: string;
}

interface LineWebhookEventSource {
  type?: string;
  userId?: string;
}

interface LineMessageContentProvider {
  type?: string;
}

interface LineWebhookMessage {
  id?: string;
  type?: string;
  text?: string;
  contentProvider?: LineMessageContentProvider;
}

interface LineWebhookEvent {
  type?: string;
  replyToken?: string;
  source?: LineWebhookEventSource;
  message?: LineWebhookMessage;
}

interface LineWebhookBody {
  events: LineWebhookEvent[];
}

interface LineReplyMessage {
  type: "text";
  text: string;
}

interface LineReplyBody {
  replyToken: string;
  messages: LineReplyMessage[];
}

interface LineVideoMessage {
  type: "video";
  originalContentUrl: string;
  previewImageUrl: string;
}

interface LinePushBody {
  to: string;
  messages: (LineReplyMessage | LineVideoMessage)[];
}

interface CodexScriptSegment {
  text: string;
  query: string;
}

interface CodexScript {
  title: string;
  category: string;
  segments: CodexScriptSegment[];
}

interface SessionData {
  stage: "idle" | "awaiting_confirmation" | "rendering";
  scriptPath?: string;
  script?: CodexScript;
  imagePaths?: string[];
  updatedAt: number;
}

interface PendingImageEntry {
  path: string;
  createdAt: number;
}

interface PendingImageStore {
  images: PendingImageEntry[];
}

interface GhReleaseAsset {
  name: string;
  url: string;
}

interface GhReleaseView {
  assets: GhReleaseAsset[];
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
}

const PROJECT_DIR = "/Users/leifhuang/video-skill-remotion";
const TMP_ROOT = "/tmp/line-bot-images";
const SCRIPTS_ROOT = join(PROJECT_DIR, "scripts", "generated");
const OUTPUT_ROOT = join(PROJECT_DIR, "outputs");
const SESSION_ROOT = join(TMP_ROOT, "sessions");
const PENDING_WINDOW_MS = 10 * 60 * 1000;

let isRendering = false;

const env = loadEnvConfig();

function loadEnvConfig(): EnvConfig {
  const missing: string[] = [];
  const lineChannelSecret = process.env.LINE_CHANNEL_SECRET?.trim() ?? "";
  const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  const lineUserId = process.env.LINE_USER_ID?.trim() ?? "";
  const pexelsApiKey = process.env.PEXELS_API_KEY?.trim() ?? "";
  const githubToken = process.env.GITHUB_TOKEN?.trim() ?? "";
  const githubRepo = process.env.GITHUB_REPO?.trim() ?? "";

  if (!lineChannelSecret) {
    missing.push("LINE_CHANNEL_SECRET");
  }
  if (!lineChannelAccessToken) {
    missing.push("LINE_CHANNEL_ACCESS_TOKEN");
  }
  if (!lineUserId) {
    missing.push("LINE_USER_ID");
  }

  if (missing.length > 0) {
    console.error(`[startup] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const rawPort = process.env.PORT?.trim() ?? "3000";
  const port = Number.parseInt(rawPort, 10);

  return {
    port: Number.isFinite(port) ? port : 3000,
    lineChannelSecret,
    lineChannelAccessToken,
    lineUserId,
    pexelsApiKey,
    githubToken,
    githubRepo,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLineWebhookBody(value: unknown): value is LineWebhookBody {
  if (!isObject(value)) {
    return false;
  }
  if (!("events" in value)) {
    return false;
  }
  return Array.isArray(value.events);
}

function isCodexScriptSegment(value: unknown): value is CodexScriptSegment {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.text === "string" && typeof value.query === "string";
}

function isCodexScript(value: unknown): value is CodexScript {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    Array.isArray(value.segments) &&
    value.segments.every((segment) => isCodexScriptSegment(segment))
  );
}

function isGhReleaseAsset(value: unknown): value is GhReleaseAsset {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.name === "string" && typeof value.url === "string";
}

function isGhReleaseView(value: unknown): value is GhReleaseView {
  if (!isObject(value)) {
    return false;
  }
  return Array.isArray(value.assets) && value.assets.every((asset) => isGhReleaseAsset(asset));
}

function formatDurationMs(startMs: number): number {
  return Date.now() - startMs;
}

async function ensureDirectories(): Promise<void> {
  await mkdir(TMP_ROOT, { recursive: true });
  await mkdir(SCRIPTS_ROOT, { recursive: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(SESSION_ROOT, { recursive: true });
}

function sessionPathForUser(userId: string): string {
  return join(SESSION_ROOT, `${userId}.json`);
}

function pendingImageJsonPathForUser(userId: string): string {
  return join(TMP_ROOT, `${userId}.json`);
}

function createSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `video-${Date.now()}`;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2));
  await rename(tempPath, path);
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error(`[line] state read failed path=${path}`, error);
    return null;
  }
}

async function readSession(userId: string): Promise<SessionData | null> {
  const data = await readJsonFile(sessionPathForUser(userId));
  if (!isObject(data)) {
    return null;
  }
  if (
    data.stage !== "idle" &&
    data.stage !== "awaiting_confirmation" &&
    data.stage !== "rendering"
  ) {
    return null;
  }
  if (typeof data.updatedAt !== "number") {
    return null;
  }
  const script = "script" in data && data.script !== undefined ? data.script : undefined;
  const imagePaths = "imagePaths" in data && data.imagePaths !== undefined ? data.imagePaths : undefined;
  if (script !== undefined && !isCodexScript(script)) {
    return null;
  }
  if (imagePaths !== undefined && (!Array.isArray(imagePaths) || !imagePaths.every((p) => typeof p === "string"))) {
    return null;
  }
  return {
    stage: data.stage,
    scriptPath: typeof data.scriptPath === "string" ? data.scriptPath : undefined,
    script: script as CodexScript | undefined,
    imagePaths: imagePaths as string[] | undefined,
    updatedAt: data.updatedAt,
  };
}

async function writeSession(userId: string, session: SessionData): Promise<void> {
  await atomicWriteJson(sessionPathForUser(userId), session);
  console.log(`[session] session updated for user ${userId} stage=${session.stage}`);
}

async function clearSession(userId: string): Promise<void> {
  await rm(sessionPathForUser(userId), { force: true });
}

async function loadPendingImages(userId: string): Promise<PendingImageStore> {
  const path = pendingImageJsonPathForUser(userId);
  const data = await readJsonFile(path);
  const now = Date.now();
  const allEntries =
    isObject(data) && Array.isArray(data.images)
      ? data.images.filter(
          (entry): entry is PendingImageEntry =>
            isObject(entry) &&
            typeof entry.path === "string" &&
            typeof entry.createdAt === "number",
        )
      : [];

  const freshEntries: PendingImageEntry[] = [];
  const expiredEntries: PendingImageEntry[] = [];

  for (const entry of allEntries) {
    if (now - entry.createdAt > PENDING_WINDOW_MS) {
      expiredEntries.push(entry);
    } else {
      freshEntries.push(entry);
    }
  }

  for (const entry of expiredEntries) {
    await rm(entry.path, { force: true });
  }

  await atomicWriteJson(path, { images: freshEntries });
  return { images: freshEntries };
}

async function appendPendingImage(userId: string, entry: PendingImageEntry): Promise<void> {
  const pending = await loadPendingImages(userId);
  pending.images.push(entry);
  await atomicWriteJson(pendingImageJsonPathForUser(userId), pending);
}

async function takePendingImages(userId: string): Promise<string[]> {
  const pending = await loadPendingImages(userId);
  await atomicWriteJson(pendingImageJsonPathForUser(userId), { images: [] });
  return pending.images.map((entry) => entry.path);
}

function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) {
    return false;
  }
  const digest = createHmac("sha256", env.lineChannelSecret).update(rawBody).digest("base64");
  const signatureBuffer = Buffer.from(signature);
  const digestBuffer = Buffer.from(digest);
  if (signatureBuffer.length !== digestBuffer.length) {
    return false;
  }
  return timingSafeEqual(signatureBuffer, digestBuffer);
}

async function lineRequest(
  path: string,
  body: LineReplyBody | LinePushBody,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15_000);

  try {
    const response = await fetch(`https://api.line.me${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[line] API error status=${response.status} body=${errorBody}`);
      throw new Error(`[line] Request failed for ${path} with status ${response.status}`);
    }
  } catch (error) {
    console.error(`[line] Request failed for ${path}`, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function lineReply(replyToken: string, text: string): Promise<void> {
  await lineRequest("/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text }],
  });
}

async function linePush(text: string): Promise<void> {
  await lineRequest("/v2/bot/message/push", {
    to: env.lineUserId,
    messages: [{ type: "text", text }],
  });
}

async function linePushVideo(videoUrl: string, previewUrl: string): Promise<void> {
  await lineRequest("/v2/bot/message/push", {
    to: env.lineUserId,
    messages: [{ type: "video", originalContentUrl: videoUrl, previewImageUrl: previewUrl }],
  });
}

async function downloadLineImage(messageId: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15_000);

  try {
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: {
        Authorization: `Bearer ${env.lineChannelAccessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[line] image download error status=${response.status} body=${errorBody}`);
      throw new Error(`[line] Failed to download image ${messageId}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.error(`[line] Failed to download image ${messageId}`, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function collectStream(stream: { on(event: "data", listener: (chunk: string | Uint8Array) => void): void } | null, onChunk: (value: string) => void): void {
  if (!stream) {
    return;
  }
  stream.on("data", (chunk) => {
    onChunk(Buffer.from(chunk).toString("utf8"));
  });
}

async function runCommand(
  label: string,
  command: string,
  args: string[],
  timeoutMs: number,
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    let hardKillTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKillTimeout = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    }, timeoutMs);

    collectStream(child.stdout, (chunk) => {
      stdout += chunk;
    });
    collectStream(child.stderr, (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      if (hardKillTimeout) {
        clearTimeout(hardKillTimeout);
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      if (hardKillTimeout) {
        clearTimeout(hardKillTimeout);
      }
      const result: CommandResult = {
        stdout,
        stderr,
        exitCode: code ?? -1,
        signal,
        timedOut,
        durationMs: formatDurationMs(startedAt),
      };
      if (code === 0 && !timedOut) {
        resolve(result);
        return;
      }
      const error = new Error(
        `[${label}] command failed exit=${result.exitCode} signal=${result.signal} timedOut=${result.timedOut}\n${stderr || stdout}`,
      );
      reject(Object.assign(error, { result }));
    });
  });
}

function buildCodexPrompt(userText: string, imageCount: number): string {
  return [
    "請只輸出 JSON，不要 markdown，不要解釋。",
    "請產生適合短影音的繁體中文腳本 JSON，格式必須為：",
    '{ "title": "lowercase-slug", "category": "分類", "segments": [{"text":"繁體中文旁白","query":"english pexels keywords"}] }',
    "限制：",
    "- title 必須是小寫英文 slug，使用連字號",
    "- category 使用繁體中文，可含 emoji",
    "- segments 必須剛好 6 段",
    "- 每段 text 使用繁體中文，口吻自然、精簡、可配音",
    "- 每段 query 必須是英文 Pexels 搜尋詞",
    imageCount > 0 ? `- 已提供 ${imageCount} 張參考圖片，請納入腳本內容` : "- 沒有參考圖片",
    `使用者需求：${userText}`,
  ].join("\n");
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
  }
  return trimmed;
}

async function generateScript(userText: string, imagePaths: string[]): Promise<CodexScript> {
  const startedAt = Date.now();
  console.log(`[codex] start images=${imagePaths.length}`);
  const imageArgs = imagePaths.flatMap((imagePath) => ["-i", imagePath]);
  try {
    const result = await runCommand(
      "codex",
      "codex",
      ["exec", "--model", "o4-mini", ...imageArgs, buildCodexPrompt(userText, imagePaths.length)],
      120_000,
      { cwd: PROJECT_DIR, env: process.env as Record<string, string | undefined> },
    );
    console.log(`[codex] end durationMs=${result.durationMs}`);

    const cleaned = stripMarkdownFences(result.stdout);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned) as unknown;
    } catch (error) {
      console.error(`[codex] invalid JSON stdout=${result.stdout}`);
      throw error;
    }
    if (!isCodexScript(parsed)) {
      console.error(`[codex] invalid schema stdout=${result.stdout}`);
      throw new Error("[codex] Missing required title/category/segments fields");
    }
    return parsed;
  } catch (error) {
    console.error(`[codex] failed durationMs=${formatDurationMs(startedAt)}`, error);
    throw error;
  }
}

function buildScriptPreview(script: CodexScript): string {
  const lines = [
    `腳本已產生：${script.category}`,
    `標題：${script.title}`,
    "",
    ...script.segments.map((segment, index) => `${index + 1}. ${segment.text}`),
    "",
    "回覆「確認」開始渲染，或直接輸入新需求重新生成。",
  ];
  return lines.join("\n");
}

async function saveScriptForUser(userId: string, script: CodexScript): Promise<string> {
  const filename = `${createSlug(script.title)}-${Date.now()}.json`;
  const scriptPath = join(SCRIPTS_ROOT, filename);
  await atomicWriteJson(scriptPath, script);
  console.log(`[script] script saved path=${scriptPath} user=${userId}`);
  return scriptPath;
}

function buildReleaseTag(script: CodexScript): string {
  return `${createSlug(script.title)}-${Date.now()}`;
}

function findVideoUrlFromAssets(assets: GhReleaseAsset[], fileName: string): string | null {
  const match = assets.find((asset) => asset.name === basename(fileName));
  return match?.url ?? null;
}

async function uploadRelease(
  tag: string,
  title: string,
  videoPath: string,
  thumbnailPath: string,
): Promise<{ videoUrl: string; previewUrl: string }> {
  const startedAt = Date.now();
  console.log(`[gh] upload start tag=${tag}`);
  const ghEnv: Record<string, string | undefined> = {
    ...process.env,
    GH_TOKEN: env.githubToken,
  };
  const repoArgs = env.githubRepo ? ["--repo", env.githubRepo] : [];

  try {
    await runCommand(
      "gh",
      "gh",
      [
        "release",
        "create",
        tag,
        videoPath,
        thumbnailPath,
        "--title",
        title,
        "--notes",
        "Generated by LINE bot",
        "--prerelease",
        ...repoArgs,
      ],
      300_000,
      { cwd: PROJECT_DIR, env: ghEnv },
    );

    const releaseView = await runCommand(
      "gh",
      "gh",
      ["release", "view", tag, "--json", "assets", ...repoArgs],
      300_000,
      { cwd: PROJECT_DIR, env: ghEnv },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(releaseView.stdout) as unknown;
    } catch (error) {
      console.error(`[gh] invalid JSON stdout=${releaseView.stdout}`);
      throw error;
    }

    if (!isGhReleaseView(parsed)) {
      throw new Error("[gh] release view response missing assets");
    }

    const videoUrl = findVideoUrlFromAssets(parsed.assets, videoPath);
    if (!videoUrl) {
      throw new Error(`[gh] video asset not found for ${videoPath}`);
    }
    const previewUrl = findVideoUrlFromAssets(parsed.assets, thumbnailPath) ?? videoUrl;

    console.log(`[gh] upload end durationMs=${formatDurationMs(startedAt)}`);
    return { videoUrl, previewUrl };
  } catch (error) {
    console.error(`[gh] upload failed durationMs=${formatDurationMs(startedAt)}`, error);
    throw error;
  }
}

async function probeVideo(path: string): Promise<void> {
  try {
    await runCommand(
      "render",
      "ffmpeg",
      ["-v", "error", "-i", path, "-f", "null", "-"],
      120_000,
      { cwd: PROJECT_DIR, env: process.env as Record<string, string | undefined> },
    );
  } catch (error) {
    console.error("[render] ffmpeg probe failed", error);
    throw error;
  }
}

async function renderVideo(scriptPath: string, outputPath: string): Promise<void> {
  const startedAt = Date.now();
  console.log(`[render] start script=${scriptPath}`);
  try {
    await runCommand(
      "render",
      "python",
      ["render_video.py", "--script", scriptPath, "--output", outputPath],
      600_000,
      {
        cwd: PROJECT_DIR,
        env: {
          ...process.env,
          PEXELS_API_KEY: env.pexelsApiKey,
        } as Record<string, string | undefined>,
      },
    );
    // Compress if >50 MB so LINE can handle it
    const { stat } = await import("node:fs/promises");
    const { size } = await stat(outputPath);
    if (size > 52_428_800) {
      console.log(`[render] compressing size=${size}`);
      const compressed = outputPath.replace(".mp4", "_small.mp4");
      await runCommand(
        "render",
        "ffmpeg",
        ["-y", "-i", outputPath, "-vcodec", "libx264", "-crf", "28", "-preset", "fast", "-acodec", "aac", compressed],
        300_000,
        { cwd: PROJECT_DIR, env: process.env as Record<string, string | undefined> },
      );
      const { rename } = await import("node:fs/promises");
      await rename(compressed, outputPath);
      console.log("[render] compression done");
    }
    await probeVideo(outputPath);
    console.log(`[render] end durationMs=${formatDurationMs(startedAt)}`);
  } catch (error) {
    console.error(`[render] failed durationMs=${formatDurationMs(startedAt)}`, error);
    throw error;
  }
}

async function extractThumbnail(videoPath: string): Promise<string> {
  const thumbnailPath = videoPath.replace(".mp4", ".jpg");
  await runCommand(
    "render",
    "ffmpeg",
    ["-y", "-i", videoPath, "-vframes", "1", "-q:v", "2", thumbnailPath],
    60_000,
    { cwd: PROJECT_DIR, env: process.env as Record<string, string | undefined> },
  );
  return thumbnailPath;
}

async function cleanupFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    await rm(path, { force: true });
  }
  console.log(`[cleanup] cleanup done count=${paths.length}`);
}

async function handleImageMessage(userId: string, messageId: string, replyToken?: string): Promise<void> {
  try {
    const imageBytes = await downloadLineImage(messageId);
    const imagePath = join(TMP_ROOT, `${userId}-${Date.now()}-${messageId}.jpg`);
    await writeFile(imagePath, imageBytes);
    await appendPendingImage(userId, {
      path: imagePath,
      createdAt: Date.now(),
    });
    console.log(`[line] image saved user=${userId} path=${imagePath}`);
    if (replyToken) {
      await lineReply(replyToken, "已收到圖片，接著請傳送文字需求。");
    }
  } catch (error) {
    console.error("[line] handle image failed", error);
    await linePush("圖片處理失敗，請稍後再試。");
  }
}

function isConfirmText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "確認" || normalized === "ok" || normalized === "confirm" || normalized === "yes";
}

async function handleTextMessage(
  userId: string,
  text: string,
  replyToken?: string,
): Promise<void> {
  if (isRendering) {
    if (replyToken) {
      await lineReply(replyToken, "⏳ 渲染進行中，請稍候...");
    }
    return;
  }

  const session = await readSession(userId);
  if (session?.stage === "rendering") {
    if (replyToken) {
      await lineReply(replyToken, "⏳ 渲染進行中，請稍候...");
    }
    return;
  }

  if (replyToken) {
    await lineReply(replyToken, "已收到需求，開始處理。");
  }

  if (session?.stage === "awaiting_confirmation" && isConfirmText(text) && session.script && session.scriptPath) {
    void startRenderFlow(userId, session).catch((error) => {
      console.error("[render] fire-and-forget render flow failed", error);
      linePush("渲染流程失敗，請稍後再試。").catch((pushError) => {
        console.error("[line] failed to push render error", pushError);
      });
    });
    return;
  }

  void startScriptGenerationFlow(userId, text).catch((error) => {
    console.error("[codex] fire-and-forget script flow failed", error);
    linePush("腳本生成失敗，請稍後再試。").catch((pushError) => {
      console.error("[line] failed to push script error", pushError);
    });
  });
}

async function startScriptGenerationFlow(userId: string, text: string): Promise<void> {
  try {
    const imagePaths = await takePendingImages(userId);
    const script = await generateScript(text, imagePaths);
    const scriptPath = await saveScriptForUser(userId, script);
    await writeSession(userId, {
      stage: "awaiting_confirmation",
      scriptPath,
      script,
      imagePaths,
      updatedAt: Date.now(),
    });
    await linePush(buildScriptPreview(script));
  } catch (error) {
    console.error("[codex] script generation flow failed", error);
    throw error;
  }
}

async function startRenderFlow(userId: string, session: SessionData): Promise<void> {
  if (!session.script || !session.scriptPath) {
    await linePush("找不到待渲染腳本，請重新送出需求。");
    return;
  }

  if (isRendering) {
    await linePush("⏳ 渲染進行中，請稍候...");
    return;
  }

  isRendering = true;
  const outputPath = join(OUTPUT_ROOT, `${createSlug(session.script.title)}-${Date.now()}.mp4`);
  const releaseTag = buildReleaseTag(session.script);

  try {
    await writeSession(userId, {
      ...session,
      stage: "rendering",
      updatedAt: Date.now(),
    });
    console.log(`[render] render start user=${userId}`);
    await linePush("開始渲染影片，完成後會主動傳送連結。");
    await renderVideo(session.scriptPath, outputPath);
    const thumbnailPath = await extractThumbnail(outputPath);
    console.log(`[gh] upload start user=${userId}`);
    const { videoUrl, previewUrl } = await uploadRelease(
      releaseTag,
      session.script.title,
      outputPath,
      thumbnailPath,
    );
    console.log(`[line] video push url=${videoUrl}`);
    await linePushVideo(videoUrl, previewUrl);
    await clearSession(userId);
    await cleanupFiles([outputPath, thumbnailPath, ...(session.imagePaths ?? [])]);
  } catch (error) {
    console.error("[render] render flow failed", error);
    throw error;
  } finally {
    isRendering = false;
  }
}

async function processEvent(event: LineWebhookEvent): Promise<void> {
  const userId = event.source?.userId;
  console.log(`[webhook] webhook received event=${event.type ?? "unknown"} userId=${userId ?? "unknown"}`);

  if (!userId) {
    return;
  }

  if (event.type !== "message" || !event.message) {
    return;
  }

  if (event.message.type === "image" && event.message.id) {
    await handleImageMessage(userId, event.message.id, event.replyToken);
    return;
  }

  if (event.message.type === "text" && typeof event.message.text === "string") {
    await handleTextMessage(userId, event.message.text, event.replyToken);
  }
}

function okResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

await ensureDirectories();

const server = Bun.serve({
  port: env.port,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/webhook") {
      return okResponse(url.searchParams.get("hub.challenge") ?? "OK");
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-line-signature");
    if (!verifyLineSignature(rawBody, signature)) {
      return new Response("Forbidden", { status: 403 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch (error) {
      console.error("[line] invalid webhook JSON", error);
      return new Response("Bad Request", { status: 400 });
    }

    if (!isLineWebhookBody(parsedBody)) {
      return new Response("Bad Request", { status: 400 });
    }

    for (const event of parsedBody.events) {
      void processEvent(event).catch((error) => {
        console.error("[webhook] process event failed", error);
        linePush("處理訊息時發生錯誤，請稍後再試。").catch((pushError) => {
          console.error("[line] failed to push webhook error", pushError);
        });
      });
    }

    return okResponse("OK");
  },
});

console.log(`[startup] LINE bot server listening on port ${server.port}`);
