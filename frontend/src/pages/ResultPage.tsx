import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    apiFetch,
    apiFetchForm,
    type ResultResponse,
    type AutomationDashboardResponse,
    type CreateTicketResponse,
} from "../api";

const SECTION_TITLES: Record<string, string> = {
    ai_wellbeing_summary: "Wellbeing Summary",
    what_matters_now: "What Matters Now",
    overall_wellbeing: "Overall Wellbeing",
    workplace_experience: "Workplace Experience",
    support_from_kbc: "Support From KBC",
    personalised_recommendations: "Personalised Recommendations",
    resources_self_help: "Self-Help Resources",
};

const SECTION_ICONS: Record<string, string> = {
    ai_wellbeing_summary: "🧠",
    what_matters_now: "💡",
    overall_wellbeing: "🌱",
    workplace_experience: "💼",
    support_from_kbc: "🏫",
    personalised_recommendations: "🎯",
    resources_self_help: "📚",
};

function sectionTitle(key: string) {
    return SECTION_TITLES[key] ?? key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function getRecIcon(category: string, tag: string, title: string): string {
    const t = `${category} ${tag} ${title}`.toLowerCase();
    if (t.includes("sleep") || t.includes("rest")) return "💤";
    if (t.includes("breath")) return "🫁";
    if (t.includes("exercise") || t.includes("walk") || t.includes("movement") || t.includes("physical") || t.includes("active")) return "🏃";
    if (t.includes("social") || t.includes("connect") || t.includes("talk") || t.includes("friend") || t.includes("relationship")) return "💬";
    if (t.includes("stress") || t.includes("relax") || t.includes("calm") || t.includes("anxiety")) return "🌿";
    if (t.includes("mind") || t.includes("mental") || t.includes("mood") || t.includes("emotional")) return "🧠";
    if (t.includes("screen") || t.includes("digital") || t.includes("device") || t.includes("break")) return "📵";
    if (t.includes("journal") || t.includes("write") || t.includes("reflect") || t.includes("gratitude")) return "✍️";
    if (t.includes("food") || t.includes("nutrition") || t.includes("eat") || t.includes("hydrat")) return "🥗";
    if (t.includes("goal") || t.includes("focus") || t.includes("plan") || t.includes("organis") || t.includes("organiz")) return "🎯";
    if (t.includes("safe") || t.includes("safeguard")) return "🛡️";
    if (t.includes("support") || t.includes("help") || t.includes("coach")) return "🤝";
    return "✨";
}

function getResourceIcon(title: string, code: string): string {
    const t = `${title} ${code}`.toLowerCase();
    if (t.includes("breath")) return "🫁";
    if (t.includes("sleep")) return "💤";
    if (t.includes("stress")) return "🌿";
    if (t.includes("wellbeing") || t.includes("well-being")) return "💚";
    if (t.includes("mindful") || t.includes("meditat")) return "🧘";
    if (t.includes("exercise") || t.includes("movement") || t.includes("walk") || t.includes("physical")) return "🏃";
    if (t.includes("nutrition") || t.includes("food") || t.includes("eat")) return "🥗";
    if (t.includes("social") || t.includes("connect") || t.includes("relationship")) return "💬";
    if (t.includes("safe") || t.includes("guide")) return "🛡️";
    if (t.includes("goal") || t.includes("focus") || t.includes("plan")) return "🎯";
    return "📖";
}

function getWhatMattersIcon(type: string, text: string): { icon: string; cls: string } {
    const t = `${type} ${text}`.toLowerCase();
    if (type === "positive") return { icon: "✓", cls: "wm-positive" };
    if (type === "concern" || type === "negative") return { icon: "!", cls: "wm-concern" };
    if (t.includes("sleep")) return { icon: "💤", cls: "wm-neutral" };
    return { icon: "→", cls: "wm-neutral" };
}

const STATUS_LABEL_MAP: Record<string, { icon: string; className: string }> = {
    Improving: { icon: "↑", className: "status-improving" },
    Watch: { icon: "◎", className: "status-watch" },
    "Next step": { icon: "→", className: "status-next" },
    Observation: { icon: "◉", className: "status-observation" },
};

const SAFEGUARDING_EMAIL = "safeguarding@kentbusinesscollege.com";

function getEmailServices(email: string) {
    const e = encodeURIComponent(email);
    return [
        { name: "Outlook 365", sub: "Work / school account (Office 365)", url: `https://outlook.office.com/mail/deeplink/compose?to=${e}` },
        { name: "Outlook.com", sub: "Personal Microsoft account", url: `https://outlook.live.com/mail/deeplink/compose?to=${e}` },
        { name: "Gmail", sub: "mail.google.com", url: `https://mail.google.com/mail/?view=cm&fs=1&to=${e}` },
        { name: "Yahoo Mail", sub: "mail.yahoo.com", url: `https://compose.mail.yahoo.com/?to=${e}` },
    ];
}

function isEmailUrl(url: string): boolean {
    return url.startsWith("mailto:") || /^[^\s/]+@[^\s/]+\.[^\s/]+$/.test(url);
}

function extractEmail(url: string): string {
    return url.startsWith("mailto:") ? url.replace("mailto:", "").split("?")[0] : url;
}

export default function ResultPage() {
    const { attemptId } = useParams<{ attemptId: string }>();
    const navigate = useNavigate();

    const [result, setResult] = useState<ResultResponse | null>(null);
    const [automationData, setAutomationData] = useState<AutomationDashboardResponse | null>(null);
    const [error, setError] = useState<string>("");

    const [activeResource, setActiveResource] = useState<{
        title: string; code: string;
        source_url: string; source_title: string; bullet_points: string[];
    } | null>(null);

    const [showEmailPicker, setShowEmailPicker] = useState<string | null>(null);

    const [showAnnounceModal, setShowAnnounceModal] = useState(false);
    const [announceLoading, setAnnounceLoading] = useState(false);
    const [announceError, setAnnounceError] = useState("");
    const [announceDone, setAnnounceDone] = useState(false);

    const [ticketType, setTicketType] = useState<"wellbeing" | "safeguarding" | null>(null);
    const [ticketSubmitting, setTicketSubmitting] = useState(false);
    const [ticketError, setTicketError] = useState("");
    const [ticketSuccess, setTicketSuccess] = useState("");
    const [ticketForm, setTicketForm] = useState({
        full_name: "",
        email: "",
        subject: "",
        details: "",
        urgency: "medium" as "low" | "medium" | "high" | "critical",
        preferred_contact: "email" as "email" | "phone" | "teams",
    });
    const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
    const evidenceInputRef = useRef<HTMLInputElement>(null);

    const [automationLoading, setAutomationLoading] = useState(true);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Referral form
    const [showReferral, setShowReferral] = useState(false);
    const [referralSubmitting, setReferralSubmitting] = useState(false);
    const [referralError, setReferralError] = useState("");
    const [referralSuccess, setReferralSuccess] = useState("");
    const [referralForm, setReferralForm] = useState({
        referrer_name: "", referrer_role: "", referrer_dept: "", referrer_contact: "",
        learner_fullname: "", learner_dob: "", learner_programme: "", learner_id: "", learner_coach: "",
        concern_description: "",
        concern_date: new Date().toISOString().split("T")[0],
        concern_time: new Date().toTimeString().slice(0, 5),
        concern_location: "", concern_those_present: "",
        risk_physical: false, risk_sexual: false, risk_emotional: false,
        risk_radicalisation: false, risk_neglect: false, risk_financial: false,
        risk_domestic: false, risk_slavery: false, risk_forced_marriage: false,
        risk_online: false, risk_self_harm: false, risk_bullying: false,
        risk_other: "",
        action_taken: "",
        dsl_name: "", dsl_datetime: "",
        consent: false,
    });
    const updateReferral = (field: string, value: string | boolean) =>
        setReferralForm((p) => ({ ...p, [field]: value }));

    useEffect(() => {
        apiFetch<ResultResponse>(`/quiz/results/${attemptId}/`)
            .then(setResult)
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Failed to load result");
            });
    }, [attemptId]);

    useEffect(() => {
        if (!result) return;

        let polls = 0;
        const MAX_POLLS = 12;
        const MIN_WAIT_MS = 15_000;
        const startTime = Date.now();

        const fetchAutomation = () => {
            apiFetch<AutomationDashboardResponse>(
                `/quiz/results/${attemptId}/automation-dashboard/`
            )
                .then((data) => {
                    polls += 1;
                    const dashboard = data.apprentice_dashboard;
                    const hasContent =
                        !data.message &&
                        dashboard &&
                        typeof dashboard === "object" &&
                        Object.keys(dashboard).length > 0;

                    const minWaitMet = Date.now() - startTime >= MIN_WAIT_MS;

                    if (polls >= MAX_POLLS || (hasContent && minWaitMet)) {
                        setAutomationData(data);
                        setAutomationLoading(false);
                    } else {
                        pollTimerRef.current = setTimeout(fetchAutomation, 5000);
                    }
                })
                .catch(() => {
                    setAutomationData(null);
                    setAutomationLoading(false);
                });
        };

        fetchAutomation();

        return () => {
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        };
    }, [result, attemptId]);

    useEffect(() => {
        if (!result?.learner) return;
        setTicketForm((prev) => ({
            ...prev,
            full_name: result.learner.name || "",
            email: result.learner.email || "",
        }));
        setReferralForm((prev) => ({
            ...prev,
            learner_fullname: result.learner.name || "",
            learner_programme: result.learner.programme || "",
            learner_id: String(result.attempt_id || ""),
        }));
    }, [result]);

    const handleReferralSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setReferralSubmitting(true);
        setReferralError("");
        setReferralSuccess("");

        const refNum = `SR-${Date.now().toString().slice(-5)}`;
        const risks = [
            referralForm.risk_physical && "Physical harm",
            referralForm.risk_sexual && "Sexual harm",
            referralForm.risk_emotional && "Emotional / Mental health",
            referralForm.risk_radicalisation && "Radicalisation / Extremism",
            referralForm.risk_neglect && "Neglect",
            referralForm.risk_financial && "Financial harm",
            referralForm.risk_domestic && "Domestic abuse",
            referralForm.risk_slavery && "Modern slavery / exploitation",
            referralForm.risk_forced_marriage && "Forced marriage / honour-based violence",
            referralForm.risk_online && "Online safety",
            referralForm.risk_self_harm && "Self-harm",
            referralForm.risk_bullying && "Bullying / Harassment",
            referralForm.risk_other && referralForm.risk_other,
        ].filter(Boolean);

        const details = [
            `SAFEGUARDING REFERRAL — ${refNum}`,
            "",
            "PART 1 — REFERRER DETAILS",
            `Name: ${referralForm.referrer_name} | Role: ${referralForm.referrer_role} | Dept: ${referralForm.referrer_dept} | Contact: ${referralForm.referrer_contact}`,
            "",
            "PART 2 — LEARNER DETAILS",
            `Name: ${referralForm.learner_fullname} | Programme: ${referralForm.learner_programme} | ID: ${referralForm.learner_id} | DOB: ${referralForm.learner_dob} | Coach: ${referralForm.learner_coach}`,
            "",
            "PART 3 — NATURE OF CONCERN",
            referralForm.concern_description,
            `Date: ${referralForm.concern_date} | Time: ${referralForm.concern_time} | Location: ${referralForm.concern_location} | Those Present: ${referralForm.concern_those_present}`,
            "",
            "PART 4 — RISK INDICATORS",
            ...risks.map((r) => `• ${r}`),
            "",
            "PART 5 — ACTION TAKEN SO FAR",
            referralForm.action_taken,
            "",
            "PART 6 — REFERRAL TO DSL",
            `DSL Name: ${referralForm.dsl_name} | Date & Time: ${referralForm.dsl_datetime}`,
            "",
            "PART 7 — CONSENT",
            referralForm.consent
                ? "Referrer confirms consent has been considered in line with safeguarding policy."
                : "Consent not confirmed.",
        ].join("\n");

        try {
            await apiFetch<CreateTicketResponse>("/tickets/create/", {
                method: "POST",
                body: JSON.stringify({
                    ticket_type: "safeguarding",
                    full_name: referralForm.learner_fullname,
                    email: result?.learner.email || "",
                    subject: `Safeguarding Referral — ${refNum}`,
                    details,
                    urgency: "high",
                    preferred_contact: "email",
                }),
            });
            setReferralSuccess(`Referral ${refNum} submitted successfully.`);
        } catch (err) {
            setReferralError(err instanceof Error ? err.message : "Failed to submit referral");
        } finally {
            setReferralSubmitting(false);
        }
    };

    const openTicketForm = (type: "wellbeing" | "safeguarding") => {
        setTicketType(type);
        setTicketError("");
        setTicketSuccess("");
        setTicketForm((prev) => ({
            ...prev,
            subject: type === "wellbeing" ? "Wellbeing support request" : "Safeguarding concern",
            urgency: type === "safeguarding" ? "high" : "medium",
        }));
    };

    const closeTicketForm = () => { setTicketType(null); setTicketError(""); setTicketSuccess(""); setEvidenceFiles([]); };

    const handleEvidenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(e.target.files || []);
        setEvidenceFiles((prev) => {
            const combined = [...prev, ...selected];
            return combined.slice(0, 5);
        });
        if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    };

    const removeEvidence = (idx: number) =>
        setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));

    const handleAnnounceEmployer = async () => {
        setAnnounceLoading(true);
        setAnnounceError("");
        try {
            await apiFetch(`/quiz/results/${attemptId}/notify-employer/`, { method: "POST" });

            setAnnounceDone(true);
        } catch (err) {
            setAnnounceError(err instanceof Error ? err.message : "Failed to send notification");
        } finally {
            setAnnounceLoading(false);
        }
    };

    const updateTicketField = (field: keyof typeof ticketForm, value: string) =>
        setTicketForm((prev) => ({ ...prev, [field]: value }));

    const handleTicketSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!ticketType) return;
        setTicketSubmitting(true);
        setTicketError("");
        setTicketSuccess("");
        try {
            const fd = new FormData();
            fd.append("ticket_type", ticketType);
            fd.append("full_name", ticketForm.full_name);
            fd.append("email", ticketForm.email);
            fd.append("subject", ticketForm.subject);
            fd.append("details", ticketForm.details);
            fd.append("urgency", ticketForm.urgency);
            fd.append("preferred_contact", ticketForm.preferred_contact);
            evidenceFiles.forEach((f) => fd.append("evidence", f));

            const response = await apiFetchForm<CreateTicketResponse>("/tickets/create/", fd);
            const evidenceMsg = response.evidence_count ? ` (${response.evidence_count} file${response.evidence_count > 1 ? "s" : ""} attached)` : "";
            setTicketSuccess((response.message || "Ticket submitted successfully.") + evidenceMsg);
            setEvidenceFiles([]);
            setTicketForm((prev) => ({
                ...prev,
                subject: ticketType === "wellbeing" ? "Wellbeing support request" : "Safeguarding concern",
                details: "",
                urgency: ticketType === "safeguarding" ? "high" : "medium",
                preferred_contact: "email",
            }));
        } catch (err) {
            setTicketError(err instanceof Error ? err.message : "Failed to submit ticket");
        } finally {
            setTicketSubmitting(false);
        }
    };

    if (error) {
        return (
            <div className="student-page"><div className="student-shell">
                <div className="student-card"><p className="error">{error}</p></div>
            </div></div>
        );
    }

    if (!result) {
        return (
            <div className="student-page">
                <div className="student-shell">

                    {/* Header skeleton */}
                    <div className="skeleton-card">
                        <div className="skeleton-header-row">
                            <div className="skeleton-bone skeleton-title" />
                            <div className="skeleton-chip-row">
                                <div className="skeleton-bone skeleton-btn" />
                                <div className="skeleton-bone skeleton-btn" />
                            </div>
                        </div>
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line-m" />
                    </div>

                    {/* Message skeleton */}
                    <div className="skeleton-card">
                        <div className="skeleton-bone skeleton-title" style={{ width: "45%" }} />
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line-m" />
                    </div>

                    {/* AI summary skeleton */}
                    <div className="skeleton-card">
                        <div className="skeleton-section-header">
                            <div className="skeleton-bone skeleton-icon" />
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div className="skeleton-bone skeleton-title" style={{ width: "40%" }} />
                                <div className="skeleton-bone skeleton-sub" />
                            </div>
                        </div>
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line-m" />
                        <div className="skeleton-bone skeleton-line-s" />
                    </div>

                    {/* Recommendations skeleton */}
                    <div className="skeleton-card">
                        <div className="skeleton-section-header">
                            <div className="skeleton-bone skeleton-icon" />
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div className="skeleton-bone skeleton-title" style={{ width: "50%" }} />
                                <div className="skeleton-bone skeleton-sub" />
                            </div>
                        </div>
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line" />
                        <div className="skeleton-bone skeleton-line-m" />
                    </div>

                    {/* Resources skeleton */}
                    <div className="skeleton-card">
                        <div className="skeleton-section-header">
                            <div className="skeleton-bone skeleton-icon" />
                            <div className="skeleton-bone skeleton-title" style={{ width: "35%" }} />
                        </div>
                        <div className="skeleton-chip-row">
                            {[130, 100, 150, 110, 90].map((w, i) => (
                                <div key={i} className="skeleton-bone skeleton-chip" style={{ width: w }} />
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        );
    }

    const firstName = result.learner.name?.split(" ")[0] || "";
    const dash = automationData?.apprentice_dashboard as Record<string, any> | undefined;
    const rawSections = dash?.raw_sections as Record<string, any> | undefined;

    // personalised_recommendations
    const personalised_recommendations: {
        title: string; reason: string; tag: string;
        category: string; suggested_timeline: string; tags: string[];
    }[] = Array.isArray(dash?.personalised_recommendations)
            ? dash.personalised_recommendations
                .map((r: any) => ({
                    title: r.title || "",
                    reason: r.reason || "",
                    tag: r.tag || "",
                    category: r.category || "",
                    suggested_timeline: r.suggested_timeline || "",
                    tags: Array.isArray(r.tags) ? r.tags.filter(Boolean) : [],
                }))
                .filter((r: any) => r.title)
            : [];

    // resources_self_help
    const resources_self_help: {
        title: string; code: string;
        source_url: string; source_title: string; bullet_points: string[];
    }[] = Array.isArray(dash?.resources_self_help)
            ? dash.resources_self_help
                .map((r: any) =>
                    typeof r === "string"
                        ? { title: r, code: "", source_url: "", source_title: "", bullet_points: [] }
                        : {
                            title: r.title || "",
                            code: r.code || "",
                            source_url: r.source_url || "",
                            source_title: r.source_title || "",
                            bullet_points: Array.isArray(r.bullet_points) ? r.bullet_points.filter(Boolean) : [],
                        }
                )
                .filter((r: any) => r.title)
            : [];

    // what_matters_now
    const what_matters_now: { type: string; text: string }[] = (() => {
        const items = dash?.what_matters_now;
        if (!Array.isArray(items)) return [];
        return items
            .map((i: any) =>
                typeof i === "string"
                    ? { type: "neutral", text: i }
                    : { type: i.type || "neutral", text: i.text || "" }
            )
            .filter((i) => i.text);
    })();

    // ai_wellbeing_summary — string or status-object fallback
    const aiSummaryText: string =
        typeof dash?.ai_wellbeing_summary === "string" ? dash.ai_wellbeing_summary : "";
    const aiSummaryRaw = rawSections?.ai_wellbeing_summary;
    const aiStatuses: { label: string; text: string }[] = [];
    if (aiSummaryRaw && typeof aiSummaryRaw === "object" && !Array.isArray(aiSummaryRaw)) {
        ["status_1", "status_2", "status_3"].forEach((key) => {
            const s = aiSummaryRaw[key];
            if (s?.label && s?.text) aiStatuses.push({ label: s.label, text: s.text });
        });
    }
    const hasAiSummary = aiStatuses.length > 0 || !!aiSummaryText;

    // overall_wellbeing / workplace_experience / support_from_kbc from raw_sections
    const rawDetailSections = (
        ["overall_wellbeing", "workplace_experience", "support_from_kbc"] as const
    )
        .map((key) => {
            const sec = rawSections?.[key] as Record<string, any> | undefined;
            if (!sec) return null;
            const ai_insights: string[] = Array.isArray(sec.ai_insights)
                ? sec.ai_insights.filter((s: any) => typeof s === "string" && s.trim())
                : [];
            const recommended_actions: string[] = Array.isArray(sec.recommended_actions)
                ? sec.recommended_actions.filter((s: any) => typeof s === "string" && s.trim())
                : [];
            if (!ai_insights.length && !recommended_actions.length) return null;
            return { key, ai_insights, recommended_actions };
        })
        .filter(Boolean) as { key: string; ai_insights: string[]; recommended_actions: string[] }[];

    return (
        <div className="student-page">
            <div className="student-shell">

                {/* Header */}
                <div className="student-card thank-card">
                    <div className="thank-card-top">
                        <h1>Thank you{firstName ? `, ${firstName}` : ""}</h1>
                        <div className="thank-card-actions">
                            <div className="tooltip-wrap">
                                <button
                                    className="announce-btn"
                                    onClick={() => {
                                        setShowAnnounceModal(true);
                                        setAnnounceError("");
                                        setAnnounceDone(false);
                                    }}
                                >
                                    📢 Notify employer
                                </button>
                                <div className="tooltip-box">
                                    This will <strong>not</strong> share your quiz scores or personal responses.
                                    It sends your employer a list of wellbeing tips to discuss with you in a check-up.
                                </div>
                            </div>
                            <button className="retake-btn" onClick={() => navigate("/instructions")}>
                                ↺ Retake Survey
                            </button>
                        </div>
                    </div>
                    <p>
                        You've completed your Wellbeing &amp; Safeguarding check-in.
                        Your responses have been recorded and your coach will be able to
                        review them as part of your ongoing support.
                    </p>
                    <p style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--kent-text)", marginTop: 12, fontWeight: 600 }}>
                        "Please feel free to reach out if you have any questions or concerns. Only Safeguarding leads will have access to these tickets."
                    </p>

                    <div className="results-privacy-hint">
                        🔒 Your quiz results are confidential and shared only with your coach — not your employer.
                    </div>
                </div>

                {/* Supportive message */}
                <div className="student-card message-card message-neutral">
                    <h2>We're glad you took the time to check in</h2>
                    <p>
                        Checking in on your wellbeing is a positive step, and we appreciate
                        you taking a few minutes to share how things are going.
                    </p>
                    <p>
                        Your coach may be in touch with you soon to see how you're getting on.
                        In the meantime, if there's anything on your mind, you're always welcome
                        to reach out — that's what your support team is here for.
                    </p>
                </div>

                {/* AI sections loading state */}
                {automationLoading && (
                    <div className="skeleton-card" style={{ alignItems: "center", flexDirection: "row", gap: 16 }}>
                        <div className="skeleton-bone skeleton-icon" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                            <div className="skeleton-bone skeleton-title" style={{ width: "50%" }} />
                            <div className="skeleton-bone skeleton-line" />
                            <div className="skeleton-bone skeleton-line-m" />
                        </div>
                    </div>
                )}

                {/* ai_wellbeing_summary */}
                {!automationLoading && hasAiSummary && (
                    <div className="student-card">
                        <div className="section-header">
                            <span className="section-icon">{SECTION_ICONS.ai_wellbeing_summary}</span>
                            <div>
                                <h3>{sectionTitle("ai_wellbeing_summary")}</h3>
                                <p className="section-sub">A summary based on your latest responses.</p>
                            </div>
                        </div>
                        {aiStatuses.length > 0 ? (
                            <div className="ai-status-list">
                                {aiStatuses.map((s, i) => {
                                    const meta = STATUS_LABEL_MAP[s.label] ?? { icon: "•", className: "status-next" };
                                    return (
                                        <div className={`ai-status-item ${meta.className}`} key={i}>
                                            <span className="ai-status-label">
                                                <span className="ai-status-icon">{meta.icon}</span>
                                                {s.label}
                                            </span>
                                            <p>{s.text}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="ai-summary-text">{aiSummaryText}</p>
                        )}
                    </div>
                )}

                {/* what_matters_now */}
                {!automationLoading && what_matters_now.length > 0 && (
                    <div className="student-card">
                        <div className="section-header">
                            <span className="section-icon">{SECTION_ICONS.what_matters_now}</span>
                            <div>
                                <h3>{sectionTitle("what_matters_now")}</h3>
                                <p className="section-sub">Key things we noticed from your responses.</p>
                            </div>
                        </div>
                        <div className="what-matters-list">
                            {what_matters_now.map((item, idx) => {
                                const { icon, cls } = getWhatMattersIcon(item.type, item.text);
                                return (
                                    <div className={`what-matters-item ${cls}`} key={idx}>
                                        <span className="wm-dot">{icon}</span>
                                        <span>{item.text}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* overall_wellbeing / workplace_experience / support_from_kbc */}
                {!automationLoading && rawDetailSections.map((sec) => (
                    <div className="student-card" key={sec.key}>
                        <div className="section-header">
                            <span className="section-icon">{SECTION_ICONS[sec.key] ?? "📋"}</span>
                            <h3>{sectionTitle(sec.key)}</h3>
                        </div>

                        {sec.ai_insights.length > 0 && (
                            <div className="insight-block">
                                <span className="insight-block-label">AI Insights</span>
                                <div className="insight-list">
                                    {sec.ai_insights.map((text, i) => (
                                        <div className="insight-item" key={i}>
                                            <span className="insight-dot insight-dot-ai">💡</span>
                                            <span>{text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {sec.recommended_actions.length > 0 && (
                            <div className="insight-block">
                                <span className="insight-block-label">Recommended Actions</span>
                                <div className="insight-list">
                                    {sec.recommended_actions.map((text, i) => (
                                        <div className="insight-item" key={i}>
                                            <span className="insight-dot insight-dot-action">→</span>
                                            <span>{text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {/* personalised_recommendations */}
                {!automationLoading && personalised_recommendations.length > 0 && (
                    <div className="student-card">
                        <div className="section-header">
                            <span className="section-icon">{SECTION_ICONS.personalised_recommendations}</span>
                            <div>
                                <h3>{sectionTitle("personalised_recommendations")}</h3>
                                <p className="section-sub">Tailored suggestions to support your wellbeing this week.</p>
                            </div>
                        </div>
                        <div className="rec-list">
                            {personalised_recommendations.map((rec, i) => {
                                const icon = getRecIcon(rec.category, rec.tag, rec.title);
                                return (
                                    <div className="rec-item" key={i}>
                                        <span className="rec-icon">{icon}</span>
                                        <div className="rec-body">
                                            <div className="rec-title-row">
                                                <strong>{rec.title}</strong>
                                                {rec.tag && <span className="rec-tag">{rec.tag}</span>}
                                            </div>
                                            {rec.category && (
                                                <span className="rec-category">{rec.category}</span>
                                            )}
                                            {rec.reason && (
                                                <p className="rec-reason">{rec.reason}</p>
                                            )}
                                            {(rec.suggested_timeline || rec.tags.length > 0) && (
                                                <div className="rec-meta">
                                                    {rec.suggested_timeline && (
                                                        <span className="rec-timeline">
                                                            <span>⏱</span> {rec.suggested_timeline}
                                                        </span>
                                                    )}
                                                    {rec.tags.map((t, ti) => (
                                                        <span className="rec-subtag" key={ti}>{t}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* resources_self_help */}
                {!automationLoading && resources_self_help.length > 0 && (
                    <div className="student-card">
                        <div className="section-header">
                            <span className="section-icon">{SECTION_ICONS.resources_self_help}</span>
                            <div>
                                <h3>{sectionTitle("resources_self_help")}</h3>
                                <p className="section-sub">Useful material you can explore in your own time.</p>
                            </div>
                        </div>
                        <div className="resource-chip-grid">
                            {resources_self_help.map((r, i) => (
                                <button
                                    key={i}
                                    className="resource-chip"
                                    onClick={() => setActiveResource(r)}
                                    type="button"
                                >
                                    <span className="resource-chip-icon">{getResourceIcon(r.title, r.code)}</span>
                                    <span>{r.title}</span>
                                    {r.bullet_points.length > 0 && (
                                        <span className="resource-chip-hint">Tips</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* What happens next */}
                <div className="student-card">
                    <h3>What happens next?</h3>
                    <div className="step-list">
                        <div className="step-item">
                            <span className="step-number">1</span>
                            <p>Your coach will review your check-in and may reach out to you soon.</p>
                        </div>
                        <div className="step-item">
                            <span className="step-number">2</span>
                            <p>Any concerns you raised will be followed up confidentially by the right team.</p>
                        </div>
                        <div className="step-item">
                            <span className="step-number">3</span>
                            <p>You'll be invited to complete another check-in in the coming weeks to see how you're getting on.</p>
                        </div>
                    </div>
                </div>

                {/* Raise a concern + Support contacts */}
                <div className="student-two-col">
                    <div className="student-card">
                        <h3>Would you like someone to contact you?</h3>
                        <p>
                            If you'd like to speak to someone sooner, you can raise a concern below.
                            It's completely confidential.
                        </p>
                        <button className="wellbeing-btn" onClick={() => openTicketForm("wellbeing")}>
                            I'd like wellbeing support
                        </button>
                        <button className="safeguarding-btn" onClick={() => openTicketForm("safeguarding")}>
                            I have a safeguarding concern
                        </button>
                        <button className="referral-btn" onClick={() => { setShowReferral(true); setReferralError(""); setReferralSuccess(""); }}>
                            Submit Safeguarding Referral
                        </button>
                    </div>

                    <div className="student-card">
                        <h3>Support contacts</h3>
                        <div className="student-contacts">
                            <div className="student-contact-item">
                                <strong>Safeguarding Lead</strong>
                                <span>Yousef Sultan & Tina Wright</span>
                                <button
                                    className="email-link-btn"
                                    onClick={() => setShowEmailPicker(SAFEGUARDING_EMAIL)}
                                >
                                    ✉ {SAFEGUARDING_EMAIL}
                                </button>
                            </div>
                            <div className="student-contact-item">
                                <strong>Wellbeing Support</strong>
                                <span>Nada Ibrahim & Alex Pennington</span>
                                <button
                                    className="email-link-btn"
                                    onClick={() => setShowEmailPicker(SAFEGUARDING_EMAIL)}
                                >
                                    ✉ {SAFEGUARDING_EMAIL}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            {/* Resource popup */}
            {activeResource && (
                <div className="ticket-modal-overlay" onClick={() => setActiveResource(null)}>
                    <div className="resource-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="resource-modal-header">
                            <div className="resource-modal-title">
                                <span className="resource-modal-icon">
                                    {getResourceIcon(activeResource.title, activeResource.code)}
                                </span>
                                <h3>{activeResource.title}</h3>
                            </div>
                            <button className="ticket-close-btn" onClick={() => setActiveResource(null)}>×</button>
                        </div>

                        {activeResource.bullet_points.length > 0 && (
                            <ul className="resource-modal-bullets">
                                {activeResource.bullet_points.map((bp, i) => (
                                    <li key={i}>{bp}</li>
                                ))}
                            </ul>
                        )}

                        {activeResource.source_url && (
                            isEmailUrl(activeResource.source_url) ? (
                                <button
                                    className="resource-source-link"
                                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                                    onClick={() => {
                                        setActiveResource(null);
                                        setShowEmailPicker(extractEmail(activeResource.source_url));
                                    }}
                                >
                                    <span>✉</span>
                                    <span>{activeResource.source_title || extractEmail(activeResource.source_url)}</span>
                                    <span className="resource-link-arrow">→</span>
                                </button>
                            ) : (
                                <a
                                    className="resource-source-link"
                                    href={activeResource.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <span>📖</span>
                                    <span>{activeResource.source_title || "Read more"}</span>
                                    <span className="resource-link-arrow">→</span>
                                </a>
                            )
                        )}
                    </div>
                </div>
            )}

            {/* Announce to employer modal */}
            {showAnnounceModal && (
                <div className="ticket-modal-overlay" onClick={() => setShowAnnounceModal(false)}>
                    <div className="resource-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="ticket-modal-header">
                            <div>
                                <h3>📢 Notify your employer</h3>
                                <p className="email-picker-address">A check-up nudge — no scores shared</p>
                            </div>
                            <button className="ticket-close-btn" onClick={() => setShowAnnounceModal(false)}>×</button>
                        </div>

                        {!announceDone ? (
                            <>
                                <div className="announce-what-shared">
                                    <div className="announce-row announce-row-no">
                                        <span className="announce-badge announce-badge-no">✕ Not shared</span>
                                        <span>Your quiz scores, risk level, or personal responses</span>
                                    </div>
                                    <div className="announce-row announce-row-yes">
                                        <span className="announce-badge announce-badge-yes">✓ Shared</span>
                                        <span>A brief list of wellbeing tips for your employer to discuss with you in a check-up</span>
                                    </div>
                                </div>

                                {personalised_recommendations.length > 0 && (
                                    <div className="announce-preview">
                                        <span className="insight-block-label">Topics your employer will see</span>
                                        <ul className="announce-preview-list">
                                            {personalised_recommendations.slice(0, 4).map((r, i) => (
                                                <li key={i}>{r.title}</li>
                                            ))}
                                            {personalised_recommendations.length > 4 && (
                                                <li className="announce-preview-more">
                                                    +{personalised_recommendations.length - 4} more topics
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                )}

                                {announceError && <p className="error" style={{ marginTop: 12 }}>{announceError}</p>}

                                <div className="ticket-actions" style={{ marginTop: 20 }}>
                                    <button type="button" className="secondary-btn" onClick={() => setShowAnnounceModal(false)}>
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="announce-send-btn"
                                        disabled={announceLoading}
                                        onClick={handleAnnounceEmployer}
                                    >
                                        {announceLoading ? "Sending…" : "📢 Send notification"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="announce-done">
                                <span className="announce-done-icon">✓</span>
                                <p>Your employer has been notified. They'll receive a list of wellbeing tips to review with you.</p>
                                <button className="secondary-btn" style={{ marginTop: 16 }} onClick={() => setShowAnnounceModal(false)}>
                                    Close
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Email picker modal */}
            {showEmailPicker && (
                <div className="ticket-modal-overlay" onClick={() => setShowEmailPicker(null)}>
                    <div className="email-picker-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="ticket-modal-header">
                            <div>
                                <h3>Send an email</h3>
                                <p className="email-picker-address">{showEmailPicker}</p>
                            </div>
                            <button className="ticket-close-btn" onClick={() => setShowEmailPicker(null)}>×</button>
                        </div>
                        <p className="email-picker-hint">Choose your email app to open a compose window:</p>
                        <div className="email-service-list">
                            {getEmailServices(showEmailPicker).map((s) => (
                                <a
                                    key={s.name}
                                    className="email-service-row"
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setShowEmailPicker(null)}
                                >
                                    <span className="email-service-icon">✉</span>
                                    <span className="email-service-info">
                                        <strong>{s.name}</strong>
                                        <span>{s.sub}</span>
                                    </span>
                                    <span className="email-service-arrow">→</span>
                                </a>
                            ))}
                            <a
                                className="email-service-row email-service-default"
                                href={`mailto:${showEmailPicker}`}
                                onClick={() => setShowEmailPicker(null)}
                            >
                                <span className="email-service-icon">📧</span>
                                <span className="email-service-info">
                                    <strong>Default mail app</strong>
                                    <span>Opens your system's default email client</span>
                                </span>
                                <span className="email-service-arrow">→</span>
                            </a>
                        </div>
                        <button
                            className="email-picker-cancel"
                            onClick={() => setShowEmailPicker(null)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Ticket modal */}
            {ticketType && (
                <div className="ticket-modal-overlay" onClick={closeTicketForm}>
                    <div className="ticket-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="ticket-modal-header">
                            <h3>
                                {ticketType === "wellbeing" ? "Create Wellbeing Ticket" : "Create Safeguarding Ticket"}
                            </h3>
                            <button className="ticket-close-btn" onClick={closeTicketForm}>×</button>
                        </div>
                        <form className="ticket-form" onSubmit={handleTicketSubmit}>
                            <div className="ticket-form-grid">
                                <div>
                                    <label>Full name</label>
                                    <input type="text" value={ticketForm.full_name}
                                        onChange={(e) => updateTicketField("full_name", e.target.value)} required />
                                </div>
                                <div>
                                    <label>Email</label>
                                    <input type="email" value={ticketForm.email}
                                        onChange={(e) => updateTicketField("email", e.target.value)} required />
                                </div>
                            </div>
                            <div>
                                <label>Subject</label>
                                <input type="text" value={ticketForm.subject}
                                    onChange={(e) => updateTicketField("subject", e.target.value)} required />
                            </div>
                            <div>
                                <label>Details</label>
                                <textarea rows={5} value={ticketForm.details}
                                    onChange={(e) => updateTicketField("details", e.target.value)}
                                    placeholder={
                                        ticketType === "wellbeing"
                                            ? "Describe the wellbeing support you need"
                                            : "Describe the safeguarding concern"
                                    } required />
                            </div>
                            <div className="ticket-form-grid">
                                <div>
                                    <label>Urgency</label>
                                    <select value={ticketForm.urgency}
                                        onChange={(e) => updateTicketField("urgency", e.target.value)}>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                        {ticketType === "safeguarding" && (
                                            <option value="critical">Critical</option>
                                        )}
                                    </select>
                                </div>
                                {ticketType === "safeguarding" ? (
                                    <div>
                                        <label>Contact</label>
                                        <div className="ticket-contact-info">
                                            <span className="ticket-contact-icon">✉</span>
                                            <span>safeguarding@kentbusinesscollege.com</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label>Preferred contact</label>
                                        <select value={ticketForm.preferred_contact}
                                            onChange={(e) => updateTicketField("preferred_contact", e.target.value)}>
                                            <option value="email">Email</option>
                                            <option value="phone">Phone</option>
                                            <option value="teams">Teams</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className="evidence-upload-wrap">
                                <label className="evidence-label">
                                    Evidence <span className="evidence-hint">(optional · images & PDF · max 5 files · 10 MB each)</span>
                                </label>
                                <div className="evidence-drop-zone" onClick={() => evidenceInputRef.current?.click()}>
                                    <span className="evidence-drop-icon">📎</span>
                                    <span>Click to attach files</span>
                                </div>
                                <input
                                    ref={evidenceInputRef}
                                    type="file"
                                    multiple
                                    accept="image/*,.pdf,.doc,.docx"
                                    onChange={handleEvidenceChange}
                                    style={{ display: "none" }}
                                />
                                {evidenceFiles.length > 0 && (
                                    <ul className="evidence-file-list">
                                        {evidenceFiles.map((f, i) => (
                                            <li key={i} className="evidence-file-item">
                                                <span className="evidence-file-icon">
                                                    {f.type.startsWith("image/") ? "🖼" : "📄"}
                                                </span>
                                                <span className="evidence-file-name">{f.name}</span>
                                                <span className="evidence-file-size">
                                                    ({(f.size / 1024).toFixed(0)} KB)
                                                </span>
                                                <button
                                                    type="button"
                                                    className="evidence-remove-btn"
                                                    onClick={() => removeEvidence(i)}
                                                    title="Remove"
                                                >×</button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {ticketError && <p className="error">{ticketError}</p>}
                            {ticketSuccess && <p className="ticket-success">{ticketSuccess}</p>}
                            <div className="ticket-actions">
                                <button type="button" className="secondary-btn" onClick={closeTicketForm}>Cancel</button>
                                <button type="submit" className="primary-btn" disabled={ticketSubmitting}>
                                    {ticketSubmitting ? "Submitting..." : "Submit Ticket"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Safeguarding Referral Modal */}
            {showReferral && (
                <div className="ticket-modal-overlay" onClick={() => setShowReferral(false)}>
                    <div className="referral-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="referral-modal-header">
                            <div className="referral-modal-title">
                                <div>
                                    <p className="referral-ref-num">A unique reference number will be auto-generated</p>
                                    <h2>Safeguarding Referral Form</h2>
                                    <p className="referral-subtitle">This form is to be used to report a safeguarding concern about a learner. All concerns must be reported in line with Ofsted safeguarding expectations.</p>
                                </div>
                            </div>
                            <button className="ticket-close-btn" onClick={() => setShowReferral(false)}>×</button>
                        </div>

                        <form className="referral-form" onSubmit={handleReferralSubmit}>

                            {/* Part 1 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 1: <span>Details of Referrer</span></h4>
                                <div className="referral-grid-2">
                                    <div className="referral-field"><label>Name</label><input value={referralForm.referrer_name} onChange={(e) => updateReferral("referrer_name", e.target.value)} required /></div>
                                    <div className="referral-field"><label>Role</label><input value={referralForm.referrer_role} onChange={(e) => updateReferral("referrer_role", e.target.value)} /></div>
                                    <div className="referral-field"><label>Department</label><input value={referralForm.referrer_dept} onChange={(e) => updateReferral("referrer_dept", e.target.value)} /></div>
                                    <div className="referral-field"><label>Contact Details</label><input value={referralForm.referrer_contact} onChange={(e) => updateReferral("referrer_contact", e.target.value)} /></div>
                                </div>
                            </div>

                            {/* Part 2 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 2: <span>Details of Learner</span></h4>
                                <div className="referral-grid-2">
                                    <div className="referral-field"><label>Full Name</label><input value={referralForm.learner_fullname} onChange={(e) => updateReferral("learner_fullname", e.target.value)} required /></div>
                                    <div className="referral-field"><label>Date of Birth</label><input type="date" value={referralForm.learner_dob} onChange={(e) => updateReferral("learner_dob", e.target.value)} /></div>
                                    <div className="referral-field"><label>Learner's Programme</label><input value={referralForm.learner_programme} onChange={(e) => updateReferral("learner_programme", e.target.value)} /></div>
                                    <div className="referral-field"><label>Learner ID</label><input value={referralForm.learner_id} onChange={(e) => updateReferral("learner_id", e.target.value)} /></div>
                                    <div className="referral-field referral-field-full"><label>Skills Coach Name</label><input value={referralForm.learner_coach} onChange={(e) => updateReferral("learner_coach", e.target.value)} /></div>
                                </div>
                            </div>

                            {/* Part 3 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 3: <span>Nature of Concern</span></h4>
                                <div className="referral-field"><label>Description</label><textarea rows={4} value={referralForm.concern_description} onChange={(e) => updateReferral("concern_description", e.target.value)} required /></div>
                                <div className="referral-grid-4">
                                    <div className="referral-field"><label>Date</label><input type="date" value={referralForm.concern_date} onChange={(e) => updateReferral("concern_date", e.target.value)} /></div>
                                    <div className="referral-field"><label>Time</label><input type="time" value={referralForm.concern_time} onChange={(e) => updateReferral("concern_time", e.target.value)} /></div>
                                    <div className="referral-field"><label>Location</label><input value={referralForm.concern_location} onChange={(e) => updateReferral("concern_location", e.target.value)} /></div>
                                    <div className="referral-field"><label>Those Present</label><input value={referralForm.concern_those_present} onChange={(e) => updateReferral("concern_those_present", e.target.value)} /></div>
                                </div>
                            </div>

                            {/* Part 4 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 4: <span>Risk Indicators</span></h4>
                                <div className="referral-checks">
                                    {([
                                        ["risk_physical", "Physical harm"],
                                        ["risk_sexual", "Sexual harm"],
                                        ["risk_emotional", "Emotional / Mental health"],
                                        ["risk_radicalisation", "Radicalisation / Extremism"],
                                        ["risk_neglect", "Neglect"],
                                        ["risk_financial", "Financial harm"],
                                        ["risk_domestic", "Domestic abuse"],
                                        ["risk_slavery", "Modern slavery / exploitation"],
                                        ["risk_forced_marriage", "Forced marriage / honour-based violence"],
                                        ["risk_online", "Online safety"],
                                        ["risk_self_harm", "Self-harm"],
                                        ["risk_bullying", "Bullying / Harassment"],
                                    ] as [string, string][]).map(([key, label]) => (
                                        <label key={key} className="referral-check-item">
                                            <input type="checkbox" checked={referralForm[key as keyof typeof referralForm] as boolean} onChange={(e) => updateReferral(key, e.target.checked)} />
                                            <span>{label}</span>
                                        </label>
                                    ))}
                                    <div className="referral-field" style={{ gridColumn: "1/-1", marginTop: 4 }}>
                                        <label>Other (specify)</label>
                                        <input value={referralForm.risk_other} onChange={(e) => updateReferral("risk_other", e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            {/* Part 5 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 5: <span>Action Taken So Far</span></h4>
                                <div className="referral-field"><textarea rows={3} value={referralForm.action_taken} onChange={(e) => updateReferral("action_taken", e.target.value)} /></div>
                            </div>

                            {/* Part 6 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 6: <span>Referral to DSL</span></h4>
                                <div className="referral-grid-2">
                                    <div className="referral-field"><label>DSL Name</label><input value={referralForm.dsl_name} onChange={(e) => updateReferral("dsl_name", e.target.value)} /></div>
                                    <div className="referral-field"><label>Date &amp; Time</label><input type="datetime-local" value={referralForm.dsl_datetime} onChange={(e) => updateReferral("dsl_datetime", e.target.value)} /></div>
                                </div>
                            </div>

                            {/* Part 7 */}
                            <div className="referral-part">
                                <h4 className="referral-part-title">Part 7: <span>Consent</span></h4>
                                <label className="referral-check-item">
                                    <input type="checkbox" checked={referralForm.consent} onChange={(e) => updateReferral("consent", e.target.checked)} />
                                    <span>I confirm that consent has been considered in line with safeguarding policy.</span>
                                </label>
                            </div>

                            {referralError && <p className="error" style={{ marginTop: 8 }}>{referralError}</p>}
                            {referralSuccess && <p className="ticket-success" style={{ marginTop: 8 }}>{referralSuccess}</p>}

                            <div className="ticket-actions" style={{ marginTop: 20 }}>
                                <button type="button" className="secondary-btn" onClick={() => setShowReferral(false)}>Cancel</button>
                                <button type="submit" className="referral-submit-btn" disabled={referralSubmitting}>
                                    {referralSubmitting ? "Submitting..." : "Submit Referral"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
