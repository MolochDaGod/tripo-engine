import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execPath } from "node:process";

/** Three.js web delivery. GLB, P2, 20k faces, standard texture, PBR on. */
export const THREE_WEB = {
  texture: true,
  textureQuality: "standard",
  faceLimit: 20000,
  pbr: true,
  deliverable: "GLB",
  model: "P2-20260801",
};

/**
 * Texture stylization after a model exists.
 * realistic: delight on, maps follow the mesh (game lights).
 * stylized: delight off, maps follow the reference image.
 */
export const STYLES = {
  realistic: {
    model: "v3.5",
    delight: true,
    textureQuality: "standard",
    textureAlignment: "geometry",
    pbr: true,
  },
  stylized: {
    model: "v3.5",
    delight: false,
    textureQuality: "standard",
    textureAlignment: "original_image",
    pbr: true,
  },
};

const SECRET = /tsk_[A-Za-z0-9_-]+/;

export function redact(text) {
  return String(text).replace(SECRET, "[redacted-key]");
}

function assertClean(args) {
  for (const arg of args) {
    if (SECRET.test(arg)) {
      throw new Error("Refusing to put an API key on the Tripo command line.");
    }
  }
}

function asInputs(input) {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0 || list.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("input must be text, one image, 2–4 images, or a task id");
  }
  return list;
}

/**
 * `tripo make` argv. Dry-run is the default so a plan spends nothing.
 * No --for chain: game-mobile emits FBX and ar-web adds USDZ. Three.js takes the GLB.
 */
export function threeWebArgs(input, { pbr = true, faceLimit = THREE_WEB.faceLimit, textureQuality = THREE_WEB.textureQuality, dryRun = true, out, model } = {}) {
  const args = [
    "make",
    ...asInputs(input),
    "-p", "texture=true",
    "-p", `texture_quality=${textureQuality}`,
    "-p", `face_limit=${faceLimit}`,
    "-p", `pbr=${pbr ? "true" : "false"}`,
    "--json",
    "--yes",
  ];
  if (model) args.push("--model", model);
  if (out) args.push("-o", out);
  if (dryRun) args.push("--dry-run");
  assertClean(args);
  return args;
}

function texturePrompt({ text, image, styleImage }) {
  const modes = [text != null, image != null].filter(Boolean).length;
  if (modes > 1) throw new Error("texture_prompt text and image are mutually exclusive");
  if (styleImage != null && text == null) throw new Error("style_image is only valid with text");
  if (text == null && image == null && styleImage == null) return null;
  const prompt = {};
  if (text != null) prompt.text = text;
  if (styleImage != null) prompt.style_image = styleImage;
  if (image != null) prompt.image = image;
  return prompt;
}

/** `tripo model texture` argv. Dry-run is the default. */
export function styleArgs(input, { style = "realistic", text, image, styleImage, dryRun = true, out } = {}) {
  const chosen = STYLES[style];
  if (!chosen) throw new Error("style must be realistic or stylized");
  const source = asInputs(input);
  if (source.length !== 1) throw new Error("texture takes one model task, file, or URL");
  const prompt = texturePrompt({ text, image, styleImage });
  const args = [
    "model",
    "texture",
    source[0],
    "--model", chosen.model,
    "--texture-quality", chosen.textureQuality,
    "--texture-alignment", chosen.textureAlignment,
    "-p", `pbr=${chosen.pbr ? "true" : "false"}`,
    "-p", `delight=${chosen.delight ? "true" : "false"}`,
    "--json",
    "--yes",
  ];
  if (prompt) args.push("-p", `texture_prompt=${JSON.stringify(prompt)}`);
  if (out) args.push("-o", out);
  if (dryRun) args.push("--dry-run");
  assertClean(args);
  return args;
}

function tripoCommand(args) {
  const roots = [
    process.env.npm_config_prefix,
    path.join(homedir(), "npm-global"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
  ].filter(Boolean);
  for (const root of roots) {
    const script = path.join(root, "node_modules", "tripo-cli", "dist", "cli.js");
    if (existsSync(script)) return { command: execPath, args: [script, ...args], shell: false };
  }
  return {
    command: process.platform === "win32" ? "tripo.cmd" : "tripo",
    args,
    shell: process.platform === "win32",
  };
}

/** Run the official CLI. The key stays in the CLI store or TRIPO_API_KEY. It is not added here. */
export function runTripo(args, { cwd } = {}) {
  assertClean(args);
  const spec = tripoCommand(args);
  assertClean(spec.args);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd,
      shell: spec.shell,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    });
  });
}

export function parseDryRun(stdout) {
  const line = stdout.split(/\r?\n/).map((row) => row.trim()).find((row) => row.startsWith("{"));
  if (!line) throw new Error("tripo dry-run did not print a JSON plan");
  return JSON.parse(line);
}
