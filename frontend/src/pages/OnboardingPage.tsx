import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

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

type Answers = Record<number, number>; // question.id → option value

// ── SVG layout ────────────────────────────────────────────────────────────────

const NODE_POS = [
  { x: 70,  y: 270 },
  { x: 230, y: 145 },
  { x: 400, y: 185 },
  { x: 565, y: 270 },
  { x: 730, y: 150 },
  { x: 915, y: 110 },
];

const PATH_D =
  "M 70,270 C 140,270 155,145 230,145 " +
  "C 305,145 330,185 400,185 " +
  "C 475,185 490,270 565,270 " +
  "C 645,270 660,150 730,150 " +
  "C 810,150 840,110 915,110";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();

  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsError, setSectionsError] = useState("");

  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  // modal state
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const [modalData, setModalData] = useState<SectionQuestions | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [answers, setAnswers] = useState<Answers>({});

  // safeguarding start
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  // Load sections on mount
  useEffect(() => {
    apiFetch<{ sections: Section[] }>("/onboarding/sections/")
      .then((d) => setSections(d.sections))
      .catch((err: unknown) => {
        setSectionsError(err instanceof Error ? err.message : "Failed to load sections");
      });
  }, []);

  const firstUncompletedSection = sections.find((s) => !completedIds.has(s.section_id));
  const allDone = sections.length > 0 && completedIds.size === sections.length;

  function nodeState(section: Section): "completed" | "current" | "locked" {
    if (completedIds.has(section.section_id)) return "completed";
    if (firstUncompletedSection?.section_id === section.section_id) return "current";
    return "locked";
  }

  async function handleNodeClick(section: Section) {
    const s = nodeState(section);
    if (s === "locked") return;

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
      // Convert answers { dbId(number): value(number) } → { "dbId": value }
      const answersPayload: Record<string, number> = {};
      for (const [k, v] of Object.entries(answers)) {
        answersPayload[String(k)] = v;
      }

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

  async function handleBeginSafeguarding() {
    setStarting(true);
    setStartError("");
    try {
      const res = await apiFetch<{ attempt_id: number }>("/quiz/start/", { method: "POST" });
      navigate(`/quiz/${res.attempt_id}`);
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : "Failed to start");
      setStarting(false);
    }
  }

  // How many required questions are answered in the current modal
  const requiredQuestions = modalData?.questions.filter((q) => q.required) ?? [];
  const answeredRequired = requiredQuestions.filter((q) => answers[q.id] !== undefined).length;
  const canSubmit = requiredQuestions.length === 0 || answeredRequired === requiredQuestions.length;

  // Group modal questions by sub_section
  const questionGroups: { sub: string; questions: Question[] }[] = [];
  if (modalData) {
    for (const q of modalData.questions) {
      const sub = q.sub_section || "";
      const last = questionGroups[questionGroups.length - 1];
      if (last && last.sub === sub) {
        last.questions.push(q);
      } else {
        questionGroups.push({ sub, questions: [q] });
      }
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────

  if (sectionsError) {
    return (
      <div className="ob-page">
        <div className="ob-header">
          <p style={{ color: "var(--kent-danger-text)" }}>{sectionsError}</p>
        </div>
      </div>
    );
  }

  const displaySections = sections.length > 0 ? sections : Array.from({ length: 6 });

  return (
    <div className="ob-page">
      {/* Header */}
      <div className="ob-header">
        <div className="ob-eyebrow">Wellbeing &amp; Safeguarding</div>
        <h1 className="ob-title">Your Assessment Journey</h1>
        <p className="ob-subtitle">
          Complete each questionnaire below, then begin the main safeguarding assessment.
        </p>
      </div>

      {/* Journey SVG */}
      <div className="ob-map-wrap">
        <svg
          className="ob-svg"
          viewBox="0 0 1000 380"
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={PATH_D} className="ob-path-bg" />

          {displaySections.map((section, i) => {
            const pos = NODE_POS[i] ?? { x: 80 + i * 160, y: 200 };
            if (!section) {
              // skeleton node while loading
              return (
                <g key={i}>
                  <circle cx={pos.x} cy={pos.y} r={24} className="ob-circle ob-node-locked" style={{ opacity: 0.3 }} />
                </g>
              );
            }
            const s = nodeState(section as Section);
            const clickable = s !== "locked";

            return (
              <g
                key={(section as Section).section_id}
                className={`ob-node ob-node-${s}`}
                onClick={() => handleNodeClick(section as Section)}
                style={{ cursor: clickable ? "pointer" : "default" }}
                tabIndex={clickable ? 0 : -1}
                onKeyDown={(e) => e.key === "Enter" && handleNodeClick(section as Section)}
              >
                {s === "current" && (
                  <circle cx={pos.x} cy={pos.y} r={38} className="ob-pulse-ring" />
                )}
                {s === "completed" && (
                  <circle cx={pos.x} cy={pos.y} r={30} className="ob-done-ring" />
                )}

                <circle cx={pos.x} cy={pos.y} r={24} className="ob-circle" />

                {s === "completed" ? (
                  <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central" className="ob-check">✓</text>
                ) : (
                  <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central" className={s === "locked" ? "ob-lock" : "ob-num"}>
                    {i + 1}
                  </text>
                )}

                <text x={pos.x} y={pos.y - 40} textAnchor="middle" className="ob-num-label">{i + 1}</text>

                {/* Wrap title into 2 lines if long */}
                <foreignObject x={pos.x - 65} y={pos.y + 34} width={130} height={40} style={{ overflow: "visible" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: "center",
                      lineHeight: 1.3,
                      color: s === "completed" ? "var(--color-4)" : s === "current" ? "#fff" : "rgba(255,255,255,0.35)",
                      wordBreak: "break-word",
                    }}
                  >
                    {(section as Section).section_title}
                  </div>
                </foreignObject>

                {s === "current" && (
                  <g>
                    <rect x={pos.x - 30} y={pos.y + 80} width={60} height={20} rx={10} className="ob-start-badge" />
                    <text x={pos.x} y={pos.y + 90} textAnchor="middle" dominantBaseline="central" className="ob-start-text">START</text>
                  </g>
                )}
                {s === "completed" && (
                  <g>
                    <rect x={pos.x - 26} y={pos.y + 80} width={52} height={18} rx={9} className="ob-done-badge" />
                    <text x={pos.x} y={pos.y + 89} textAnchor="middle" dominantBaseline="central" className="ob-done-text">DONE</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Progress bar */}
      <div className="ob-progress-wrap">
        <div className="ob-progress-bar">
          <div
            className="ob-progress-fill"
            style={{ width: sections.length ? `${(completedIds.size / sections.length) * 100}%` : "0%" }}
          />
        </div>
        <span className="ob-progress-label">
          {completedIds.size} of {sections.length || "–"} completed
        </span>
      </div>

      {/* CTA after all done */}
      {allDone && (
        <div className="ob-cta">
          <p>You've completed all pre-assessments. Ready to begin the main wellbeing &amp; safeguarding assessment?</p>
          {startError && <p className="ob-cta-error">{startError}</p>}
          <button className="ob-begin-btn" onClick={handleBeginSafeguarding} disabled={starting}>
            {starting ? "Starting…" : "Begin Safeguarding Assessment →"}
          </button>
        </div>
      )}

      {/* ── Modal ── */}
      {openSection && (
        <div className="ob-overlay" onClick={handleCloseModal}>
          <div className="ob-modal" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
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

            {/* Body */}
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
                          <div className="ob-options-row">
                            {q.options.map((opt) => (
                              <button
                                key={opt.value}
                                className={`ob-option-btn ${answers[q.id] === opt.value ? "ob-option-selected" : ""}`}
                                onClick={() => handleAnswer(q.id, opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
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
