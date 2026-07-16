import { ShieldCheck } from "lucide-react";
import { API_BASE } from "../api";

export default function AdminLoginPage() {
  const handleMicrosoftLogin = () => {
    window.location.href = `${API_BASE}/admin/auth/microsoft/start/`;
  };

  return (
    <div className="admin-login-page">
      <main className="admin-login-shell">
        <section className="admin-login-panel">
          <div className="admin-login-brand">
            <img src="/kbc-logo.png" alt="Kent Business College" />
            <div>
              <span>Staff access</span>
              <h1>KBC Admin Login</h1>
            </div>
          </div>

          <button
            className="admin-ms-btn admin-ms-btn-primary"
            type="button"
            onClick={handleMicrosoftLogin}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            Continue with Microsoft Teams
          </button>
        </section>
      </main>
    </div>
  );
}
