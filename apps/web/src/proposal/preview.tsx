import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { message } from "../crm/messages";
import { activeWorkspace, queryClient, type Me } from "../session";

export function ProposalPreview({ proposalId }: { proposalId: string }) {
  return <PreviewCanvas key={proposalId} proposalId={proposalId} />;
}

function PreviewCanvas({ proposalId }: { proposalId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const headers = new Headers();
      const me = queryClient.getQueryData<Me>(["me"]);
      const workspaceId = me ? activeWorkspace(me)?.workspace_id : undefined;
      if (workspaceId) {
        headers.set("x-workspace-id", workspaceId);
      }
      const response = await fetch(`/proposals/${proposalId}/pdf`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Could not load the PDF.");
      }
      const data = new Uint8Array(await response.arrayBuffer());
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data }).promise;
      const page = await doc.getPage(1);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) {
        await doc.destroy();
        return;
      }
      const viewport = page.getViewport({ scale: 1.2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not draw the preview.");
      }
      await page.render({ canvasContext: context, viewport }).promise;
      await doc.destroy();
      if (!cancelled) {
        setReady(true);
      }
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(message(err, "Could not preview the PDF."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Preview</h3>
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-label="Proposal PDF preview"
        className="max-w-full border border-line"
      />
      {ready ? <p>Preview ready</p> : <p>Loading preview.</p>}
    </div>
  );
}
