import { ApiError } from "../session";

export function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
