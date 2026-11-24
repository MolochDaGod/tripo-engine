import { imageToMultiview, uploadImage } from "./tripo.js";
import { access } from "node:fs/promises";
import { parseDryRun, runTripo, styleArgs, threeWebArgs } from "./pipeline.js";

const [command, ...rest] = process.argv.slice(2);

if (command === "plan-text" || command === "plan-image" || command === "plan-views") {
  const result = await runTripo(threeWebArgs(command === "plan-views" ? rest : rest.join(" ")));
  if (result.code !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.code);
  }
  console.log(JSON.stringify(parseDryRun(result.stdout), null, 2));
  process.exit(0);
}

if (command === "plan-style") {
  const [input, style = "realistic", text] = rest;
  if (!input) {
    console.error("usage: node src/cli.js plan-style <task-or-model> <realistic|stylized> [text]");
    process.exit(2);
  }
  const result = await runTripo(styleArgs(input, { style, text }));
  if (result.code !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.code);
  }
  console.log(JSON.stringify(parseDryRun(result.stdout), null, 2));
  process.exit(0);
}

const source = rest[0];
if (command !== "image-to-multiview" || !source) {
  console.error("usage: node src/cli.js plan-text|plan-image|plan-views|plan-style|image-to-multiview ...");
  process.exit(2);
}

let input = source;
try {
  await access(source);
  input = await uploadImage(source);
} catch (error) {
  if (error && error.code !== "ENOENT") throw error;
}

const result = await imageToMultiview(input);
console.log(JSON.stringify({ taskId: result.taskId, type: result.type, views: result.views }, null, 2));
