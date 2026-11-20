import { describe, expect, it } from "vitest";
import { dueBucket } from "./leads";

describe("follow-up due buckets", () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);

  it("marks dates before the local day as overdue", () => {
    expect(dueBucket(new Date(2026, 10, 14, 23, 59).toISOString(), now)).toBe("overdue");
  });

  it("keeps due dates throughout today in the today bucket", () => {
    expect(dueBucket(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe("today");
  });

  it("marks a due date on the next local day as upcoming", () => {
    expect(dueBucket(new Date(2026, 10, 16, 0, 0).toISOString(), now)).toBe("upcoming");
  });
});
