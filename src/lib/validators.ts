import { z } from "zod";

import { BOARD_CELL_COUNT, isSubset, normalizeCells } from "@/lib/board";

function cellArraySchema(minimumCount = 0) {
  const schema = z.array(z.number().int().min(1).max(BOARD_CELL_COUNT));

  return (minimumCount > 0 ? schema.min(minimumCount) : schema).transform((cells) => normalizeCells(cells));
}

export const predictionQuerySchema = z
  .object({
    mineCount: z.coerce.number().int().min(1).max(BOARD_CELL_COUNT - 1),
    predictionCount: z.coerce.number().int().min(1).max(BOARD_CELL_COUNT - 1),
  })
  .superRefine((value, context) => {
    if (value.predictionCount > BOARD_CELL_COUNT - value.mineCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predictionCount"],
        message: "Prediction count must stay below the number of safe cells.",
      });
    }
  });

export const roundSubmissionSchema = z
  .object({
    mineCount: z.number().int().min(1).max(BOARD_CELL_COUNT - 1),
    predictionCount: z.number().int().min(1).max(BOARD_CELL_COUNT - 1),
    predictedCells: cellArraySchema(1),
    result: z.enum(["WON", "LOST"]),
    playedCells: cellArraySchema().optional().default([]),
    hitCell: z.number().int().min(1).max(BOARD_CELL_COUNT).nullable().optional(),
    mineLocations: cellArraySchema().optional().default([]),
  })
  .superRefine((value, context) => {
    if (value.predictedCells.length !== value.predictionCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predictedCells"],
        message: "Predicted cells must match the selected prediction count.",
      });
    }

    if (value.predictionCount > BOARD_CELL_COUNT - value.mineCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predictionCount"],
        message: "Prediction count is too high for this mine count.",
      });
    }

    if (value.result === "WON") {
      if (value.playedCells.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["playedCells"],
          message: "Select the predicted cells that were actually played.",
        });
      }

      if (!isSubset(value.playedCells, value.predictedCells)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["playedCells"],
          message: "Played cells must be chosen from the prediction list.",
        });
      }

      if (value.mineLocations.length > 0 || value.hitCell) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["result"],
          message: "Mine locations and hit cell are only needed for losses.",
        });
      }
    }

    if (value.result === "LOST") {
      if (value.mineLocations.length !== value.mineCount) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mineLocations"],
          message: "Loss reports must include exactly the same number of mine cells as the selected mine count.",
        });
      }

      if (!value.hitCell) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hitCell"],
          message: "Choose the hit cell for a loss.",
        });
      }

      if (value.hitCell && !value.mineLocations.includes(value.hitCell)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hitCell"],
          message: "The hit cell must also be included in the mine locations.",
        });
      }
    }
  });
