import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeMath } from "../src/math.js";

test("tokenizes common inline and display math delimiters", () => {
  const input = String.raw`A $y_{t+1}$, \(x^2\), $$E=mc^2$$, and \[z=1\].`;
  const math = tokenizeMath(input).filter((token) => token.type === "math");
  assert.deepEqual(math.map(({ expression, displayMode }) => [expression, displayMode]), [
    ["y_{t+1}", false], ["x^2", false], ["E=mc^2", true], ["z=1", true],
  ]);
});

test("does not treat escaped currency or unclosed delimiters as math", () => {
  const input = String.raw`Cost \$5 and an unclosed $value.`;
  assert.deepEqual(tokenizeMath(input), [{ type: "text", value: input, start: 0, end: input.length }]);
});

test("keeps source offsets for noting selections", () => {
  const input = "before $x_1$ after";
  const math = tokenizeMath(input).find((token) => token.type === "math");
  assert.equal(input.slice(math.start, math.end), "$x_1$");
});
