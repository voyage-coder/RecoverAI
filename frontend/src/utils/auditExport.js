import { formatDateTime } from "./format";

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function detailText(details) {
  if (details == null || details === "") return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function buildAuditRows({ recoveryCase, timeline }) {
  const rows = [];
  const caseNumber = recoveryCase?.case_number || "case";
  const actions = timeline?.actions || [];
  const communications = timeline?.communications || [];
  const auditLogs = timeline?.audit_logs || [];
  const strategies = timeline?.strategies || [];

  rows.push({
    time: recoveryCase?.created_at,
    type: "Case",
    what: "Payment failed",
    status: recoveryCase?.status || "",
    detail: recoveryCase?.failure_reason || "",
  });

  strategies.forEach((item) => {
    rows.push({
      time: item.created_at,
      type: "Strategy",
      what: item.is_selected ? "Selected" : "Evaluated",
      status: item.is_selected ? "SELECTED" : "ALTERNATIVE",
      detail: item.strategy_type || item.rationale || "",
    });
  });

  actions.forEach((item) => {
    rows.push({
      time: item.created_at,
      type: "Action",
      what: "Created",
      status: item.status || "",
      detail: item.action_type || "",
    });
    if (item.executed_at) {
      rows.push({
        time: item.executed_at,
        type: "Action",
        what:
          String(item.status || "").toUpperCase() === "EXECUTED"
            ? "Succeeded"
            : "Outcome",
        status: item.status || "",
        detail: item.result_text || item.action_type || "",
      });
    }
  });

  communications.forEach((item) => {
    rows.push({
      time: item.sent_at,
      type: "Communication",
      what: item.channel || "Message",
      status: item.status || "",
      detail: item.content || "",
    });
  });

  auditLogs.forEach((item) => {
    rows.push({
      time: item.timestamp,
      type: "Audit",
      what: item.action_type || "Event",
      status: item.actor || "",
      detail: detailText(item.details),
    });
  });

  return { caseNumber, rows };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadAuditExcel({ recoveryCase, timeline }) {
  const { caseNumber, rows } = buildAuditRows({ recoveryCase, timeline });
  const header = ["Time", "Type", "What happened", "Status", "Detail"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        csvCell(formatDateTime(row.time)),
        csvCell(row.type),
        csvCell(row.what),
        csvCell(row.status),
        csvCell(row.detail),
      ].join(",")
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${caseNumber}-audit.csv`);
}

function pdfEscape(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text, width = 90) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const lines = [];
  let rest = raw;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < 40) cut = width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines;
}

export function downloadAuditPdf({ recoveryCase, timeline }) {
  const { caseNumber, rows } = buildAuditRows({ recoveryCase, timeline });
  const lines = [`RecoverAI audit  ${caseNumber}`, ""];
  rows.forEach((row) => {
    lines.push(
      `${formatDateTime(row.time)}  ${row.type}  ${row.what}  ${row.status}`
    );
    wrapLine(row.detail, 88).forEach((line) => lines.push(`  ${line}`));
    lines.push("");
  });

  const pageW = 595;
  const pageH = 842;
  const margin = 48;
  const lineH = 12;
  const perPage = Math.max(1, Math.floor((pageH - margin * 2) / lineH));
  const pageChunks = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pageChunks.push(lines.slice(i, i + perPage));
  }
  if (!pageChunks.length) pageChunks.push([`RecoverAI audit  ${caseNumber}`]);

  const objects = [];
  const offsets = [];

  const fontObj = objects.length + 1; // we'll assign after pushing in order
  // Object layout:
  // 1 Catalog
  // 2 Pages
  // 3 Font
  // then pairs of Page + Content for each page

  const pageCount = pageChunks.length;
  const fontId = 3;
  const firstPageId = 4;
  const pageIds = pageChunks.map((_, i) => firstPageId + i * 2);
  const contentIds = pageChunks.map((_, i) => firstPageId + i * 2 + 1);

  const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  const pagesDict = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageCount} >>`;
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const bodies = [catalog, pagesDict, font];
  pageChunks.forEach((chunk, i) => {
    let y = pageH - margin;
    const ops = ["BT /F1 10 Tf"];
    chunk.forEach((line) => {
      ops.push(`1 0 0 1 ${margin} ${y} Tm (${pdfEscape(line)}) Tj`);
      y -= lineH;
    });
    ops.push("ET");
    const stream = ops.join("\n");
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  bodies.forEach((body, index) => {
    offsets[index] = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefAt}\n%%EOF`;

  triggerDownload(
    new Blob([pdf], { type: "application/pdf" }),
    `${caseNumber}-audit.pdf`
  );
}
