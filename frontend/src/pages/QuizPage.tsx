import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  apiFetch,
  type Question,
  type QuestionsResponse,
  type SubmitAnswerItem,
  type SubmitQuizResponse,
} from "../api";

type AnswersMap = Record<number, string>;

type QuestionGroup = {
  key: string;
  categoryNo: number;
  categoryName: string;
  questions: Question[];
};

export default function QuizPage() {
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(0);

  useEffect(() => {
    apiFetch<QuestionsResponse>("/quiz/questions/")
      .then((data) => setQuestions(data.questions))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load questions";
        setError(message);
      });
  }, []);

  const groupedQuestions = useMemo<QuestionGroup[]>(() => {
    const groups: Record<string, Question[]> = {};

    questions.forEach((q) => {
      const key = `${q.category_no}-${q.category_name}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(q);
    });

    return Object.entries(groups).map(([key, items]) => ({
      key,
      categoryNo: items[0].category_no,
      categoryName: items[0].category_name,
      questions: items.sort((a, b) => a.order - b.order),
    }));
  }, [questions]);

  const totalQuestions = questions.length;
  const answeredCount = Object.values(answers).filter(Boolean).length;
  const progressPercent = totalQuestions
    ? Math.round((answeredCount / totalQuestions) * 100)
    : 0;

  const totalPages = groupedQuestions.length;
  const currentGroup = groupedQuestions[currentPage];

  const updateAnswer = (questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleNext = () => {
    if (!currentGroup) return;

    const unansweredInPage = currentGroup.questions.filter(
      (q) => q.is_required && !answers[q.id]
    );

    if (unansweredInPage.length > 0) {
      setError("Please answer all questions in this section before continuing.");
      return;
    }

    setError("");
    setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1));
  };

  const handlePrevious = () => {
    setError("");
    setCurrentPage((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = async () => {
    const unansweredRequired = questions.filter(
      (q) => q.is_required && !answers[q.id]
    );

    if (unansweredRequired.length > 0) {
      setError("Please answer all required questions before submitting.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const answersPayload: SubmitAnswerItem[] = Object.entries(answers).map(
        ([questionId, answer]) => ({
          question_id: Number(questionId),
          answer,
        })
      );

      const response = await apiFetch<SubmitQuizResponse>("/quiz/submit/", {
        method: "POST",
        body: JSON.stringify({
          answers: answersPayload,
        }),
      });

      console.log("submit response", response);

      navigate(`/results/${response.attempt_id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit assessment";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentGroup && !error) {
    return (
      <div className="survey-page">
        <div className="survey-shell">
          <div className="survey-card">
            <p>Loading questions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-page">
      <div className="survey-shell">
        <div className="survey-topbar">
          <div>
            <h1 className="survey-title">Wellbeing & Safeguarding Assessment</h1>
          </div>

          <div className="survey-page-indicator">
            Page {Math.min(currentPage + 1, totalPages || 1)} of {totalPages || 1}
          </div>
        </div>

        <div className="survey-progress-wrap">
          <div className="survey-progress-bar">
            <div
              className="survey-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="survey-progress-text">
            {answeredCount} of {totalQuestions} answered
          </div>
        </div>

        <div className="survey-instruction-box">
          <strong>Instructions:</strong>
          <p>
            In the last two weeks, to what extent do you agree with the following statements?
            ({currentGroup?.questions?.[0]?.min_score ?? 1} = Strongly disagree,{" "}
            {currentGroup?.questions?.[0]?.max_score ?? 10} = Strongly agree)
          </p>
        </div>

        {currentGroup && (
          <div className="survey-section">
            {currentGroup.questions.map((q) => (
              <div key={q.id} className="survey-question-card">
                <div className="survey-chip">
                  {q.construct_type || currentGroup.categoryName}
                </div>

                <h3 className="survey-question-title">
                  {q.order}. {q.text}
                </h3>

                <div className="survey-scale-row">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className={`survey-scale-option ${answers[q.id] === opt ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`question-${q.id}`}
                        value={opt}
                        checked={answers[q.id] === opt}
                        onChange={() => updateAnswer(q.id, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>

                <div className="survey-scale-labels">
                  <span>Strongly disagree</span>
                  <span>Strongly agree</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="error survey-error">{error}</p>}

        <div className="survey-footer-nav">
          <button
            className="secondary-btn"
            onClick={handlePrevious}
            disabled={currentPage === 0 || submitting}
          >
            Previous
          </button>

          {currentPage < totalPages - 1 ? (
            <button className="primary-btn" onClick={handleNext} disabled={submitting}>
              Next
            </button>
          ) : (
            <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}