import { formatDateTime, formatINR } from "./format";
import { toLabel } from "./labels";

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function moneyLabel(paise) {
  if (paise == null || Number.isNaN(Number(paise))) return "INR 0";
  return formatINR(paise).replace(/₹/g, "Rs. ");
}

function runnerFromText(text) {
  const value = String(text || "");
  if (value.startsWith("[Automatic agent]") || /Automatic agent executed/i.test(value)) {
    return "Agent (automatic)";
  }
  if (value.startsWith("[Merchant]") || /Merchant executed/i.test(value)) {
    return "You (manual)";
  }
  return "";
}

function stripRunnerPrefix(text) {
  return String(text || "")
    .replace(/^\[Automatic agent\]\s*/i, "")
    .replace(/^\[Merchant\]\s*/i, "")
    .replace(/^Automatic agent executed\s+/i, "")
    .replace(/^Merchant executed\s+/i, "")
    .replace(/^Executed strategy:\s*/i, "")
    .trim();
}

function actionOutcomeLabel(status, resultText) {
  const key = String(status || "").toUpperCase();
  if (key === "EXECUTED") {
    const detail = stripRunnerPrefix(resultText).toLowerCase();
    if (detail.includes("failed") || detail.includes("could not")) {
      return "Ran — did not recover money";
    }
    return "Ran successfully";
  }
  if (key === "FAILED") return "Failed";
  if (key === "BLOCKED") return "Blocked by safety rules";
  if (key === "PENDING" || key === "PROCESSING") return "Waiting (not run yet)";
  return toLabel(status);
}

function sortByTime(rows) {
  return [...rows].sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });
}

export function buildAuditDocument({ recoveryCase, timeline }) {
  const caseNumber = recoveryCase?.case_number || "case";
  const actions = timeline?.actions || [];
  const communications = timeline?.communications || [];
  const strategies = timeline?.strategies || [];
  const result = timeline?.result;
  const status = toLabel(recoveryCase?.status);

  const recovered =
    String(recoveryCase?.status || "").toUpperCase() === "RECOVERED";

  const summary = [
    ["Case", caseNumber],
    ["Status now", status],
    [
      "Money recovered in RecoverAI?",
      recovered
        ? "Yes — only after a verified Razorpay capture"
        : "No — customer has not been confirmed paid yet",
    ],
    ["Amount at risk", moneyLabel(recoveryCase?.amount_at_risk)],
    ["Why it failed", toLabel(recoveryCase?.failure_category) || recoveryCase?.failure_reason || "—"],
    ["Opened", formatDateTime(recoveryCase?.created_at)],
  ];

  if (result?.status) {
    summary.push(["Recovery result", toLabel(result.status)]);
  }

  const selected = strategies.filter((item) => item.is_selected);
  const considered = strategies
    .map((item) => toLabel(item.strategy_type || item.rationale))
    .filter(Boolean);

  const timelineRows = [];

  timelineRows.push({
    time: recoveryCase?.created_at,
    what: "Payment failed",
    who: "",
    result: recoveryCase?.failure_reason || toLabel(recoveryCase?.failure_category),
  });

  actions.forEach((item) => {
    const who =
      runnerFromText(item.result_text) ||
      (String(item.status || "").toUpperCase() === "PENDING"
        ? "Waiting for you or the agent"
        : "");
    timelineRows.push({
      time: item.executed_at || item.created_at,
      what: toLabel(item.action_type),
      who,
      result: actionOutcomeLabel(item.status, item.result_text),
    });
  });

  const messageRows = communications.map((item) => ({
    time: item.sent_at,
    channel: toLabel(item.channel),
    status: toLabel(item.status),
    text: stripRunnerPrefix(item.content || "").replace(/\s+/g, " ").trim(),
  }));

  return {
    caseNumber,
    generatedAt: formatDateTime(new Date().toISOString()),
    summary,
    considered,
    selected: selected.map((item) => toLabel(item.strategy_type)),
    timelineRows: sortByTime(timelineRows),
    messageRows: sortByTime(messageRows),
    recovered,
  };
}

/** Flat rows for Excel — same story as the PDF, time order. */
export function buildAuditRows({ recoveryCase, timeline }) {
  const doc = buildAuditDocument({ recoveryCase, timeline });
  const rows = [];

  doc.summary.forEach((pair) => {
    rows.push({
      time: recoveryCase?.created_at,
      type: "Summary",
      what: pair[0],
      status: "",
      detail: pair[1],
    });
  });

  doc.timelineRows.forEach((row) => {
    rows.push({
      time: row.time,
      type: "Timeline",
      what: row.what,
      status: row.who || "",
      detail: row.result,
    });
  });

  doc.messageRows.forEach((row) => {
    rows.push({
      time: row.time,
      type: "Message",
      what: row.channel,
      status: row.status,
      detail: row.text,
    });
  });

  return { caseNumber: doc.caseNumber, rows, doc };
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
  const { caseNumber, doc } = buildAuditRows({ recoveryCase, timeline });
  const blocks = [];

  blocks.push("RecoverAI case audit");
  blocks.push(`Generated,${csvCell(doc.generatedAt)}`);
  blocks.push("");
  blocks.push("Summary");
  blocks.push("Field,Value");
  doc.summary.forEach(([label, value]) => {
    blocks.push(`${csvCell(label)},${csvCell(value)}`);
  });
  blocks.push("");
  blocks.push("How to read this file");
  blocks.push(
    csvCell(
      "Agent (automatic) = RecoverAI ran the action after you chose Run agent on every case. You (manual) = you clicked Execute. Ran successfully means the action was sent — it does not mean money is recovered. Recovered only after a verified Razorpay payment.captured webhook."
    )
  );
  blocks.push("");
  blocks.push("What happened (oldest first)");
  blocks.push("When,What RecoverAI did,Who ran it,Result");
  doc.timelineRows.forEach((row) => {
    blocks.push(
      [
        csvCell(formatDateTime(row.time)),
        csvCell(row.what),
        csvCell(row.who),
        csvCell(row.result),
      ].join(",")
    );
  });
  blocks.push("");
  blocks.push("Messages sent to the customer");
  blocks.push("When,Channel,Status,Message");
  doc.messageRows.forEach((row) => {
    blocks.push(
      [
        csvCell(formatDateTime(row.time)),
        csvCell(row.channel),
        csvCell(row.status),
        csvCell(row.text),
      ].join(",")
    );
  });

  const blob = new Blob(["\uFEFF" + blocks.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${caseNumber}-audit.csv`);
}

function pdfSafe(text) {
  return String(text ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\t\n\r\x20-\x7E]/g, "");
}

function pdfEscape(text) {
  return pdfSafe(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text, width) {
  const raw = pdfSafe(text).replace(/\s+/g, " ").trim();
  if (!raw) return [""];
  const lines = [];
  let rest = raw;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < Math.floor(width / 3)) cut = width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines.length ? lines : [""];
}

function buildPdf(pages) {
  const pageW = 595;
  const pageH = 842;
  const pageCount = pages.length;
  const fontId = 3;
  const firstPageId = 4;
  const pageIds = pages.map((_, i) => firstPageId + i * 2);
  const contentIds = pages.map((_, i) => firstPageId + i * 2 + 1);

  const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  const pagesDict = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageCount} >>`;
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const bodies = [catalog, pagesDict, font];
  pages.forEach((stream, i) => {
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [];
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
  return pdf;
}

export function downloadAuditPdf({ recoveryCase, timeline }) {
  const doc = buildAuditDocument({ recoveryCase, timeline });
  const pageW = 595;
  const pageH = 842;
  const margin = 40;
  const pageChunks = [];

  let ops = [];
  let y = pageH - margin;

  const flushPage = () => {
    ops.unshift("BT");
    ops.push("ET");
    pageChunks.push(ops.join("\n"));
    ops = [];
    y = pageH - margin;
  };

  const ensure = (need) => {
    if (y - need < margin + 24) flushPage();
  };

  const textAt = (x, yy, str, size = 9) => {
    ops.push(`/F1 ${size} Tf`);
    ops.push(`1 0 0 1 ${x} ${yy} Tm (${pdfEscape(str)}) Tj`);
  };

  const heading = (title) => {
    ensure(28);
    y -= 8;
    textAt(margin, y, title, 12);
    y -= 16;
  };

  const paragraph = (str, size = 9) => {
    wrapLine(str, 92).forEach((line) => {
      ensure(12);
      textAt(margin, y, line, size);
      y -= 12;
    });
  };

  const drawTable = (headers, rows, widths) => {
    const xs = [];
    let x = margin;
    widths.forEach((w) => {
      xs.push(x);
      x += w;
    });
    const charWidths = widths.map((w) => Math.max(8, Math.floor(w / 5.2)));

    ensure(16);
    headers.forEach((h, i) => textAt(xs[i], y, h, 8));
    y -= 14;

    rows.forEach((cells) => {
      const wrapped = cells.map((cell, i) => wrapLine(cell, charWidths[i]));
      const height = Math.max(...wrapped.map((w) => w.length), 1) * 11 + 4;
      ensure(height);
      const rowTop = y;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, li) => {
          textAt(xs[i], rowTop - li * 11, line, 8);
        });
      });
      y -= height;
    });
    y -= 6;
  };

  textAt(margin, y, "RecoverAI  |  Case audit", 16);
  y -= 16;
  textAt(margin, y, `Case ${doc.caseNumber}   Generated ${doc.generatedAt}`, 9);
  y -= 18;

  heading("1. Snapshot");
  drawTable(
    ["Field", "Value"],
    doc.summary.map((pair) => pair),
    [130, 385]
  );

  heading("2. How to read this audit");
  paragraph(
    "This file is for merchants and reviewers. It is not a bank statement."
  );
  paragraph(
    "Agent (automatic) = RecoverAI ran the action after you chose Run agent on every case. You (manual) = you clicked Execute on the desk. Older rows may have a blank Who column if they ran before this labelling existed."
  );
  paragraph(
    "Ran successfully means RecoverAI sent the retry, link, or message. It does not mean the customer paid. Money is Recovered only after Razorpay sends a verified payment.captured webhook."
  );
  y -= 4;

  heading("3. What happened (oldest first)");
  if (!doc.timelineRows.length) {
    paragraph("No recovery steps recorded yet.");
  } else {
    drawTable(
      ["When", "What RecoverAI did", "Who ran it", "Result"],
      doc.timelineRows.map((row) => [
        formatDateTime(row.time),
        row.what,
        row.who || "-",
        row.result,
      ]),
      [108, 150, 90, 167]
    );
  }

  heading("4. Messages sent to the customer");
  if (!doc.messageRows.length) {
    paragraph("No customer messages on this case yet.");
  } else {
    drawTable(
      ["When", "Channel", "Message"],
      doc.messageRows.map((row) => [
        formatDateTime(row.time),
        row.channel,
        row.text,
      ]),
      [108, 70, 337]
    );
  }

  heading("5. Strategies considered");
  paragraph(
    doc.considered.length
      ? `Looked at: ${doc.considered.join("; ")}.`
      : "No strategy list stored on this case."
  );
  if (doc.selected.length) {
    paragraph(`Currently selected next step: ${doc.selected.join(", ")}.`);
  }
  y -= 8;
  paragraph(
    doc.recovered
      ? "End state: Recovered (verified capture)."
      : "End state: not Recovered yet. Waiting for customer payment and a verified Razorpay webhook."
  );

  if (ops.length) flushPage();
  if (!pageChunks.length) {
    pageChunks.push("BT /F1 12 Tf 1 0 0 1 40 800 Tm (RecoverAI audit) Tj ET");
  }

  triggerDownload(
    new Blob([buildPdf(pageChunks)], { type: "application/pdf" }),
    `${doc.caseNumber}-audit.pdf`
  );
}
