import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("starts zoom observation after its module-scoped state is initialized", async () => {
  const source = await readFile(new URL("../src/viewer.js", import.meta.url), "utf8");
  const stateDeclaration = source.indexOf("let resolutionMediaQuery = null;");
  const startupCall = source.lastIndexOf("\nwatchDevicePixelRatio();");

  assert.ok(stateDeclaration >= 0, "resolution media-query state must exist");
  assert.ok(startupCall > stateDeclaration, "zoom observation must start outside the temporal dead zone");
});
