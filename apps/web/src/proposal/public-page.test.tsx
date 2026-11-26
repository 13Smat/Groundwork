// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionModule from "../session";
import { ApiError } from "../session";

vi.mock("../session", async () => {
  const actual = await vi.importActual<typeof SessionModule>("../session");
  return { ...actual, api: vi.fn() };
});

import { api } from "../session";
import { PublicProposalPage } from "./public-page";

const fetchProposal = vi.mocked(api);

afterEach(() => {
  cleanup();
  fetchProposal.mockReset();
});

function renderPage(token: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PublicProposalPage token={token} />
    </QueryClientProvider>,
  );
}

describe("PublicProposalPage", () => {
  it("shows one unavailable state for an unknown link and a revoked link", async () => {
    fetchProposal.mockRejectedValueOnce(new ApiError(404, "This link isn't available."));
    const unknown = renderPage("guessed-token");
    const unknownHeading = await screen.findByRole("heading", {
      name: "This link isn't available.",
    });
    expect(unknownHeading).toBeTruthy();
    expect(unknown.container.textContent).not.toContain("guessed-token");
    unknown.unmount();

    fetchProposal.mockRejectedValueOnce(
      new ApiError(410, "That proposal link is no longer available."),
    );
    const revoked = renderPage("revoked-token");
    const revokedHeading = await screen.findByRole("heading", {
      name: "This link isn't available.",
    });
    expect(revokedHeading).toBeTruthy();
    expect(screen.queryByText(/no longer available/)).toBeNull();
    expect(screen.queryByText(/not found/i)).toBeNull();
    expect(revoked.container.textContent).not.toContain("revoked-token");
  });
});
