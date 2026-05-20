import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

import { LearnerReportModal, type FullSectionReport } from "../components/LearnerReportModal";
import {
  Laptop, Headphones, PenLine, Sparkles, Mic, HeartPulse,
  Play, Eye, Lock, Trophy, MoveUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = {
  section_id: string;
  section_title: string;
  section_order: number;
  question_count: number;
};

type Option = { label: string; value: number };

type Question = {
  id: number;
  question_id: string;
  question_order: number;
  sub_section: string;
  question_text: string;
  answer_type: string;
  required: boolean;
  options: Option[];
  score_min: number;
  score_max: number;
};

type SectionQuestions = {
  section_id: string;
  section_title: string;
  questions: Question[];
};

type Answers = Record<number, number>;
type SectionReport = FullSectionReport;

// ── 1-10 scale definition ─────────────────────────────────────────────────────

const SCALE_GROUPS = [
  { hint: "Never",              values: [1]     },
  { hint: "Rarely",             values: [2, 3]  },
  { hint: "Sometimes",          values: [4, 5]  },
  { hint: "Often",              values: [6, 7]  },
  { hint: "Very often",         values: [8, 9]  },
  { hint: "Always",             values: [10]    },
] as const;

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTION_ICONS = [Laptop, Headphones, PenLine, Sparkles, Mic, HeartPulse];

const SECTION_DESCRIPTIONS: Record<number, string> = {
  1: "Confidence with LMS, Teams, uploads and online platforms.",
  2: "Captions, readable materials and access adjustments.",
  3: "Reading, writing, processing and assignment support.",
  4: "Focus, planning, organisation and task completion.",
  5: "Presentations, speaking, camera, microphone and more.",
  6: "Energy, motivation, attendance and capacity to learn.",
};

// ── SVG / layout constants ────────────────────────────────────────────────────

const VB_W = 990;
const VB_H = 490;
const CARD_W = 130;
const CARD_HALF = CARD_W / 2;

const NODE_POS = [
  { x: 95,  y: 275 },
  { x: 255, y: 148 },
  { x: 415, y: 188 },
  { x: 570, y: 275 },
  { x: 730, y: 152 },
  { x: 890, y: 112 },
];

const PATH_D =
  "M 95,275 C 175,275 175,148 255,148 " +
  "C 335,148 335,188 415,188 " +
  "C 495,188 495,275 570,275 " +
  "C 650,275 650,152 730,152 " +
  "C 810,152 810,112 890,112";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();

  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsError, setSectionsError] = useState("");
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [reports, setReports] = useState<Record<string, SectionReport>>({});
  const [activeReport, setActiveReport] = useState<{ sectionTitle: string; data: SectionReport } | null>(null);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);

  const [openSection, setOpenSection] = useState<Section | null>(null);
  const [modalData, setModalData] = useState<SectionQuestions | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [quizStatus, setQuizStatus] = useState<{ has_history: boolean; attempt_id: number } | null>(null);

  useEffect(() => {
    Promise.allSettled([
      apiFetch<{ sections: Section[] }>("/onboarding/sections/"),
      apiFetch<{ completed_sections: string[] }>("/onboarding/progress/"),
      apiFetch<{ reports: Record<string, SectionReport> }>("/onboarding/reports/"),
    ]).then(([sectionsResult, progressResult, reportsResult]) => {
      if (sectionsResult.status === "fulfilled") {
        setSections(sectionsResult.value.sections);
      } else {
        setSectionsError("Failed to load sections");
      }
      if (progressResult.status === "fulfilled") {
        setCompletedIds(new Set(progressResult.value.completed_sections));
      }
      if (reportsResult.status === "fulfilled") {
        setReports(reportsResult.value.reports);
      }
    });
  }, []);

  const firstUncompletedSection = sections.find((s) => !completedIds.has(s.section_id));
  const allDone = sections.length > 0 && completedIds.size === sections.length;
  const pct = sections.length ? Math.round((completedIds.size / sections.length) * 100) : 0;

  // Default: last completed section → gives the learner their latest report.
  // Falls back to the first uncompleted section if nothing is done yet.
  useEffect(() => {
    if (selectedSection || sections.length === 0) return;
    const lastCompleted = [...sections].reverse().find((s) => completedIds.has(s.section_id));
    setSelectedSection(lastCompleted ?? firstUncompletedSection ?? null);
  }, [sections, completedIds]);

  // Poll for reports while any completed section is still waiting for its AI report
  useEffect(() => {
    const pendingReports = [...completedIds].filter((id) => !reports[id]);
    if (pendingReports.length === 0) return;

    const timer = setInterval(() => {
      apiFetch<{ reports: Record<string, SectionReport> }>("/onboarding/reports/")
        .then((data) => setReports(data.reports))
        .catch(() => {});
    }, 10_000);

    return () => clearInterval(timer);
  }, [completedIds, reports]);

  // Fetch quiz history status once all sections are done
  useEffect(() => {
    if (allDone && !quizStatus) {
      apiFetch<{ has_history: boolean; attempt_id: number }>("/quiz/status/")
        .then(setQuizStatus)
        .catch(() => setQuizStatus({ has_history: false, attempt_id: 0 }));
    }
  }, [allDone]);

  function nodeState(section: Section): "completed" | "current" | "locked" {
    if (completedIds.has(section.section_id)) return "completed";
    if (firstUncompletedSection?.section_id === section.section_id) return "current";
    return "locked";
  }

  async function openQuizModal(section: Section) {
    setOpenSection(section);
    setAnswers({});
    setModalData(null);
    setModalError("");
    setModalLoading(true);
    try {
      const data = await apiFetch<SectionQuestions>(
        `/onboarding/sections/${section.section_id}/questions/`
      );
      setModalData(data);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to load questions");
    } finally {
      setModalLoading(false);
    }
  }

  function handleAnswer(questionId: number, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleCloseModal() {
    setOpenSection(null);
    setModalData(null);
    setAnswers({});
  }

  async function handleSubmitSection() {
    if (!openSection) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const answersPayload: Record<string, number> = {};
      for (const [k, v] of Object.entries(answers)) answersPayload[String(k)] = v;
      await apiFetch(`/onboarding/sections/${openSection.section_id}/submit/`, {
        method: "POST",
        body: JSON.stringify({ answers: answersPayload }),
      });
      setCompletedIds((prev) => new Set([...prev, openSection.section_id]));
      handleCloseModal();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  const requiredQuestions = modalData?.questions.filter((q) => q.required) ?? [];
  const answeredRequired = requiredQuestions.filter((q) => answers[q.id] !== undefined).length;
  const canSubmit = requiredQuestions.length === 0 || answeredRequired === requiredQuestions.length;

  const questionGroups: { sub: string; questions: Question[] }[] = [];
  if (modalData) {
    for (const q of modalData.questions) {
      const sub = q.sub_section || "";
      const last = questionGroups[questionGroups.length - 1];
      if (last && last.sub === sub) last.questions.push(q);
      else questionGroups.push({ sub, questions: [q] });
    }
  }

  const selState = selectedSection ? nodeState(selectedSection) : null;
  const selIdx = selectedSection ? sections.findIndex((s) => s.section_id === selectedSection.section_id) : -1;
  void selIdx;
  const displaySections = sections.length > 0 ? sections : Array.from({ length: 6 }, () => null as unknown as Section);

  if (sectionsError) {
    return (
      <div className="ob-page">
        <p style={{ color: "var(--kent-danger-text)" }}>{sectionsError}</p>
      </div>
    );
  }

  return (
    <div className="ob-page">

      {/* ── Header ── */}
      <div className="ob-header">
        <div className="ob-eyebrow">Onboarding Dashboard</div>
        <h1 className="ob-title">Your Assessment Journey</h1>
        <p className="ob-subtitle">
          Complete each questionnaire in order. Your progress is saved automatically,
          and the main safeguarding assessment unlocks when all six areas are complete.
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="ob-stats-row">
        <div className="ob-stat-card ob-stat-card--count">
          <div className="ob-stat-eyebrow">Progress</div>
          <div className="ob-stat-big">{completedIds.size}/{sections.length || 6}</div>
          <div className="ob-stat-sub">questionnaires completed</div>
        </div>
        <div className="ob-stat-card ob-stat-card--bar">
          <div className="ob-stat-bar-top">
            <span className="ob-stat-eyebrow">Journey completion</span>
            <span className="ob-stat-pct">{pct}%</span>
          </div>
          <div className="ob-stat-progress-track">
            <div className="ob-stat-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="ob-stat-current-step">
            {allDone
              ? "All sections complete — ready to begin!"
              : firstUncompletedSection
              ? <>Current step: <strong>{firstUncompletedSection.section_title}</strong></>
              : "Loading…"}
          </div>
        </div>
      </div>

      {/* ── Journey map ── */}
      <div className="ob-map-wrap">
        <div className="ob-journey-bg">
          {/* Path SVG — behind cards */}
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            preserveAspectRatio="none"
          >
            <path d={PATH_D} className="ob-path-bg" />
          </svg>

          {/* Cards */}
          {displaySections.map((section, i) => {
            const pos = NODE_POS[i] ?? { x: 95 + i * 160, y: 200 };
            const cardLeftPct = ((pos.x - CARD_HALF) / VB_W) * 100;
            const cardTopPct  = ((pos.y - 52) / VB_H) * 100;
            const cardWidthPct = (CARD_W / VB_W) * 100;

            if (!section) {
              return (
                <div key={i} className="ob-card ob-card-skeleton" style={{
                  left: `${cardLeftPct}%`, top: `${cardTopPct}%`, width: `${cardWidthPct}%`,
                }} />
              );
            }

            const s = nodeState(section);
            const sectionId = section.section_id;
            const SectionIcon = SECTION_ICONS[(section.section_order ?? i + 1) - 1] ?? Laptop;
            const desc = SECTION_DESCRIPTIONS[section.section_order ?? (i + 1)] ?? "";
            const isSelected = selectedSection?.section_id === sectionId;

            return (
              <div
                key={sectionId}
                className={`ob-card ob-card-${s}${isSelected ? " ob-card-selected" : ""}`}
                style={{ left: `${cardLeftPct}%`, top: `${cardTopPct}%`, width: `${cardWidthPct}%` }}
                onClick={() => { if (s !== "locked") setSelectedSection(section); }}
              >
                <div className="ob-card-num">{i + 1}</div>
                <div className={`ob-card-circle ob-card-circle-${s}`}>
                  {s === "completed" ? "✓" : i + 1}
                </div>
                <div className="ob-card-icon">
                  <SectionIcon size={12} />
                </div>
                <div className="ob-card-title">{section.section_title}</div>
                <div className="ob-card-desc">{desc}</div>
                <div className="ob-card-footer">
                  {s === "completed" && (
                    <>
                      <span className="ob-card-badge ob-badge-done">DONE</span>
                      {reports[sectionId] && (
                        <button
                          className="ob-card-eye"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveReport({ sectionTitle: section.section_title, data: reports[sectionId] });
                          }}
                        >
                          <Eye size={12} />
                          <span className="ob-eye-tip">View report</span>
                        </button>
                      )}
                    </>
                  )}
                  {s === "current" && (
                    <button
                      className="ob-card-badge ob-badge-start"
                      onClick={(e) => { e.stopPropagation(); openQuizModal(section); }}
                    >
                      <Play size={9} fill="white" style={{ flexShrink: 0 }} /> START
                    </button>
                  )}
                  {s === "locked" && (
                    <span className="ob-card-badge ob-badge-locked">LOCKED</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom section ── */}
      <div className="ob-bottom-row">

        {/* Selected step panel */}
        <div className="ob-selected-panel">
          {selectedSection ? (() => {
            const report = reports[selectedSection.section_id];
            const risk   = report?.score?.riskLevel;
            const score  = report?.score?.total;
            const maxSc  = report?.score?.max ?? 10;
            const pctSc  = maxSc > 0 && score != null ? Math.round((score / maxSc) * 100) : null;
            const riskColors: Record<string, { bg: string; text: string }> = {
              "Very High": { bg: "#fef2f2", text: "#dc2626" },
              "High":      { bg: "#fff7ed", text: "#d97706" },
              "Medium":    { bg: "#eff6ff", text: "#3b82f6" },
              "Low":       { bg: "#f0fdf4", text: "#16a34a" },
            };
            const rc = risk ? (riskColors[risk] ?? riskColors["Low"]) : null;

            return (
              <>
                <div className="ob-sel-eyebrow">Selected Step</div>
                <h3 className="ob-sel-title">{selectedSection.section_title}</h3>
                <p className="ob-sel-desc">
                  {SECTION_DESCRIPTIONS[selectedSection.section_order ?? 1]}
                </p>

                {/* Report preview strip — only when report is ready */}
                {selState === "completed" && report && (
                  <div className="ob-sel-report-strip">
                    {risk && rc && (
                      <span className="ob-sel-risk-badge" style={{ background: rc.bg, color: rc.text }}>
                        {risk} risk
                      </span>
                    )}
                    {pctSc != null && (
                      <div className="ob-sel-score-bar">
                        <div className="ob-sel-score-fill" style={{ width: `${pctSc}%` }} />
                      </div>
                    )}
                    {score != null && (
                      <span className="ob-sel-score-label">{score}/{maxSc}</span>
                    )}
                  </div>
                )}

                <div className="ob-sel-footer">
                  {selState === "current" && (
                    <button className="ob-sel-btn ob-sel-btn--purple" onClick={() => openQuizModal(selectedSection)}>
                      <Play size={13} fill="white" /> Start questionnaire
                    </button>
                  )}
                  {selState === "completed" && report && (
                    <button
                      className="ob-sel-btn ob-sel-btn--gold"
                      onClick={() => setActiveReport({ sectionTitle: selectedSection.section_title, data: report })}
                    >
                      <Eye size={13} /> View Full Report
                    </button>
                  )}
                  {selState === "completed" && !report && (
                    <span className="ob-sel-done-chip">
                      <span className="ob-sel-done-spinner" /> Report generating…
                    </span>
                  )}
                  {selState === "locked" && (
                    <span className="ob-sel-locked-chip"><Lock size={12} /> Locked</span>
                  )}
                </div>

                <div className="ob-sel-hint">
                  <MoveUp size={11} />
                  Select a card from the journey map to explore a different section
                </div>
              </>
            );
          })() : (
            <p className="ob-sel-desc">Select a section from the journey above.</p>
          )}
        </div>

        {/* Main assessment panel */}
        <div className={`ob-main-panel${allDone ? " ob-main-panel--ready" : ""}`}>
          <div className="ob-main-header">
            <div className="ob-main-trophy">
              <Trophy size={20} />
            </div>
            <div>
              <div className="ob-sel-eyebrow">Main Assessment</div>
              <h3 className="ob-sel-title">Safeguarding assessment</h3>
            </div>
          </div>
          {allDone ? (
            <>
              <p className="ob-sel-desc">All pre-assessments complete. You're ready to begin the main wellbeing &amp; safeguarding assessment.</p>
              {quizStatus === null ? (
                <div className="ob-spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
              ) : quizStatus.has_history ? (
                <button
                  className="ob-sel-btn ob-sel-btn--purple"
                  onClick={() => navigate(`/results/${quizStatus.attempt_id}`)}
                >
                  Safeguarding Dashboard →
                </button>
              ) : (
                <button
                  className="ob-sel-btn ob-sel-btn--purple"
                  onClick={() => navigate("/instructions")}
                >
                  Begin Assessment →
                </button>
              )}
            </>
          ) : (
            <>
              <p className="ob-sel-desc">
                The main assessment becomes available after all six questionnaires are completed.
                This keeps the journey clear, structured and less overwhelming for learners.
              </p>
              <div className="ob-main-remaining">
                {Math.max(0, sections.length - completedIds.size)} step{sections.length - completedIds.size !== 1 ? "s" : ""} remaining
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Report Modal ── */}
      {activeReport && (
        <LearnerReportModal
          sectionTitle={activeReport.sectionTitle}
          data={activeReport.data}
          onClose={() => setActiveReport(null)}
        />
      )}

      {/* ── Quiz Modal ── */}
      {openSection && (
        <div className="ob-overlay" onClick={handleCloseModal}>
          <div className="ob-modal" onClick={(e) => e.stopPropagation()}>

            <div className="ob-modal-header">
              <div>
                <span className="ob-modal-badge">
                  Questionnaire {sections.findIndex((s) => s.section_id === openSection.section_id) + 1} of {sections.length}
                </span>
                <h2 className="ob-modal-title">{openSection.section_title}</h2>
                {modalData && (
                  <p className="ob-modal-subtitle">
                    {answeredRequired} of {requiredQuestions.length} required questions answered
                  </p>
                )}
              </div>
              <button className="ob-close-btn" onClick={handleCloseModal}>✕</button>
            </div>

            <div className="ob-questions-area">
              {modalLoading && (
                <div className="ob-loading">
                  <div className="ob-spinner" />
                  <p>Loading questions…</p>
                </div>
              )}
              {modalError && (
                <p style={{ color: "var(--kent-danger-text)", textAlign: "center" }}>{modalError}</p>
              )}
              {modalData && !modalLoading && (
                <div className="ob-question-list">
                  {questionGroups.map((group) => (
                    <div key={group.sub} className="ob-question-group">
                      {group.sub && (
                        <div className="ob-group-label">{group.sub.replace(/_/g, " ")}</div>
                      )}
                      {group.questions.map((q) => (
                        <div key={q.id} className={`ob-question-item ${answers[q.id] !== undefined ? "ob-question-answered" : ""}`}>
                          <p className="ob-question-text">
                            <span className="ob-q-num">{q.question_order}.</span>
                            {q.question_text}
                            {q.required && <span className="ob-required-dot" title="Required" />}
                          </p>
                          <div className="ob-scale-row">
                            {SCALE_GROUPS.map((group) => (
                              <div key={group.hint} className="ob-scale-group">
                                <span className="ob-scale-hint">{group.hint}</span>
                                <div className="ob-scale-nums">
                                  {group.values.map((v) => (
                                    <button
                                      key={v}
                                      className={`ob-scale-btn${answers[q.id] === v ? " ob-scale-selected" : ""}`}
                                      onClick={() => handleAnswer(q.id, v)}
                                    >
                                      {v}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {submitError && (
              <p style={{ color: "var(--kent-danger-text)", fontSize: 13, margin: "0 0 12px", textAlign: "right" }}>
                {submitError}
              </p>
            )}
            <div className="ob-modal-footer">
              <button className="ob-cancel-btn" onClick={handleCloseModal} disabled={submitting}>Cancel</button>
              {nodeState(openSection) === "completed" ? (
                <button className="ob-complete-btn ob-complete-btn--done" onClick={handleCloseModal}>
                  Already Completed ✓
                </button>
              ) : (
                <button
                  className="ob-complete-btn"
                  onClick={handleSubmitSection}
                  disabled={!canSubmit || modalLoading || !!modalError || submitting}
                >
                  {submitting
                    ? "Submitting…"
                    : canSubmit
                    ? "Submit & Continue →"
                    : `Answer ${requiredQuestions.length - answeredRequired} more`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
