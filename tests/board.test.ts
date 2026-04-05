import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCells, parseCells, serializeCells } from "../src/lib/board";

test("normalizeCells sorts, deduplicates, and drops invalid cells", () => {
  assert.deepEqual(normalizeCells([5, 2, 2, 99, -1, 1, 5]), [1, 2, 5]);
});

test("serializeCells and parseCells round-trip normalized values", () => {
  const serialized = serializeCells([5, 2, 2, 1]);

  assert.equal(serialized, "[1,2,5]");
  assert.deepEqual(parseCells(serialized), [1, 2, 5]);
});

test("parseCells returns an empty array for invalid payloads", () => {
  assert.deepEqual(parseCells("not json"), []);
  assert.deepEqual(parseCells('{"bad":true}'), []);
});
