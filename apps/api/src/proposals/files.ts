import { ProblemError } from "../errors.js";
import { getObject, putObject } from "../storage/s3.js";

const MISSING = "That proposal PDF is not in storage.";

export type ProposalFiles = {
  put(input: { storageKey: string; body: Buffer; mime: string }): Promise<void>;
  get(storageKey: string): Promise<Buffer>;
};

export function s3ProposalFiles(): ProposalFiles {
  return {
    async put(input) {
      await putObject({ storageKey: input.storageKey, body: input.body, mime: input.mime });
    },
    get(storageKey) {
      return getObject(storageKey, undefined, MISSING);
    },
  };
}

export function missingPdf(): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail: MISSING });
}
