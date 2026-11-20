import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import { ErrorState } from "./states";

describe("ErrorState", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {} },
    });
  });

  it("keeps backend details out of the user-facing error", () => {
    render(
      <I18nProvider>
        <ErrorState error={new Error("internal relation and column names")} />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("حدث خطأ ما. حاول مرة أخرى.");
    expect(screen.queryByText("internal relation and column names")).not.toBeInTheDocument();
  });
});
