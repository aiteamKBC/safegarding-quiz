import jsPDF from "jspdf";
import type { FullSectionReport } from "../components/LearnerReportModal";

// ─── colour helpers ──────────────────────────────────────────────────────────

type RGB = [number, number, number];

const GOLD: RGB        = [178, 119,  21];   // #b27715
const GOLD_LIGHT: RGB  = [249, 244, 236];   // #F9F4EC
const GOLD_MID: RGB    = [233, 217, 189];   // #E9D9BD
const DARK_PURPLE: RGB = [ 36,  20,  83];   // #241453
const DEEP_PURPLE: RGB = [ 68,  47, 115];   // #442F73
const MUTED: RGB       = [122, 112, 112];   // #7a7070
const WHITE: RGB       = [255, 255, 255];
const LIGHT: RGB       = [249, 244, 236];   // cream

const riskColour = (level?: string): RGB => {
  if (level === "Very High") return [220, 38,  38];
  if (level === "High")      return [217, 119,  6];
  if (level === "Medium")    return [59,  130, 246];
  return [34, 168, 94];
};

// ─── load logo as base64 ─────────────────────────────────────────────────────

async function loadLogoBase64(): Promise<string | null> {
  try {
    const resp = await fetch("/kbc-logo.png");
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function setStroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }
function setTxt(doc: jsPDF, c: RGB)  { doc.setTextColor(c[0], c[1], c[2]); }

function badge(doc: jsPDF, text: string, x: number, y: number, w: number, h: number, bg: RGB, fg: RGB) {
  setFill(doc, bg);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, "F");
  setTxt(doc, fg);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text(text, x + w / 2, y + h / 2 + 0.5, { align: "center", baseline: "middle" });
}

function sectionHeading(doc: jsPDF, text: string, x: number, y: number) {
  setTxt(doc, GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text(text.toUpperCase(), x, y);
}

function divider(doc: jsPDF, y: number, margin: number, W: number) {
  setStroke(doc, [220, 220, 230]);
  doc.setLineWidth(0.3);
  doc.line(margin, y, W - margin, y);
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function generateReportPdf(data: FullSectionReport, sectionTitle: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const W = 210;
  const margin = 18;
  const cW = W - margin * 2;         // content width
  let y = 0;

  const risk   = data.score?.riskLevel ?? "Low";
  const rc     = riskColour(risk);
  const total  = data.score?.total ?? 0;
  const max    = data.score?.max ?? 30;
  const pct    = max > 0 ? Math.round((total / max) * 100) : 0;
  const title  = data.section?.title ?? sectionTitle;

  const submittedDate = data.meta?.submittedAt
    ? new Date(data.meta.submittedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  const logo = await loadLogoBase64();

  // ── Header bar ──────────────────────────────────────────────────────────────
  setFill(doc, DARK_PURPLE);
  doc.rect(0, 0, W, 30, "F");
  // gold accent line
  setFill(doc, GOLD);
  doc.rect(0, 30, W, 1.2, "F");

  if (logo) {
    doc.addImage(logo, "PNG", margin, 5, 18, 18);
  }

  const textX = margin + (logo ? 22 : 0);
  setTxt(doc, WHITE);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Kent Business College", textX, 13);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  setTxt(doc, GOLD_MID);
  doc.text("Learner Inclusiveness Report", textX, 19);

  // Risk badge right side of header
  badge(doc, risk, W - margin - 30, 9, 30, 12, rc, WHITE);

  y = 38;

  // ── Report title ────────────────────────────────────────────────────────────
  setTxt(doc, DEEP_PURPLE);
  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(title, cW - 35);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7.5 + 2;

  // Learner info row
  const infoItems = [
    data.learner?.name,
    data.learner?.email,
    submittedDate ? `Submitted ${submittedDate}` : null,
  ].filter(Boolean) as string[];

  if (infoItems.length) {
    setTxt(doc, MUTED);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.text(infoItems.join("   ·   "), margin, y);
    y += 7;
  }

  y += 3;
  divider(doc, y, margin, W); y += 5;

  // ── Score card ──────────────────────────────────────────────────────────────
  const cardH = 24;
  setFill(doc, GOLD_LIGHT);
  doc.roundedRect(margin, y, cW, cardH, 4, 4, "F");
  setStroke(doc, GOLD_MID);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, cW, cardH, 4, 4, "S");

  // Big score
  setTxt(doc, DEEP_PURPLE);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(String(total), margin + 7, y + 16);
  const scoreNumW = doc.getTextWidth(String(total));

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  setTxt(doc, MUTED);
  doc.text(`/${max}`, margin + 7 + scoreNumW + 1, y + 16);

  // Label + bar
  const barX = margin + 42;
  const barW = 80;
  setTxt(doc, MUTED);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.text("OVERALL SCORE", barX, y + 6);

  doc.setFontSize(8.5);
  setTxt(doc, rc);
  doc.text(`Risk percentage: ${pct}%`, barX, y + 12);

  setFill(doc, GOLD_MID);
  doc.roundedRect(barX, y + 14, barW, 3, 1, 1, "F");
  setFill(doc, rc);
  doc.roundedRect(barX, y + 14, Math.max(3, barW * pct / 100), 3, 1, 1, "F");

  // Next step
  if (data.ui?.nextStep) {
    const nsX = W - margin - 55;
    setTxt(doc, MUTED);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.text("NEXT STEP", nsX, y + 6);
    setTxt(doc, DEEP_PURPLE);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const nsLines = doc.splitTextToSize(data.ui.nextStep, 53);
    doc.text(nsLines, nsX, y + 11);
  }

  y += cardH + 7;
  divider(doc, y, margin, W); y += 6;

  // ── Learner summary ─────────────────────────────────────────────────────────
  if (data.summaries?.learner) {
    sectionHeading(doc, "Your Summary", margin, y); y += 5;
    setTxt(doc, [60, 55, 75]);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(data.summaries.learner, cW);
    doc.text(lines, margin, y);
    y += lines.length * 4.6 + 6;
  }

  // ── Coach summary ───────────────────────────────────────────────────────────
  if (data.summaries?.coach) {
    if (y > 235) { doc.addPage(); y = margin; }
    const coachLines = doc.splitTextToSize(data.summaries.coach, cW - 8);
    const boxH = coachLines.length * 4.6 + 15;
    setFill(doc, GOLD_LIGHT);
    doc.roundedRect(margin, y, cW, boxH, 3, 3, "F");
    sectionHeading(doc, "Coach Summary", margin + 5, y + 8); y += 13;
    setTxt(doc, [55, 45, 80]);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(coachLines, margin + 5, y);
    y += coachLines.length * 4.6 + 7;
  }

  divider(doc, y, margin, W); y += 6;

  // ── Main indicators ─────────────────────────────────────────────────────────
  const indicators = data.findings?.mainIndicators ?? [];
  if (indicators.length) {
    if (y > 240) { doc.addPage(); y = margin; }
    sectionHeading(doc, "Main Indicators", margin, y); y += 6;
    for (const item of indicators) {
      if (y > 272) { doc.addPage(); y = margin; }
      setFill(doc, rc);
      doc.circle(margin + 2.5, y + 1.5, 1.5, "F");
      setTxt(doc, [55, 55, 65]);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      const iLines = doc.splitTextToSize(item, cW - 9);
      doc.text(iLines, margin + 7, y + 3);
      y += iLines.length * 4.6 + 2;
    }
    y += 4;
  }

  // ── Recommended adjustments ─────────────────────────────────────────────────
  const adjustments = data.findings?.recommendedAdjustments ?? [];
  if (adjustments.length) {
    if (y > 240) { doc.addPage(); y = margin; }
    sectionHeading(doc, "Recommended Adjustments", margin, y); y += 6;
    for (const item of adjustments) {
      if (y > 272) { doc.addPage(); y = margin; }
      setTxt(doc, [100, 130, 80]);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("✓", margin + 1, y + 3);
      setTxt(doc, [55, 55, 65]);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      const aLines = doc.splitTextToSize(item, cW - 9);
      doc.text(aLines, margin + 7, y + 3);
      y += aLines.length * 4.6 + 2;
    }
    y += 4;
  }

  // ── Priority actions ────────────────────────────────────────────────────────
  const actions = data.findings?.recommendedActions ?? [];
  if (actions.length) {
    if (y > 230) { doc.addPage(); y = margin; }
    sectionHeading(doc, "Priority Actions", margin, y); y += 6;
    for (const action of actions) {
      if (y > 268) { doc.addPage(); y = margin; }
      const aLines = doc.splitTextToSize(action.action ?? "", cW - 52);
      const rowH = Math.max(11, aLines.length * 4.6 + 7);
      setFill(doc, [248, 248, 250]);
      doc.roundedRect(margin, y, cW, rowH, 2, 2, "F");
      setTxt(doc, DEEP_PURPLE);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(action.owner ?? "", margin + 4, y + rowH / 2 + 0.5, { baseline: "middle" });
      setTxt(doc, [70, 65, 85]);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(aLines, margin + 40, y + 5.5);
      if (action.due) {
        setTxt(doc, MUTED);
        doc.setFontSize(7);
        doc.text(`Due: ${action.due}`, W - margin - 3, y + rowH / 2 + 0.5, { align: "right", baseline: "middle" });
      }
      y += rowH + 2;
    }
    y += 3;
  }

  // ── Screening note ──────────────────────────────────────────────────────────
  if (data.summaries?.screeningOnlyNote) {
    if (y > 262) { doc.addPage(); y = margin; }
    setTxt(doc, MUTED);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "italic");
    const nLines = doc.splitTextToSize(data.summaries.screeningOnlyNote, cW);
    doc.text(nLines, margin, y);
    y += nLines.length * 4 + 4;
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setFill(doc, GOLD_LIGHT);
    doc.rect(0, 283, W, 14, "F");
    setFill(doc, GOLD);
    doc.rect(0, 283, W, 0.8, "F");
    setTxt(doc, MUTED);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    if (data.references?.basis) {
      doc.text(`Reference: ${data.references.basis}`, margin, 289);
    }
    doc.text(
      `Generated ${new Date().toLocaleDateString("en-GB")}   |   Page ${p} of ${totalPages}`,
      W - margin,
      289,
      { align: "right" },
    );
  }

  const filename = title.replace(/[^a-z0-9]+/gi, "_").slice(0, 50) + "_Report.pdf";
  doc.save(filename);
}
