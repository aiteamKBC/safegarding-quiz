import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, type MessageResponse } from "../api";

export default function ThanksPage() {
    const { attemptId } = useParams<{ attemptId: string }>();
    const navigate = useNavigate();
    const [message, setMessage] = useState<string>("");

    const handleSend = async () => {
        try {
            const data = await apiFetch<MessageResponse>(`/quiz/results/${attemptId}/send-to-employer/`, {
                method: "POST",
            });
            setMessage(data.message);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to send result";
            setMessage(msg);
        }
    };

    return (
        <div className="page">
            <div className="card">
                <h1>Thanks for submitting your answers</h1>
                <div className="actions">
                    <button className="primary-btn" onClick={() => navigate(`/result/${attemptId}`)}>
                        View result
                    </button>
                    <button className="secondary-btn" onClick={handleSend}>
                        Send results to employer
                    </button>
                </div>
                {message && <p>{message}</p>}
            </div>
        </div>
    );
}