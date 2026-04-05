import assert from "node:assert/strict";
import test from "node:test";

import { roundSubmissionSchema } from "../src/lib/validators";

test("loss submissions require the hit cell to be one of the played cells", () => {
  assert.throws(
    () =>
      roundSubmissionSchema.parse({
        mineCount: 3,
        predictionCount: 2,
        predictedCells: [1, 2],
        playedCells: [1],
        result: "LOST",
        hitCell: 2,
        mineLocations: [2, 9, 10],
      }),
    /played predicted cells/,
  );
});
