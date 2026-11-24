import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const TRIPO_BASE = "https://openapi.tripo3d.ai/v3";

const TERMINAL_FAIL = new Set(["failed", "cancelled", "banned", "expired"]);

function tripoConfigPath() {
  const root = process.env.TRIPO_HOME || path.join(homedir(), ".tripo");
  return path.join(root, "config.json");
}

/**
 * Key source, in order: TRIPO_API_KEY, then ~/.tripo/config.json.
 * The value is never included in errors.
 */
export async function loadApiKey() {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  const file = tripoConfigPath();
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error("No Tripo key. Finish `tripo login --region ov --no-wait`. The key stays in ~/.tripo/config.json.");
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error("Tripo config could not be read. Run tripo doctor.");
  }
  const profile = process.env.TRIPO_PROFILE || cfg.active_profile || "default";
  const key = cfg.profiles?.[profile]?.api_key || cfg.api_key;
  if (!key) {
    throw new Error(`No api_key for profile ${profile}. Finish tripo login. Do not paste the key into chat.`);
  }
  return key;
}

export async function requireApiKey() {
  return loadApiKey();
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function tripoFetch(pathname, { method = "GET", json, form } = {}) {
  const headers = { Authorization: `Bearer ${await requireApiKey()}` };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const response = await fetch(`${TRIPO_BASE}${pathname}`, { method, headers, body });
  const payload = await readJson(response);
  if (!response.ok || !payload || payload.code !== 0) {
    const detail = payload ? JSON.stringify(payload) : "";
    throw new Error(`Tripo ${method} ${pathname} failed: HTTP ${response.status} ${detail}`);
  }
  return payload.data;
}

/** POST /files. JPEG or PNG, max 20 MB. Returns file_token. */
export async function uploadImage(filePath) {
  const bytes = await readFile(filePath);
  if (bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("Tripo file upload max is 20 MB for images");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
    throw new Error("POST /files accepts JPEG or PNG. Pass a public WebP URL as input instead.");
  }
  const type = ext === ".png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), path.basename(filePath));
  const data = await tripoFetch("/files", { method: "POST", form });
  if (!data?.file_token) {
    throw new Error("Tripo POST /files did not return file_token");
  }
  return data.file_token;
}

export async function getTask(taskId) {
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("task_id is required");
  }
  return tripoFetch(`/tasks/${encodeURIComponent(taskId)}`);
}

/**
 * Poll GET /tasks/{task_id}. Doc interval is 1–2s, timeout about 5 minutes.
 * `unknown` is not terminal. `banned` and `expired` stop the poll.
 */
export async function waitForTask(taskId, { intervalMs = 2000, timeoutMs = 300_000 } = {}) {
  const start = Date.now();
  for (;;) {
    const task = await getTask(taskId);
    const status = task?.status;
    if (status === "success") {
      if (!task.output) throw new Error(`Task ${taskId} succeeded with no output`);
      return task;
    }
    if (TERMINAL_FAIL.has(status)) {
      const code = task.error_code != null ? ` code ${task.error_code}` : "";
      const message = task.error_message ? `: ${task.error_message}` : "";
      throw new Error(`Task ${taskId} ${status}${code}${message}`);
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Task ${taskId} timed out at status ${status ?? "unknown"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Body for POST /generation/image-to-multiview. Exactly one string input. */
export function imageToMultiviewBody(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("input must be one string: a file_token or a public image URL");
  }
  return { input };
}

export async function imageToMultiview(input, waitOpts) {
  const created = await tripoFetch("/generation/image-to-multiview", {
    method: "POST",
    json: imageToMultiviewBody(input),
  });
  if (!created?.task_id) {
    throw new Error("image-to-multiview did not return task_id");
  }
  const task = await waitForTask(created.task_id, waitOpts);
  const views = task.output?.generate_multiview_image;
  if (!views || typeof views !== "object") {
    throw new Error("success task missing output.generate_multiview_image");
  }
  return { taskId: created.task_id, type: task.type, views };
}

/** Texture model on POST /models/texture. v3.0 is accepted and run as v3.5. */
export const TEXTURE_MODEL_V35 = "v3.5-20260815";
export const TEXTURE_MODEL_V30 = "v3.0-20250812";
export const TEXTURE_MODEL_V25 = "v2.5-20250123";
const TEXTURE_QUALITIES = new Set(["fast", "standard", "detailed", "extreme"]);

/**
 * View-key texture_prompt.images from image-to-multiview URLs.
 * front is required. At least two views. Order does not matter.
 */
export function textureImagesFromViews(views) {
  if (!views || typeof views !== "object") {
    throw new Error("views object is required");
  }
  const slots = [
    ["front", views.front_view_url],
    ["left", views.left_view_url],
    ["back", views.back_view_url],
    ["right", views.right_view_url],
  ];
  const images = [];
  for (const [key, url] of slots) {
    if (typeof url === "string" && url.length > 0) images.push({ [key]: url });
  }
  const hasFront = images.some((item) => Object.hasOwn(item, "front"));
  if (!hasFront || images.length < 2) {
    throw new Error("texture images need front and at least one other view");
  }
  return images;
}

function styleImageRef(value) {
  if (typeof value === "string" && value.startsWith("file_")) return { file_token: value };
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return { url: value };
  if (value && typeof value === "object" && (value.url || value.file_token)) return value;
  throw new Error("style_image must be a URL, a file_token, or { url } / { file_token }");
}

/**
 * Body for POST /models/texture (Tripo Texture v3.5-20260815).
 * modelInput is one string: task_id, file_token, or a GLB/GLTF/FBX/OBJ/STL URL.
 * Guidance is optional and exclusive: text (+ optional style_image), image, or images.
 * Default pins v3.5 and delight true so a game gets a clean base color.
 * v3.0 omits delight unless set, which keeps the service default of false.
 */
export function textureBody({
  modelInput,
  views,
  positional,
  text,
  image,
  styleImage,
  textureQuality = "standard",
  pbr = true,
  model = TEXTURE_MODEL_V35,
  delight,
  textureAlignment,
  textureSeed,
  partNames,
  bake,
  compress,
} = {}) {
  if (typeof modelInput !== "string" || modelInput.length === 0) {
    throw new Error("model input must be one string: task_id, file_token, or model URL");
  }
  if (!TEXTURE_QUALITIES.has(textureQuality)) {
    throw new Error("texture_quality must be fast, standard, detailed, or extreme");
  }
  if (textureQuality === "fast" && model === TEXTURE_MODEL_V25) {
    throw new Error("texture_quality fast requires texture v3.5-20260815; v2.5 returns 1004");
  }
  const guidance = [views != null, positional != null, text != null, image != null].filter(Boolean);
  if (guidance.length > 1) {
    throw new Error("texture_prompt text, image, and images are mutually exclusive");
  }
  if (styleImage != null && text == null) {
    throw new Error("style_image is only valid with text");
  }
  if (textureAlignment != null && textureAlignment !== "original_image" && textureAlignment !== "geometry") {
    throw new Error("texture_alignment must be original_image or geometry");
  }
  if (compress != null && compress !== "geometry") {
    throw new Error("compress must be geometry");
  }

  const body = {
    input: modelInput,
    model,
    texture_quality: textureQuality,
    pbr,
  };

  if (model === TEXTURE_MODEL_V25) {
    if (delight != null) throw new Error("delight is read only by texture v3.5");
  } else if (delight != null) {
    body.delight = Boolean(delight);
  } else if (model === TEXTURE_MODEL_V35) {
    body.delight = true;
  }

  if (views != null) {
    body.texture_prompt = { images: textureImagesFromViews(views) };
  } else if (positional != null) {
    if (!Array.isArray(positional) || positional.length !== 4) {
      throw new Error("positional images are 4 slots: [front, left, back, right]");
    }
    const present = positional.filter((slot) => slot != null && slot !== "").length;
    if (positional[0] == null || positional[0] === "" || present < 2) {
      throw new Error("positional images need front and at least one other view");
    }
    body.texture_prompt = {
      images: positional.map((slot) => (slot == null || slot === "" ? null : slot)),
    };
  } else if (text != null) {
    if (typeof text !== "string" || text.length === 0) throw new Error("texture text must be a string");
    body.texture_prompt = { text };
    if (styleImage != null) body.texture_prompt.style_image = styleImageRef(styleImage);
  } else if (image != null) {
    if (typeof image !== "string" || image.length === 0) {
      throw new Error("texture image must be a file_token or URL string");
    }
    body.texture_prompt = { image };
  }

  if (textureAlignment != null) body.texture_alignment = textureAlignment;
  if (textureSeed != null) body.texture_seed = textureSeed;
  if (partNames != null) body.part_names = partNames;
  if (bake != null) body.bake = bake;
  if (compress != null) body.compress = compress;
  return body;
}

export async function textureModel(args, waitOpts) {
  const created = await tripoFetch("/models/texture", {
    method: "POST",
    json: textureBody(args),
  });
  if (!created?.task_id) throw new Error("models/texture did not return task_id");
  const task = await waitForTask(created.task_id, waitOpts);
  return {
    taskId: created.task_id,
    type: task.type,
    modelUrl: task.output?.model_url ?? null,
    renderedImageUrl: task.output?.rendered_image_url ?? null,
  };
}

/** multiview-to-model input that reuses an image_to_multiview task. */
export function multiviewFromTaskBody(taskId, model = "v3.1-20260211") {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("task_id is required");
  }
  return { inputs: [{ task_id: taskId }], model };
}
