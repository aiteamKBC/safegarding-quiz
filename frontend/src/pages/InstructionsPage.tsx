import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, type InstructionsResponse } from "../api";

export default function InstructionsPage() {
  const [data, setData] = useState<InstructionsResponse | null>(null);
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch<InstructionsResponse>("/quiz/instructions/")
      .then(setData)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load instructions";
        setError(message);
      });
  }, []);

  const handleGenerate = async () => {
    try {
      const result = await apiFetch<{ attempt_id: number; message: string }>("/quiz/start/", {
        method: "POST",
      });
      navigate(`/quiz/${result.attempt_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start quiz";
      setError(message);
    }
  };

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <div className="card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <h1>{data.quiz.title}</h1>
        <p>
          <strong>Learner:</strong> {data.learner.full_name}
        </p>
        <p>{data.quiz.instructions}</p>
        <button className="primary-btn" onClick={handleGenerate}>Start Assessment</button>
      </div>
    </div>
  );
}