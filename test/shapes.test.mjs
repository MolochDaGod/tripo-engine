import test from "node:test";
import assert from "node:assert/strict";
import {
  imageToMultiviewBody,
  textureBody,
  textureImagesFromViews,
  multiviewFromTaskBody,
} from "../src/tripo.js";

test("image-to-multiview body is exactly one input string", () => {
  assert.deepEqual(imageToMultiviewBody("https://example.com/character.png"), {
    input: "https://example.com/character.png",
  });
  assert.deepEqual(imageToMultiviewBody("file_abc123"), { input: "file_abc123" });
  assert.throws(() => imageToMultiviewBody(""), /one string/);
  assert.throws(() => imageToMultiviewBody({ url: "https://example.com/a.png" }), /one string/);
});

test("texture images use view keys and require front plus one more", () => {
  const images = textureImagesFromViews({
    front_view_url: "https://cdn.tripo3d.ai/front.png",
    left_view_url: "https://cdn.tripo3d.ai/left.png",
    back_view_url: "https://cdn.tripo3d.ai/back.png",
    right_view_url: "https://cdn.tripo3d.ai/right.png",
  });
  assert.deepEqual(images, [
    { front: "https://cdn.tripo3d.ai/front.png" },
    { left: "https://cdn.tripo3d.ai/left.png" },
    { back: "https://cdn.tripo3d.ai/back.png" },
    { right: "https://cdn.tripo3d.ai/right.png" },
  ]);
  assert.throws(
    () => textureImagesFromViews({ left_view_url: "https://cdn.tripo3d.ai/left.png" }),
    /front/,
  );
});

test("texture body pins v3.5, delight on, and view-key images", () => {
  const body = textureBody({
    modelInput: "550e8400-e29b-41d4-a716-446655440000",
    views: {
      front_view_url: "https://cdn.tripo3d.ai/front.png",
      right_view_url: "https://cdn.tripo3d.ai/right.png",
    },
  });
  assert.equal(body.input, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(body.model, "v3.5-20260815");
  assert.equal(body.delight, true);
  assert.equal(body.texture_quality, "standard");
  assert.equal(body.pbr, true);
  assert.deepEqual(Object.keys(body.texture_prompt), ["images"]);
  assert.deepEqual(body.texture_prompt.images, [
    { front: "https://cdn.tripo3d.ai/front.png" },
    { right: "https://cdn.tripo3d.ai/right.png" },
  ]);
});

test("texture guidance is one of text, image, images, or none", () => {
  const bare = textureBody({ modelInput: "file_model" });
  assert.equal("texture_prompt" in bare, false);
  assert.equal(bare.delight, true);

  const text = textureBody({
    modelInput: "file_model",
    text: "worn leather with scratches",
    styleImage: "https://example.com/style.png",
    delight: false,
  });
  assert.deepEqual(text.texture_prompt, {
    text: "worn leather with scratches",
    style_image: { url: "https://example.com/style.png" },
  });
  assert.equal(text.delight, false);

  const image = textureBody({ modelInput: "file_model", image: "file_abc123", textureQuality: "extreme" });
  assert.deepEqual(image.texture_prompt, { image: "file_abc123" });
  assert.equal(image.texture_quality, "extreme");

  const positional = textureBody({
    modelInput: "file_model",
    model: "v3.0-20250812",
    positional: ["https://cdn.tripo3d.ai/front.png", null, "", "https://cdn.tripo3d.ai/right.png"],
  });
  assert.equal("delight" in positional, false);
  assert.deepEqual(positional.texture_prompt.images, [
    "https://cdn.tripo3d.ai/front.png",
    null,
    null,
    "https://cdn.tripo3d.ai/right.png",
  ]);

  assert.throws(
    () => textureBody({ modelInput: "file_model", text: "metal", views: { front_view_url: "https://a" } }),
    /mutually exclusive/,
  );
  assert.throws(
    () => textureBody({ modelInput: "file_model", model: "v2.5-20250123", textureQuality: "fast" }),
    /1004/,
  );
});

test("multiview-to-model reuses the image-to-multiview task id alone", () => {
  assert.deepEqual(multiviewFromTaskBody("123e4567-e89b-42d3-a456-426614174000"), {
    inputs: [{ task_id: "123e4567-e89b-42d3-a456-426614174000" }],
    model: "v3.1-20260211",
  });
});
