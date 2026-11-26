import { Fragment } from "react";

import { formatUsd, selectedOptional } from "./money.js";
import { FIELD_VERIFY_NOTE, type ProposalPdfLine, type ProposalPdfModel } from "./types.js";

function groupsOf(lines: readonly ProposalPdfLine[]): { name: string; lines: ProposalPdfLine[] }[] {
  const groups: { name: string; lines: ProposalPdfLine[] }[] = [];
  for (const line of lines) {
    const name = line.group && line.group.trim() !== "" ? line.group : "Scope";
    const found = groups.find((group) => group.name === name);
    if (found) {
      found.lines.push(line);
    } else {
      groups.push({ name, lines: [line] });
    }
  }
  return groups;
}

function LineRows({ lines }: { lines: readonly ProposalPdfLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <tr key={line.id}>
          <td>{line.description}</td>
          <td>{line.qty}</td>
          <td>{line.unit}</td>
          <td>{formatUsd(line.unitPriceCents)}</td>
          <td>{formatUsd(line.priceCents)}</td>
        </tr>
      ))}
    </>
  );
}

export function ProposalDocument({ model }: { model: ProposalPdfModel }) {
  const required = model.lines.filter((line) => !line.optional);
  const optional = model.lines.filter((line) => line.optional);
  const selected = optional.filter((line) => selectedOptional(line.id, model.selectedOptionalIds));
  const requiredPrice = required.reduce((sum, line) => sum + line.priceCents, 0);
  const requiredTax = required.reduce((sum, line) => sum + line.taxCents, 0);
  const selectedPrice = selected.reduce((sum, line) => sum + line.priceCents, 0);
  const selectedTax = selected.reduce((sum, line) => sum + line.taxCents, 0);
  const total = requiredPrice + requiredTax + selectedPrice + selectedTax;

  return (
    <article>
      <header>
        <p>{model.workspaceName}</p>
        <h1>Proposal {model.number}</h1>
        <p>
          Estimate {model.estimateNumber} version {model.estimateVersion}
        </p>
        <p>Prepared {model.preparedOn}</p>
        <p>Prepared for {model.clientName}</p>
        <p>Job {model.jobName}</p>
        <p>Site {model.siteAddress}</p>
      </header>
      {model.intro.trim() !== "" ? (
        <section>
          <h2>Introduction</h2>
          <p>{model.intro}</p>
        </section>
      ) : null}
      <section>
        <h2>Scope</h2>
        {model.scopeNote.trim() !== "" ? <p>{model.scopeNote}</p> : null}
        {groupsOf(required).map((group) => (
          <Fragment key={group.name}>
            <h3>{group.name}</h3>
            <ul>
              {group.lines.map((line) => (
                <li key={line.id}>
                  {line.description} {line.qty} {line.unit}
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
      </section>
      {model.includeSiteMap && model.siteMapPngBase64 ? (
        <section>
          <h2>Site map</h2>
          <img src={`data:image/png;base64,${model.siteMapPngBase64}`} alt="" />
        </section>
      ) : null}
      <section>
        <h2>Price</h2>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <LineRows lines={required} />
          </tbody>
        </table>
        <p>Price {formatUsd(requiredPrice)}</p>
        <p>Tax {formatUsd(requiredTax)}</p>
      </section>
      {model.includeOptional ? (
        <section>
          <h2>Optional items</h2>
          {optional.length === 0 ? <p>No optional items.</p> : null}
          {optional.map((line) => (
            <p key={line.id}>
              {line.description} {formatUsd(line.priceCents)}{" "}
              {selectedOptional(line.id, model.selectedOptionalIds) ? "Included" : "Not included"}
            </p>
          ))}
          <p>Selected options {formatUsd(selectedPrice + selectedTax)}</p>
        </section>
      ) : null}
      <p>Total {formatUsd(total)}</p>
      <section>
        <h2>Terms</h2>
        <p>{model.terms.trim() === "" ? "Terms are not set." : model.terms}</p>
      </section>
      <section>
        <h2>Signature</h2>
        <p>Signer name</p>
        <p>Signature</p>
        <p>Date</p>
      </section>
      <footer>
        <h2>Imagery</h2>
        {model.imagery.length === 0 ? <p>No aerial imagery was used for this proposal.</p> : null}
        {model.imagery.map((credit) => (
          <p key={`${credit.provider}:${credit.captureDate}:${credit.name}`}>
            {credit.provider} {credit.name} captured {credit.captureDate} GSD {credit.gsdCm} cm{" "}
            {credit.attribution}
          </p>
        ))}
        <p>{FIELD_VERIFY_NOTE}</p>
      </footer>
    </article>
  );
}
