/** Map mutation failures to safe, localized UI messages; never render raw database errors. */
export function mutationErrorKey(
  error: unknown,
): "mutationNoRows" | "permissionDenied" | "somethingWrong" {
  if (error instanceof Error && error.message === "mutation_no_rows") return "mutationNoRows";
  if (error && typeof error === "object") {
    const detail = error as { code?: string; status?: number; statusCode?: string };
    if (
      detail.code === "42501" ||
      detail.status === 401 ||
      detail.status === 403 ||
      detail.statusCode === "401" ||
      detail.statusCode === "403"
    ) {
      return "permissionDenied";
    }
  }
  return "somethingWrong";
}
