import test from "node:test";
import assert from "node:assert/strict";
import { threeWebArgs, styleArgs, redact, runTripo, parseDryRun } from "../src/pipeline.js";

test("three.js text plan is GLB params and never carries a key", () => {
  const args = threeWebArgs("a wooden crate");
  assert.equal(args[0], "make");
  assert.ok(args.includes("--dry-run"));
  assert.ok(args.includes("pbr=true"));
  assert.ok(args.includes("face_limit=20000"));
  assert.equal(args.includes("--for"), false);
  assert.equal(args.some((arg) => arg.startsWith("tsk_")), false);
  assert.throws(() => threeWebArgs("tsk_secret"), /command line/);
});

test("image and multiview inputs stay positional", () => {
  assert.deepEqual(threeWebArgs("hero.png").slice(0, 2), ["make", "hero.png"]);
  const views = threeWebArgs(["front.png", "left.png", "back.png", "right.png"]);
  assert.deepEqual(views.slice(1, 5), ["front.png", "left.png", "back.png", "right.png"]);
});

test("stylized texture prompt is one JSON object and delight stays off", () => {
  const args = styleArgs("task_example", { style: "stylized", text: "worn leather", styleImage: "https://example.com/style.png" });
  const prompt = args.find((arg) => arg.startsWith("texture_prompt="));
  assert.deepEqual(JSON.parse(prompt.slice("texture_prompt=".length)), {
    text: "worn leather",
    style_image: "https://example.com/style.png",
  });
  assert.ok(args.includes("delight=false"));
  assert.ok(args.includes("--texture-alignment"));
  assert.equal(args[args.indexOf("--texture-alignment") + 1], "original_image");
  assert.throws(() => styleArgs("task_example", { text: "a", image: "https://example.com/a.png" }), /mutually exclusive/);
});

test("realistic style delights for game lights", () => {
  const args = styleArgs("task_example", { style: "realistic" });
  assert.ok(args.includes("delight=true"));
  assert.equal(args[args.indexOf("--texture-alignment") + 1], "geometry");
  assert.equal(args.some((arg) => arg.startsWith("texture_prompt=")), false);
});

test("redact hides a key that leaks into CLI output", () => {
  assert.equal(redact("key tsk_abc123XYZ tail"), "key [redacted-key] tail");
});

test("official dry-run accepts the three.js text plan", async () => {
  const result = await runTripo(threeWebArgs("a wooden crate"));
  assert.equal(result.code, 0, result.stderr);
  const plan = parseDryRun(result.stdout);
  assert.equal(plan.valid, true);
  assert.equal(plan.model, "P2-20260801");
  assert.deepEqual(plan.deliverables, ["GLB"]);
  assert.equal(plan.steps[0].payload.pbr, true);
  assert.equal(plan.steps[0].payload.face_limit, 20000);
  assert.equal(plan.steps[0].endpoint, "/v3/generation/text-to-model");
});

test("official dry-run parses a stylized texture prompt as an object", async () => {
  const result = await runTripo(styleArgs("task_example", { style: "stylized", text: "worn leather" }));
  assert.equal(result.code, 0, result.stderr);
  const plan = parseDryRun(result.stdout);
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.steps[0].payload.texture_prompt, { text: "worn leather" });
  assert.equal(plan.steps[0].payload.delight, false);
  assert.equal(plan.steps[0].payload.model, "v3.5-20260815");
});
