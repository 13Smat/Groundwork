export const PDF_TEMPLATES_PACKAGE = "@groundwork/pdf-templates" as const;

/** React templates rendered to PDF are not in this slice. */
export function pdfTemplatesPackageName(): string {
  return PDF_TEMPLATES_PACKAGE;
}
