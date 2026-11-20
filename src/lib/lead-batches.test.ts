import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, TEMPLATE_CSV, mapHeaders, parseCsvText } from "./csv";
import {
  fetchWorkspacePhones,
  hasDuplicatePhone,
  indexLeadPhones,
  previewImport,
  readImportFile,
  updateLeadsInBulk,
} from "./lead-batches";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
beforeEach(() => from.mockReset());

describe("lead CSV import", () => {
  it("accepts the template and rejects oversized files before reading", async () => {
    const text = vi.fn(async () => TEMPLATE_CSV);
    await expect(readImportFile({ size: MAX_IMPORT_BYTES + 1, text })).resolves.toMatchObject({
      issue: { key: "fileTooLarge" },
    });
    expect(text).not.toHaveBeenCalled();
    await expect(readImportFile({ size: MAX_IMPORT_BYTES, text })).resolves.toMatchObject({
      parsed: {
        headers: expect.arrayContaining(["full_name", "phone"]),
        rows: [expect.any(Object)],
      },
    });
  });

  it("enforces the record limit and rejects malformed quoting", async () => {
    const text = "name,phone\n" + "Test,01012345678\n".repeat(MAX_IMPORT_ROWS + 1);
    await expect(
      readImportFile({ size: text.length, text: async () => text }),
    ).resolves.toMatchObject({ issue: { key: "tooManyRows" } });
    await expect(
      readImportFile({ size: 30, text: async () => 'name,phone\n"Missing,01012345678' }),
    ).resolves.toMatchObject({ issue: { key: "csvUnreadable" } });
  });

  it("uses custom mappings and skips existing and in-file duplicates, without reserving invalid rows", () => {
    const parsed = parseCsvText(
      "contact,number\n,01012345678\nValid,01012345678\nDuplicate,٠٠٢٠١٠١٢٣٤٥٦٧٨\nExisting,+20 111 234 5678\nMalformed,01212345678,extra",
    );
    const existing = indexLeadPhones([{ id: "old", phone: "011-1234-5678" }]);
    const rows = previewImport(parsed, { full_name: "contact", phone: "number" }, existing);
    expect(rows.map((row) => row.data?.full_name)).toEqual([
      undefined,
      "Valid",
      undefined,
      undefined,
      undefined,
    ]);
    expect(rows[0]?.errors).toContainEqual({ key: "errEmptyName" });
    expect(rows[2]?.duplicate).toEqual({ key: "warnDupFile", vars: { row: 3 } });
    expect(rows[3]?.duplicate).toEqual({ key: "warnDupDb" });
    expect(rows[4]?.errors).toContainEqual({ key: "csvColumnCount" });
  });

  it("keeps quoted multiline CSV fields and rejects budgets outside the database range", () => {
    const parsed = parseCsvText(
      'name,phone,notes,budget_min\nAli,01012345678,"Line 1\nLine 2",\nMona,01112345678,,100000000000000',
    );
    const rows = previewImport(parsed, mapHeaders(parsed.headers).map, new Map());
    expect(rows[0]?.data?.notes).toBe("Line 1\nLine 2");
    expect(rows[1]?.errors[0]?.key).toBe("errBudget");
  });
});

describe("workspace phone matching", () => {
  it("ignores the edited record but warns when another record uses the same number", () => {
    const record = { id: "self", phone: "010 1234 5678" };
    expect(hasDuplicatePhone(indexLeadPhones([record]), "+201012345678", "self")).toBe(false);
    expect(
      hasDuplicatePhone(
        indexLeadPhones([record, { id: "other", phone: "٠١٠١٢٣٤٥٦٧٨" }]),
        "00201012345678",
        "self",
      ),
    ).toBe(true);
  });

  it("filters by workspace and checks each page, including legacy numbers", async () => {
    const eq = vi.fn().mockReturnThis();
    const gt = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn().mockReturnThis();
    from.mockReturnValue({
      select,
      eq,
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue({
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: [{ id: "a", phone: "011 1234 5678" }], error: null }),
        gt,
      }),
    });
    const index = await fetchWorkspacePhones("my-workspace");
    expect(eq.mock.calls).toEqual([
      ["workspace_id", "my-workspace"],
      ["workspace_id", "my-workspace"],
    ]);
    expect(select).toHaveBeenCalledWith("id, phone");
    expect(gt).toHaveBeenCalledWith("id", "a");
    expect(hasDuplicatePhone(index, "+201112345678")).toBe(true);
  });
});

describe("bulk updates", () => {
  function mockUpdate(result: unknown) {
    const query = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(result),
    };
    from.mockReturnValue(query);
    return query;
  }

  it("scopes updates to selected active leads in the current workspace and returns partial counts", async () => {
    const query = mockUpdate({ data: [{ id: "a" }], error: null });
    await expect(
      updateLeadsInBulk("workspace-a", ["a", "a", "b"], { type: "status", status: "won" }),
    ).resolves.toEqual({ updated: 1, skipped: 1 });
    expect(query.update).toHaveBeenCalledWith({ status: "won" });
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(query.in).toHaveBeenCalledWith("id", ["a", "b"]);
  });

  it("sets or clears the assignee and archives with a timestamp", async () => {
    const query = mockUpdate({ data: [{ id: "a" }], error: null });
    await updateLeadsInBulk("workspace-a", ["a"], { type: "assign", userId: "agent" });
    await updateLeadsInBulk("workspace-a", ["a"], { type: "assign", userId: null });
    await updateLeadsInBulk("workspace-a", ["a"], { type: "archive" });
    expect(query.update.mock.calls).toEqual([
      [{ assigned_to: "agent" }],
      [{ assigned_to: null }],
      [{ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }],
    ]);
  });

  it("does not send an empty selection and propagates database rejects", async () => {
    await expect(updateLeadsInBulk("workspace-a", [], { type: "archive" })).resolves.toEqual({
      updated: 0,
      skipped: 0,
    });
    expect(from).not.toHaveBeenCalled();
    const error = new Error("Assigned agent must belong to this workspace");
    mockUpdate({ data: null, error });
    await expect(
      updateLeadsInBulk("workspace-a", ["a"], { type: "assign", userId: "other-workspace" }),
    ).rejects.toBe(error);
  });
});
