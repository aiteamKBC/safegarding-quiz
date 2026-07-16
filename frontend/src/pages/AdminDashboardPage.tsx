import { useEffect, useState } from "react";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  adminApiFetch,
  clearAdminToken,
  setToken,
  type AdminMeResponse,
  type AdminUser,
  type AdminLearner,
  type AdminLearnersResponse,
  type AdminLearnerTokenResponse,
  getAdminToken,
} from "../api";

export default function AdminDashboardPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [learners, setLearners] = useState<AdminLearner[]>([]);
  const [error, setError] = useState<string>("");
  const [openingLearnerId, setOpeningLearnerId] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!getAdminToken()) {
      navigate("/admin/login");
      return;
    }

    Promise.all([
      adminApiFetch<AdminMeResponse>("/admin/me/"),
      adminApiFetch<AdminLearnersResponse>("/admin/learners/"),
    ])
      .then(([meData, learnersData]) => {
        setAdmin(meData.admin);
        setLearners(learnersData.learners);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Could not load admin session";
        setError(message);
      });
  }, [navigate]);

  const handleLogout = () => {
    clearAdminToken();
    localStorage.removeItem("admin_email");
    localStorage.removeItem("admin_name");
    navigate("/admin/login");
  };

  const handleOpenLearner = async (learnerId: number) => {
    setError("");
    setOpeningLearnerId(learnerId);
    try {
      const data = await adminApiFetch<AdminLearnerTokenResponse>(
        `/admin/learners/${learnerId}/token/`,
        { method: "POST" }
      );
      setToken(data.token);
      localStorage.setItem("learner_email", data.learner.email);
      navigate(data.next_route || "/onboarding");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not open learner";
      setError(message);
    } finally {
      setOpeningLearnerId(null);
    }
  };

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <div className="admin-topbar-title">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <span>Admin dashboard</span>
            <h1>Safeguarding Control Centre</h1>
          </div>
        </div>
        <button className="admin-logout-btn" type="button" onClick={handleLogout}>
          <LogOut size={16} aria-hidden="true" />
          Logout
        </button>
      </header>

      <main className="admin-dashboard-shell">
        <section className="admin-dashboard-panel">
          <p className="admin-eyebrow">Signed in</p>
          <h2>{admin?.full_name || localStorage.getItem("admin_name") || "KBC Admin"}</h2>
          <p>{admin?.email || localStorage.getItem("admin_email") || ""}</p>
          {error && <p className="admin-login-error">{error}</p>}
        </section>

        <section className="admin-dashboard-panel admin-learners-panel">
          <div className="admin-section-head">
            <div>
              <p className="admin-eyebrow">Learners</p>
              <h2>Open inclusion journey</h2>
            </div>
            <span>{learners.length} linked</span>
          </div>

          {learners.length === 0 ? (
            <p>No learners are linked to this admin email yet.</p>
          ) : (
            <div className="admin-learner-list">
              {learners.map((learner) => (
                <article className="admin-learner-row" key={learner.id}>
                  <div className="admin-learner-main">
                    <UserRound size={18} aria-hidden="true" />
                    <div>
                      <strong>{learner.full_name || learner.email || `Learner ${learner.id}`}</strong>
                      <span>{learner.email}</span>
                      {learner.programme && <small>{learner.programme}</small>}
                    </div>
                  </div>
                  <button
                    className="admin-open-btn"
                    type="button"
                    onClick={() => handleOpenLearner(learner.id)}
                    disabled={openingLearnerId === learner.id}
                  >
                    {openingLearnerId === learner.id ? "Opening..." : "Open inclusion"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
