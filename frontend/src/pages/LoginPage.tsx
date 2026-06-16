import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, type LoginResponse, setToken } from "../api";

export default function LoginPage() {
  const [email, setEmail] = useState<string>("");
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    try {
      const data = await apiFetch<LoginResponse>("/auth/login/", {
        method: "POST",
        body: JSON.stringify({ email }),
      });

      setToken(data.token);
      localStorage.setItem("learner_email", data.learner?.email ?? email);
      navigate(data.next_route || "/onboarding");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <div className="login-logo-wrap">
          <img src="/kbc-logo.png" alt="Kent Business College" className="login-logo" />
        </div>
        <h1>Wellbeing & Safeguarding Login</h1>
        <p>Please enter your Aptem learner email to log in.</p>

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Enter your Aptem learner email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit">Login</button>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}