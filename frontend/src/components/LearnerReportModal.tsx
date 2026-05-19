import { useState } from "react";
import {
  Laptop, Headphones, PenLine, Sparkles, Mic, HeartPulse, FileText,
  CheckCircle2, AlertTriangle, ShieldCheck, ClipboardCheck, X,
  UserRound, Mail, Calendar, Download,
} from "lucide-react";
import { generateReportPdf } from "../utils/generateReportPdf";

export type FullSectionReport = {
  meta?: { submittedAt?: string };
  learner?: { name?: string; email?: string };
  section?: { id?: string; title?: string };
  ui?: { badge?: string; badgeTone?: string; nextStep?: string; sectionIcon?: string };
  score?: { total?: number; max?: number; percentage?: number; riskLevel?: string };
  summaries?: { learner?: string; coach?: string; screeningOnlyNote?: string };
  findings?: {
    mainIndicators?: string[];
    recommendedActions?: { owner?: string; action?: string; priority?: string; due?: string }[];
    recommendedAdjustments?: string[]; 
  };
  flags?: {
    specialistScreeningRequired?: boolean;
    supportPlanNeeded?: boolean;
    wellbeingReviewRequired?: boolean;
    accessibilitySupportPlanRequired?: boolean;
    digitalSupportPlanRequired?: boolean;
  };
  answers?: { question_id?: string; value?: number; label?: string; question_text?: string }[];
  references?: { basis?: string };
};

const ICON_MAP: Record<string, React.ElementType> = {
  Laptop, Headphones, PenLine, Sparkles, Mic, HeartPulse, FileText,
};

// ─── KBC palette ─────────────────────────────────────────────────────────────

const GOLD        = "#b27715";
const GOLD_LIGHT  = "#F9F4EC";
const GOLD_MID    = "#E9D9BD";
const GOLD_BORDER = "#DDC398";
const DARK_PURPLE = "#241453";
const DEEP_PURPLE = "#442F73";
const MID_PURPLE  = "#a88cd9";
const SOFT_PURPLE = "#f9f5ff";
// const LAVENDER    = "#FEF9FF";
const MUTED       = "#7a7070";

// ─── risk styles ─────────────────────────────────────────────────────────────

type RiskKey = "Low" | "Medium" | "High" | "Very High";

const RISK_STYLES: Record<RiskKey, { bg: string; text: string; border: string; bar: string }> = {
  Low:         { bg: "#eef8f1", text: "#22613a", border: "#cde7d3", bar: "#22a85e" },
  Medium:      { bg: "#e8f3ff", text: "#1d5a9e", border: "#b0d4f5", bar: "#3b82f6" },
  High:        { bg: "#fff7e8", text: "#8a5a12", border: "#f0d5a7", bar: "#d97706" },
  "Very High": { bg: "#fdf0f2", text: "#9f2f43", border: "#efc3cb", bar: "#dc2626" },
};

function getRisk(level?: string) {
  return RISK_STYLES[(level as RiskKey)] ?? RISK_STYLES.Low;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function RiskBadge({ level }: { level?: string }) {
  const r = getRisk(level);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: r.bg, color: r.text,
      border: `1.5px solid ${r.border}`,
      borderRadius: 999, padding: "3px 14px",
      fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
    }}>
      {level ?? "Low"}
    </span>
  );
}

function StatChip({
  label, value, icon: Icon, gold,
}: {
  label: string; value: string;
  icon: React.ElementType; gold?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: gold ? GOLD_LIGHT : SOFT_PURPLE,
      border: `1px solid ${gold ? GOLD_BORDER : "#ddd5f5"}`,
      borderRadius: 14, padding: "10px 14px", flex: "1 1 140px",
    }}>
      <div style={{
        background: gold ? GOLD_MID : "#e4daf5",
        borderRadius: 10, padding: 7, display: "flex", flexShrink: 0,
      }}>
        <Icon size={15} color={gold ? GOLD : MID_PURPLE} />
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: DEEP_PURPLE }}>{value}</div>
      </div>
    </div>
  );
}

// ─── main modal ──────────────────────────────────────────────────────────────

type Tab = "overview" | "support" | "actions" | "answers";

export function LearnerReportModal({
  sectionTitle,
  data,
  onClose,
}: {
  sectionTitle: string;
  data: FullSectionReport;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [downloading, setDownloading] = useState(false);

  const Icon      = ICON_MAP[data.ui?.sectionIcon ?? ""] ?? FileText;
  const risk      = data.score?.riskLevel;
  const riskStyle = getRisk(risk);
  const total     = data.score?.total ?? 0;
  const max       = data.score?.max ?? 30;
  const pct       = max > 0 ? Math.min(100, Math.round((total / max) * 100)) : 0;

  const submittedDate = data.meta?.submittedAt
    ? new Date(data.meta.submittedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  const specScreening  = data.flags?.specialistScreeningRequired ? "Recommended" : "Not required";
  const supportPlan    = data.flags?.supportPlanNeeded ? "Required" : "Not required";
  const mainIndicators = data.findings?.mainIndicators ?? [];
  const adjustments    = data.findings?.recommendedAdjustments ?? [];
  const actions        = data.findings?.recommendedActions ?? [];
  const answers        = data.answers ?? [];

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "support",  label: "Support Plan" },
    { key: "actions",  label: "Actions" },
    { key: "answers",  label: "Answers" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20,10,45,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "32px 16px", overflowY: "auto",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 880,
          background: "#fff",
          borderRadius: 24,
          boxShadow: "0 32px 90px rgba(36,20,83,0.22), 0 2px 8px rgba(0,0,0,0.08)",
          fontFamily: "'Roboto', Arial, sans-serif",
          overflow: "hidden",
          marginBottom: 40,
        }}
      >
        {/* ── gold top accent bar ──────────────────────────────────────────── */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_BORDER} 60%, ${SOFT_PURPLE} 100%)` }} />

        {/* ── header ──────────────────────────────────────────────────────── */}
        <div style={{ padding: "24px 32px 20px", borderBottom: `1px solid ${GOLD_MID}` }}>
          {/* top bar: section tag + actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            {/* section pill */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              background: GOLD_LIGHT, border: `1px solid ${GOLD_BORDER}`,
              borderRadius: 999, padding: "5px 14px",
              fontSize: 12, fontWeight: 600, color: GOLD,
            }}>
              <Icon size={13} />
              Learner Inclusiveness Report
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                disabled={downloading}
                onClick={async () => {
                  setDownloading(true);
                  try { await generateReportPdf(data, sectionTitle); }
                  finally { setDownloading(false); }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  background: downloading ? "#9a6612" : GOLD,
                  color: "#fff", border: "none", borderRadius: 999,
                  padding: "7px 18px", cursor: downloading ? "default" : "pointer",
                  fontSize: 12.5, fontWeight: 600,
                  boxShadow: `0 2px 10px rgba(178,119,21,0.30)`,
                  transition: "background 0.2s",
                  fontFamily: "'Roboto', Arial, sans-serif",
                }}
              >
                <Download size={13} />
                {downloading ? "Generating…" : "Download Report"}
              </button>

              <button
                onClick={onClose}
                style={{
                  background: GOLD_LIGHT, border: `1px solid ${GOLD_BORDER}`,
                  borderRadius: 999, width: 34, height: 34,
                  cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={15} color={GOLD} />
              </button>
            </div>
          </div>

          {/* title + meta / score card row */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            {/* left */}
            <div style={{ flex: "1 1 320px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <RiskBadge level={risk} />
              </div>
              <h2 style={{ margin: "0 0 10px", fontSize: 24, fontWeight: 700, color: DEEP_PURPLE, lineHeight: 1.25 }}>
                {data.section?.title ?? sectionTitle}
              </h2>
              {data.summaries?.learner && (
                <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.75, color: "#555", maxWidth: 500 }}>
                  {data.summaries.learner}
                </p>
              )}
              {(data.learner?.name || data.learner?.email || submittedDate) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: MUTED }}>
                  {data.learner?.name && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <UserRound size={12} color={GOLD} /> {data.learner.name}
                    </span>
                  )}
                  {data.learner?.email && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Mail size={12} color={GOLD} /> {data.learner.email}
                    </span>
                  )}
                  {submittedDate && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Calendar size={12} color={GOLD} /> Submitted {submittedDate}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* right: score card */}
            <div style={{
              flex: "0 0 200px",
              background: GOLD_LIGHT,
              border: `1.5px solid ${GOLD_BORDER}`,
              borderRadius: 18, padding: "18px 20px 16px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: GOLD, marginBottom: 4 }}>
                Overall Score
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 46, fontWeight: 700, color: DEEP_PURPLE, lineHeight: 1 }}>{total}</span>
                <span style={{ fontSize: 18, color: MUTED, fontWeight: 400 }}>/{max}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: riskStyle.text, marginBottom: 6 }}>
                Risk: {pct}%
              </div>
              {/* bar */}
              <div style={{ height: 6, background: GOLD_MID, borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: riskStyle.bar, borderRadius: 999, transition: "width 0.6s ease" }} />
              </div>
              {data.ui?.nextStep && (
                <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: GOLD, marginBottom: 2 }}>Next Step</div>
                  <div style={{ fontSize: 11.5, color: DEEP_PURPLE, lineHeight: 1.5 }}>{data.ui.nextStep}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── stat chips ───────────────────────────────────────────────────── */}
        <div style={{ padding: "16px 32px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatChip label="Risk Level"          value={risk ?? "Low"}     icon={ShieldCheck}    gold />
          <StatChip label="Support Plan"         value={supportPlan}       icon={ClipboardCheck} />
          <StatChip label="Specialist Screening" value={specScreening}     icon={AlertTriangle}  />
          <StatChip label="Key Indicators"       value={String(mainIndicators.length)} icon={CheckCircle2} gold />
        </div>

        {/* ── tab bar ──────────────────────────────────────────────────────── */}
        <div style={{ padding: "16px 32px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: tab === t.key ? GOLD : GOLD_LIGHT,
                color: tab === t.key ? "#fff" : GOLD,
                border: `1.5px solid ${tab === t.key ? GOLD : GOLD_BORDER}`,
                borderRadius: 999, padding: "7px 18px",
                fontSize: 13, fontWeight: tab === t.key ? 600 : 500,
                cursor: "pointer", transition: "background 0.15s, color 0.15s",
                fontFamily: "'Roboto', Arial, sans-serif",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── tab content ──────────────────────────────────────────────────── */}
        <div style={{ padding: "20px 32px 28px" }}>

          {/* OVERVIEW */}
          {tab === "overview" && (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {/* coach summary */}
              <div style={{
                flex: "1 1 280px",
                background: SOFT_PURPLE,
                border: "1px solid #ddd5f5",
                borderRadius: 20, padding: "20px 22px",
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: MID_PURPLE, marginBottom: 10 }}>
                  Coach Summary
                </div>
                <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.8, color: "#444" }}>
                  {data.summaries?.coach ?? "No coach summary available."}
                </p>
                {data.summaries?.screeningOnlyNote && (
                  <div style={{
                    background: "rgba(255,255,255,0.7)",
                    border: `1px solid #ddd5f5`,
                    borderRadius: 12, padding: "12px 14px",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: MID_PURPLE, marginBottom: 5 }}>
                      Screening Note
                    </div>
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: "#555" }}>
                      {data.summaries.screeningOnlyNote}
                    </p>
                  </div>
                )}
              </div>

              {/* main indicators */}
              <div style={{
                flex: "1 1 240px",
                background: DARK_PURPLE,
                borderRadius: 20, padding: "20px 22px",
                color: "#fff",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                  <div style={{
                    background: "rgba(255,255,255,0.10)", borderRadius: 10, padding: 7, display: "flex",
                  }}>
                    <AlertTriangle size={15} color={GOLD_BORDER} />
                  </div>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: "#f0e8c8" }}>Main Indicators</span>
                </div>
                {mainIndicators.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {mainIndicators.map((item, i) => (
                      <div key={i} style={{
                        display: "flex", gap: 10, alignItems: "flex-start",
                        background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(221,195,152,0.18)",
                        borderRadius: 12, padding: "10px 12px",
                        fontSize: 12.5, color: "rgba(255,255,255,0.88)", lineHeight: 1.55,
                      }}>
                        <div style={{ marginTop: 2, flexShrink: 0 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: GOLD_BORDER }} />
                        </div>
                        {item}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0 }}>No indicators recorded.</p>
                )}
              </div>
            </div>
          )}

          {/* SUPPORT PLAN */}
          {tab === "support" && (
            <div style={{
              background: GOLD_LIGHT,
              border: `1.5px solid ${GOLD_BORDER}`,
              borderRadius: 20, padding: "22px 24px",
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: DEEP_PURPLE, marginBottom: 16 }}>
                Recommended Adjustments
              </div>
              {adjustments.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {adjustments.map((item, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 12, alignItems: "flex-start",
                      background: "#fff",
                      border: `1px solid ${GOLD_MID}`,
                      borderRadius: 14, padding: "12px 16px",
                      fontSize: 13.5, color: "#333", lineHeight: 1.65,
                    }}>
                      <CheckCircle2 size={16} color={GOLD} style={{ marginTop: 2, flexShrink: 0 }} />
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>No adjustments specified.</p>
              )}
            </div>
          )}

          {/* ACTIONS */}
          {tab === "actions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {actions.length > 0 ? actions.map((action, i) => (
                <div key={i} style={{
                  background: "#fff",
                  border: `1.5px solid ${GOLD_BORDER}`,
                  borderRadius: 18, padding: "16px 20px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: DEEP_PURPLE }}>{action.owner}</span>
                    <RiskBadge level={action.priority === "High" ? "High" : action.priority === "Medium" ? "Medium" : "Low"} />
                  </div>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.65, color: "#555" }}>{action.action}</p>
                  {action.due && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: GOLD }}>Due: {action.due}</div>
                  )}
                </div>
              )) : (
                <p style={{ color: MUTED, fontSize: 13 }}>No actions specified.</p>
              )}
            </div>
          )}

          {/* ANSWERS */}
          {tab === "answers" && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: DEEP_PURPLE }}>Your Responses</span>
                <span style={{ fontSize: 12, color: MUTED }}>
                  {answers.length} question{answers.length !== 1 ? "s" : ""} answered
                </span>
              </div>
              {answers.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {answers.map((a, i) => {
                    const val    = a.value ?? 0;
                    const maxVal = 10;
                    const aPct   = Math.round((val / maxVal) * 100);
                    const rStyle = getRisk(
                      val >= 8 ? "Very High" : val >= 6 ? "High" : val >= 3 ? "Medium" : "Low"
                    );
                    return (
                      <div key={i} style={{
                        background: GOLD_LIGHT,
                        border: `1px solid ${GOLD_BORDER}`,
                        borderRadius: 16, padding: "14px 18px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                            <span style={{
                              minWidth: 24, height: 24, borderRadius: "50%",
                              background: GOLD_MID, color: GOLD,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
                            }}>{i + 1}</span>
                            <span style={{ fontSize: 13.5, color: DEEP_PURPLE, lineHeight: 1.55, fontWeight: 500 }}>
                              {a.question_text ?? a.question_id}
                            </span>
                          </div>
                          <span style={{
                            flexShrink: 0,
                            background: rStyle.bg, color: rStyle.text,
                            border: `1px solid ${rStyle.border}`,
                            borderRadius: 999, padding: "3px 12px",
                            fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                          }}>
                            {a.label ?? `Score ${val}`}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 34 }}>
                          <div style={{ flex: 1, height: 5, background: GOLD_MID, borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${aPct}%`, background: rStyle.bar, borderRadius: 999 }} />
                          </div>
                          <span style={{ fontSize: 11, color: MUTED, fontWeight: 400 }}>{val}/{maxVal}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "36px 0", color: MUTED, fontSize: 13 }}>
                  No answer details available for this section.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── footer ──────────────────────────────────────────────────────── */}
        {data.references?.basis && (
          <div style={{
            padding: "14px 32px",
            borderTop: `1px solid ${GOLD_MID}`,
            background: GOLD_LIGHT,
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <ShieldCheck size={15} color={GOLD} style={{ marginTop: 2, flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
              <strong style={{ color: DEEP_PURPLE }}>Reference:</strong> {data.references.basis}. This report is for support planning and reasonable adjustments, not diagnosis.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
