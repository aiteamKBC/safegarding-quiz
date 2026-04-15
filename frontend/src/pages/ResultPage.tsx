import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    apiFetch,
    type ResultResponse,
    type AutomationDashboardResponse,
    type CreateTicketResponse,
} from "../api";

type TrendPoint = {
    label: string;
    mental: number;
    protective: number;
    provider: number;
    safeguarding: number;
    overall: number;
    risk_level?: string;
};

type TrendStatus = "improving" | "declining" | "stable";

function clampScore(value: number) {
    return Math.min(10, Math.max(0, Number(value) || 0));
}

function getTrendStatus(
    previous: number,
    current: number,
    threshold = 0.4
): TrendStatus {
    const diff = current - previous;

    if (diff <= -threshold) return "improving";
    if (diff >= threshold) return "declining";
    return "stable";
}

function formatScore(value: number | undefined) {
    return clampScore(value ?? 0).toFixed(1);
}

function toTitle(value: string) {
    return value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ResultPage() {
    const { attemptId } = useParams<{ attemptId: string }>();
    const navigate = useNavigate();

    const [result, setResult] = useState<ResultResponse | null>(null);
    const [automationData, setAutomationData] =
        useState<AutomationDashboardResponse | null>(null);
    const [error, setError] = useState<string>("");
    const [showAnswers, setShowAnswers] = useState(false);

    useEffect(() => {
        apiFetch<ResultResponse>(`/quiz/results/${attemptId}/`)
            .then(setResult)
            .catch((err: unknown) => {
                const message =
                    err instanceof Error ? err.message : "Failed to load result";
                setError(message);
            });

        apiFetch<AutomationDashboardResponse>(
            `/quiz/results/${attemptId}/automation-dashboard/`
        )
            .then(setAutomationData)
            .catch(() => {
                setAutomationData(null);
            });
    }, [attemptId]);

    const trendData = useMemo<TrendPoint[]>(() => {
        if (!result?.trends?.length) {
            return [
                {
                    label: "Now",
                    mental: clampScore(result?.scores?.mental ?? 0),
                    protective: clampScore(result?.scores?.protective ?? 0),
                    provider: clampScore(result?.scores?.provider ?? 0),
                    safeguarding: clampScore(result?.scores?.safeguarding ?? 0),
                    overall: clampScore(
                        result?.scores?.overall ?? result?.total_score ?? result?.score ?? 0
                    ),
                    risk_level: result?.risk_level ?? "Low",
                },
            ];
        }

        return result.trends.map((item) => ({
            label: item.label,
            mental: clampScore(item.mental),
            protective: clampScore(item.protective),
            provider: clampScore(item.provider),
            safeguarding: clampScore(item.safeguarding),
            overall: clampScore(item.overall),
            risk_level: item.risk_level,
        }));
    }, [result]);

    const latestScores = useMemo(() => {
        return {
            mental: clampScore(result?.scores?.mental ?? 0),
            protective: clampScore(result?.scores?.protective ?? 0),
            provider: clampScore(result?.scores?.provider ?? 0),
            safeguarding: clampScore(result?.scores?.safeguarding ?? 0),
            overall: clampScore(
                result?.scores?.overall ?? result?.total_score ?? result?.score ?? 0
            ),
        };
    }, [result]);

    const trendAnalysis = useMemo(() => {
        if (trendData.length < 2) {
            return {
                mental: "stable" as TrendStatus,
                protective: "stable" as TrendStatus,
                provider: "stable" as TrendStatus,
                safeguarding: "stable" as TrendStatus,
                overall: "stable" as TrendStatus,
            };
        }

        const previous = trendData[trendData.length - 2];
        const current = trendData[trendData.length - 1];

        return {
            mental: getTrendStatus(previous.mental, current.mental),
            protective: getTrendStatus(previous.protective, current.protective),
            provider: getTrendStatus(previous.provider, current.provider),
            safeguarding: getTrendStatus(previous.safeguarding, current.safeguarding),
            overall: getTrendStatus(previous.overall, current.overall),
        };
    }, [trendData]);

    const highestRiskArea = useMemo(() => {
        const areas = [
            {
                key: "mental",
                value: latestScores.mental,
                label: result?.score_labels?.mental ?? "Mental Health",
            },
            {
                key: "protective",
                value: latestScores.protective,
                label: result?.score_labels?.protective ?? "Protective Factors",
            },
            {
                key: "provider",
                value: latestScores.provider,
                label: result?.score_labels?.provider ?? "Provider Support",
            },
            {
                key: "safeguarding",
                value: latestScores.safeguarding,
                label: result?.score_labels?.safeguarding ?? "Safeguarding Risk",
            },
        ];

        return areas.sort((a, b) => b.value - a.value)[0];
    }, [latestScores, result]);

    const summaryItems = useMemo(() => {
        const items: string[] = [];

        if (highestRiskArea) {
            items.push(
                `${highestRiskArea.label} is currently the highest scoring area.`
            );
        }

        if (trendAnalysis.overall === "declining") {
            items.push(
                "Your overall risk trend has worsened compared with the previous submission."
            );
        } else if (trendAnalysis.overall === "improving") {
            items.push(
                "Your overall trend shows some improvement compared with the previous submission."
            );
        } else {
            items.push("Your overall trend is relatively stable at the moment.");
        }

        if ((result?.triggers?.high?.length ?? 0) > 0) {
            items.push(
                "There are high-priority safeguarding or wellbeing triggers that need attention."
            );
        } else if ((result?.triggers?.medium?.length ?? 0) > 0) {
            items.push("There are medium-priority indicators that should be followed up.");
        } else {
            items.push("There are no high-priority triggers in the latest submission.");
        }

        return items.slice(0, 3);
    }, [highestRiskArea, trendAnalysis, result]);

    const recommendations = useMemo(() => {
        const jsonRecommendations =
            automationData?.apprentice_dashboard?.personalised_recommendations;

        if (!Array.isArray(jsonRecommendations)) {
            return [];
        }

        return jsonRecommendations
            .filter(
                (item) =>
                    item &&
                    typeof item === "object" &&
                    typeof item.title === "string"
            )
            .map((item) => ({
                title: item.title || "Recommendation",
                text: item.reason || "",
                tag: item.tag || "SUPPORT",
                category: item.category || "",
                suggestedTimeline: item.suggested_timeline || "",
            }));
    }, [automationData]);

    const aiSummary = useMemo(() => {
        return (
            automationData?.apprentice_dashboard?.ai_wellbeing_summary ||
            automationData?.apprentice_dashboard?.summary ||
            ""
        );
    }, [automationData]);

    const whatMattersNow = useMemo(() => {
        const items = automationData?.apprentice_dashboard?.what_matters_now;
        return Array.isArray(items) ? items : [];
    }, [automationData]);

    const resources = useMemo(() => {
        const items = automationData?.apprentice_dashboard?.resources_self_help;
        return Array.isArray(items) ? items : [];
    }, [automationData]);

    const safeguardingTriggers = useMemo(() => {
        const items =
            automationData?.follow_up_by_coach?.issues?.safeguardingTriggers;
        return Array.isArray(items) ? items : [];
    }, [automationData]);

    const flaggedDomains = useMemo(() => {
        const items = automationData?.follow_up_by_coach?.issues?.flaggedDomains;
        return Array.isArray(items) ? items : [];
    }, [automationData]);

    const followUpCard = useMemo(() => {
        return automationData?.follow_up_by_coach?.summary || {};
    }, [automationData]);

    const rawSections = useMemo(() => {
        return automationData?.apprentice_dashboard?.raw_sections || {};
    }, [automationData]);

    const overallSection = useMemo(() => {
        return rawSections?.overall_wellbeing || {};
    }, [rawSections]);

    const workplaceSection = useMemo(() => {
        return rawSections?.workplace_experience || {};
    }, [rawSections]);

    const supportSection = useMemo(() => {
        return rawSections?.support_from_kbc || {};
    }, [rawSections]);

    const snapshotCards = useMemo(() => {
        return [
            {
                key: "mental",
                label: result?.score_labels?.mental ?? "Mental",
                value: latestScores.mental,
                trend: trendAnalysis.mental,
            },
            {
                key: "protective",
                label: result?.score_labels?.protective ?? "Protective",
                value: latestScores.protective,
                trend: trendAnalysis.protective,
            },
            {
                key: "provider",
                label: result?.score_labels?.provider ?? "Provider",
                value: latestScores.provider,
                trend: trendAnalysis.provider,
            },
            {
                key: "safeguarding",
                label: result?.score_labels?.safeguarding ?? "Safeguarding",
                value: latestScores.safeguarding,
                trend: trendAnalysis.safeguarding,
            },
            {
                key: "overall",
                label: result?.score_labels?.overall ?? "Overall",
                value: latestScores.overall,
                trend: trendAnalysis.overall,
            },
        ];
    }, [result, latestScores, trendAnalysis]);

    const chartHeight = 220;
    const chartBottomPadding = 28;
    const chartTopPadding = 12;
    const usableHeight = chartHeight - chartBottomPadding - chartTopPadding;

    const getY = (value: number) => {
        const clamped = Math.max(0, Math.min(10, value));
        return chartTopPadding + ((10 - clamped) / 10) * usableHeight;
    };

    const getX = (index: number, total: number) => {
        if (total <= 1) return 300;
        const start = 40;
        const end = 560;
        return start + (index * (end - start)) / (total - 1);
    };

    const buildPath = (values: number[], total: number) => {
        return values
            .map((value, index) => {
                const x = getX(index, total);
                const y = getY(value);
                return `${index === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
    };

    const totalPoints = trendData.length;

    const mentalPath = buildPath(
        trendData.map((item) => item.mental),
        totalPoints
    );
    const protectivePath = buildPath(
        trendData.map((item) => item.protective),
        totalPoints
    );
    const providerPath = buildPath(
        trendData.map((item) => item.provider),
        totalPoints
    );
    const safeguardingPath = buildPath(
        trendData.map((item) => item.safeguarding),
        totalPoints
    );

    const riskToneClass =
        result?.risk_level === "High"
            ? "tone-danger"
            : result?.risk_level === "Medium"
                ? "tone-warning"
                : "tone-success";

    if (error) {
        return (
            <div className="dashboard-page">
                <div className="dashboard-shell">
                    <div className="dashboard-panel">
                        <p className="error">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

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

    useEffect(() => {
        if (!result?.learner) return;

        setTicketForm((prev) => ({
            ...prev,
            full_name: result.learner.name || "",
            email: result.learner.email || "",
        }));
    }, [result]);

    const openTicketForm = (type: "wellbeing" | "safeguarding") => {
        setTicketType(type);
        setTicketError("");
        setTicketSuccess("");
        setTicketForm((prev) => ({
            ...prev,
            subject:
                type === "wellbeing"
                    ? "Wellbeing support request"
                    : "Safeguarding concern",
            urgency: type === "safeguarding" ? "high" : "medium",
        }));
    };

    const closeTicketForm = () => {
        setTicketType(null);
        setTicketError("");
        setTicketSuccess("");
    };

    const updateTicketField = (
        field: keyof typeof ticketForm,
        value: string
    ) => {
        setTicketForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleTicketSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!ticketType) return;

        setTicketSubmitting(true);
        setTicketError("");
        setTicketSuccess("");

        try {
            const payload = {
                ticket_type: ticketType,
                full_name: ticketForm.full_name,
                email: ticketForm.email,
                subject: ticketForm.subject,
                details: ticketForm.details,
                urgency: ticketForm.urgency,
                preferred_contact: ticketForm.preferred_contact,
            };

            const response = await apiFetch<CreateTicketResponse>("/tickets/create/", {
                method: "POST",
                body: JSON.stringify(payload),
            });

            setTicketSuccess(response.message || "Ticket submitted successfully.");
            setTicketForm((prev) => ({
                ...prev,
                subject:
                    ticketType === "wellbeing"
                        ? "Wellbeing support request"
                        : "Safeguarding concern",
                details: "",
                urgency: ticketType === "safeguarding" ? "high" : "medium",
                preferred_contact: "email",
            }));
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Failed to submit ticket";
            setTicketError(message);
        } finally {
            setTicketSubmitting(false);
        }
    };

    if (!result) {
        return (
            <div className="dashboard-page">
                <div className="dashboard-shell">
                    <div className="dashboard-panel">
                        <p>Loading result...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-page">
            <div className="dashboard-shell">
                <div className="dashboard-header">
                    <div>
                        <h1>Wellbeing & Safeguarding Dashboard</h1>

                        <p className="dashboard-welcome">
                            <span className="welcome-label">Welcome back,</span>
                            <span className="welcome-name">
                                {result?.learner?.name ? ` ${result.learner.name}` : ""}
                            </span>
                        </p>

                        <p className="dashboard-subtitle">
                            A clearer summary of your latest wellbeing results and next steps.
                        </p>
                    </div>

                    <button
                        className="ghost-btn header-btn"
                        onClick={() => navigate("/instructions")}
                    >
                        Retake Survey
                    </button>
                </div>

                <div className="dashboard-grid hero-grid">
                    <div className="dashboard-panel hero-panel">
                        <div className="hero-top-row">
                            <div>
                                <p className="eyebrow">Current status</p>
                                <h2>{result.risk_level} risk</h2>
                            </div>

                            <div className={`risk-pill ${riskToneClass}`}>
                                <span>{result.risk_level}</span>
                            </div>
                        </div>

                        <p className="hero-summary">
                            {aiSummary ||
                                summaryItems[0] ||
                                "Your latest wellbeing survey has been recorded successfully."}
                        </p>

                        <div className="hero-meta">
                            <div className="hero-meta-card">
                                <span>Highest risk area</span>
                                <strong>
                                    {highestRiskArea?.label || "Not available"}
                                </strong>
                            </div>

                            <div className="hero-meta-card">
                                <span>Overall score</span>
                                <strong>{formatScore(latestScores.overall)}</strong>
                            </div>

                            <div className="hero-meta-card">
                                <span>Trigger count</span>
                                <strong>{result.trigger_count ?? 0}</strong>
                            </div>
                        </div>
                    </div>

                    <div className="dashboard-panel summary-panel">
                        <h3>Key Takeaways</h3>

                        <div className="summary-box tone-success">
                            <strong>Overview</strong>
                            <p>{summaryItems[0] || "Your latest result has been recorded."}</p>
                        </div>

                        <div className={`summary-box ${riskToneClass}`}>
                            <strong>Trend</strong>
                            <p>{summaryItems[1] || "No recent trend data available."}</p>
                        </div>

                        <div className="summary-box tone-neutral">
                            <strong>Next step</strong>
                            <p>
                                {summaryItems[2] ||
                                    "Review the recommendations below and raise a concern if needed."}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="dashboard-panel">
                    <div className="section-head">
                        <div>
                            <h3>Your Wellbeing Snapshot</h3>
                            <p className="section-subtitle">
                                A quick view of the latest scores across key areas.
                            </p>
                        </div>
                    </div>

                    <div className="score-grid">
                        {snapshotCards.map((card) => (
                            <div
                                className={`score-card ${card.key !== "overall"
                                    ? `score-card-${card.key}`
                                    : "highlight-card"
                                    }`}
                                key={card.label}
                            >
                                <span>{card.label}</span>
                                <strong>{formatScore(card.value)}</strong>
                                <small className={`trend-badge trend-${card.trend}`}>
                                    {card.trend}
                                </small>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="dashboard-grid middle-grid">
                    <div className="dashboard-panel priority-panel">
                        <div className="section-head">
                            <div>
                                <h3>Priority Areas</h3>
                                <p className="section-subtitle">
                                    The most relevant items that may need attention right now.
                                </p>
                            </div>
                        </div>

                        {(followUpCard?.cardTitle || followUpCard?.cardSubtitle) && (
                            <div className={`summary-box ${riskToneClass}`}>
                                <strong>{followUpCard?.cardTitle || "Follow-up needed"}</strong>
                                <p>
                                    {followUpCard?.cardSubtitle ||
                                        followUpCard?.followUpReason ||
                                        ""}
                                </p>
                            </div>
                        )}

                        {whatMattersNow.length > 0 && (
                            <div>
                                <h4 className="mini-section-title">What matters now</h4>
                                <div className="compact-list">
                                    {whatMattersNow.slice(0, 4).map((item, index) => (
                                        <div className="compact-item" key={index}>
                                            {typeof item === "string"
                                                ? item
                                                : item?.title || item?.text || "Priority item"}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* {flaggedDomains.length > 0 && (
                            <div>
                                <h4 className="mini-section-title">Flagged domains</h4>
                                <div className="domain-chip-list">
                                    {flaggedDomains.map((domain: any, index: number) => (
                                        <span
                                            className="domain-chip"
                                            key={`${domain?.domain}-${index}`}
                                        >
                                            {(domain?.domain || "Domain") +
                                                " , " +
                                                formatScore(domain?.score)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )} */}

                        {safeguardingTriggers.length > 0 && (
                            <div>
                                <h4 className="mini-section-title">Safeguarding triggers</h4>
                                <div className="alert-list">
                                    {safeguardingTriggers.map((trigger: string, index: number) => (
                                        <div
                                            className="alert-item"
                                            key={`${trigger}-${index}`}
                                        >
                                            {toTitle(trigger)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!whatMattersNow.length &&
                            !flaggedDomains.length &&
                            !safeguardingTriggers.length &&
                            !(followUpCard?.cardTitle || followUpCard?.cardSubtitle) && (
                                <p>No priority items are available right now.</p>
                            )}
                    </div>

                    <div className="dashboard-side-stack">
                        <div className="dashboard-panel support-panel">
                            <h3>Support Contacts</h3>
                            <div className="recommendation-list">
                                <div className="recommendation-item">
                                    <div>
                                        <strong>Safeguarding Lead (Yousef Abdelwahid)</strong>
                                        <p>yousef.Abdelwahid@kentbusinesscollege.com</p>
                                    </div>
                                </div>

                                <div className="recommendation-item">
                                    <div>
                                        <strong>Wellbeing Support(Tina Wright)</strong>
                                        <p>tina.wright@kentbusinesscollege.com</p>
                                    </div>
                                </div>

                                {/* <div className="recommendation-item">
                                    <div>
                                        <strong>Emergency</strong>
                                        <p>999 or Samaritans 116 123</p>
                                    </div>
                                </div> */}

                                {/* <button className="ghost-btn">Contact Support</button> */}
                            </div>
                        </div>

                        <div className="dashboard-panel support-panel">
                            <h3>Raise a Concern</h3>
                            <p>
                                If something is worrying you, you can raise it here confidentially.
                            </p>
                            <button
                                className="wellbeing-btn"
                                onClick={() => openTicketForm("wellbeing")}
                            >
                                Wellbeing Ticket
                            </button>

                            <button
                                className="safeguarding-btn"
                                onClick={() => openTicketForm("safeguarding")}
                            >
                                Safeguarding Ticket
                            </button>
                        </div>
                    </div>
                </div>

                <div className="dashboard-grid middle-grid">
                    <div className="dashboard-panel">
                        <div className="section-head">
                            <div>
                                <h3>Personalised Recommendations</h3>
                                <p className="section-subtitle">
                                    Suggestions based on your latest survey response.
                                </p>
                            </div>
                        </div>

                        <div className="recommendation-list">
                            {recommendations.length > 0 ? (
                                recommendations.map((item, index) => (
                                    <div
                                        className="recommendation-item"
                                        key={`${item.title}-${index}`}
                                    >
                                        <div>
                                            <strong>{item.title}</strong>
                                            <p>{item.text}</p>
                                            {(item.category || item.suggestedTimeline) && (
                                                <p>
                                                    {[item.category, item.suggestedTimeline]
                                                        .filter(Boolean)
                                                        .join(" • ")}
                                                </p>
                                            )}
                                        </div>
                                        <span className="recommendation-tag">{item.tag}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="recommendation-item">
                                    <div>
                                        <strong>No personalised recommendations available yet</strong>
                                        <p>The automation dashboard data has not been returned.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="dashboard-panel resources-panel">
                        <div className="section-head">
                            <div>
                                <h3>Resources & Self-help</h3>
                                <p className="section-subtitle">
                                    Helpful material and support resources you can review.
                                </p>
                            </div>
                        </div>

                        <div className="resource-grid">
                            {resources.length > 0 ? (
                                resources.map((item, index) => (
                                    <div className="resource-card" key={index}>
                                        {typeof item === "string"
                                            ? item
                                            : item?.title || "Resource"}
                                    </div>
                                ))
                            ) : (
                                <>
                                    <div className="resource-card">Breathing</div>
                                    <div className="resource-card">Sleep tips</div>
                                    <div className="resource-card">Stress help</div>
                                    <div className="resource-card">Financial aid</div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {(overallSection?.ai_insights?.length ||
                    overallSection?.recommended_actions?.length ||
                    workplaceSection?.ai_insights?.length ||
                    workplaceSection?.recommended_actions?.length ||
                    supportSection?.ai_insights?.length ||
                    supportSection?.recommended_actions?.length) && (
                        <div className="dashboard-grid insight-grid">
                            {[
                                {
                                    title: "Your Overall Wellbeing",
                                    section: overallSection,
                                },
                                {
                                    title: "Your Workplace Experience",
                                    section: workplaceSection,
                                },
                                {
                                    title: "Your Support from KBC",
                                    section: supportSection,
                                },
                            ].map((block) => {
                                const aiInsights = Array.isArray(block.section?.ai_insights)
                                    ? block.section.ai_insights
                                    : [];
                                const recommendedActions = Array.isArray(
                                    block.section?.recommended_actions
                                )
                                    ? block.section.recommended_actions
                                    : [];

                                if (!aiInsights.length && !recommendedActions.length) return null;

                                return (
                                    <div className="dashboard-panel" key={block.title}>
                                        <h3>{block.title}</h3>

                                        {aiInsights.length > 0 && (
                                            <div className="summary-box tone-success">
                                                <strong>AI Insights</strong>
                                                <div className="recommendation-list compact-recommendation-list">
                                                    {aiInsights.map((item: string, index: number) => (
                                                        <div className="recommendation-item" key={index}>
                                                            <div>
                                                                <p>{item}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {recommendedActions.length > 0 && (
                                            <div className="summary-box tone-neutral">
                                                <strong>Recommended Actions</strong>
                                                <div className="recommendation-list compact-recommendation-list">
                                                    {recommendedActions.map((item: string, index: number) => (
                                                        <div className="recommendation-item" key={index}>
                                                            <div>
                                                                <p>{item}</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                <div className="dashboard-panel chart-panel bottom-chart-panel equal-panel">
                    <div className="section-head compact-section-head">
                        <div>
                            <h3>Your Trends</h3>
                            <p className="section-subtitle">
                                Compare recent score movement across key wellbeing areas.
                            </p>
                        </div>
                    </div>

                    <div className="line-chart-wrap compact-chart-wrap">
                        <svg
                            viewBox="0 0 600 260"
                            className="line-chart-svg"
                            preserveAspectRatio="xMidYMid meet"
                        >
                            <line x1="40" y1="40" x2="560" y2="40" className="grid-line" />
                            <line x1="40" y1="95" x2="560" y2="95" className="grid-line" />
                            <line x1="40" y1="150" x2="560" y2="150" className="grid-line" />
                            <line x1="40" y1="205" x2="560" y2="205" className="grid-line" />

                            <path d={mentalPath} className="chart-path chart-path-mental" />
                            <path
                                d={protectivePath}
                                className="chart-path chart-path-protective"
                            />
                            <path d={providerPath} className="chart-path chart-path-provider" />
                            <path
                                d={safeguardingPath}
                                className="chart-path chart-path-safeguarding"
                            />

                            {trendData.map((item, index) => {
                                const x = getX(index, totalPoints);

                                return (
                                    <g key={`${item.label}-${index}`}>
                                        <circle
                                            cx={x}
                                            cy={getY(item.mental)}
                                            r="4.5"
                                            className="chart-point chart-point-mental"
                                        >
                                            <title>
                                                {`${result.score_labels?.mental ?? "Mental Health"}: ${item.mental}`}
                                            </title>
                                        </circle>

                                        <circle
                                            cx={x}
                                            cy={getY(item.protective)}
                                            r="4.5"
                                            className="chart-point chart-point-protective"
                                        >
                                            <title>
                                                {`${result.score_labels?.protective ?? "Protective Factors"}: ${item.protective}`}
                                            </title>
                                        </circle>

                                        <circle
                                            cx={x}
                                            cy={getY(item.provider)}
                                            r="4.5"
                                            className="chart-point chart-point-provider"
                                        >
                                            <title>
                                                {`${result.score_labels?.provider ?? "Provider Support"}: ${item.provider}`}
                                            </title>
                                        </circle>

                                        <circle
                                            cx={x}
                                            cy={getY(item.safeguarding)}
                                            r="4.5"
                                            className="chart-point chart-point-safeguarding"
                                        >
                                            <title>
                                                {`${result.score_labels?.safeguarding ?? "Safeguarding Risk"}: ${item.safeguarding}`}
                                            </title>
                                        </circle>

                                        <text
                                            x={x}
                                            y="232"
                                            textAnchor="middle"
                                            className="chart-axis-label"
                                        >
                                            {item.label}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>

                    {trendData.length === 1 && (
                        <p className="chart-note">
                            Complete more survey submissions to see a fuller trend over time.
                        </p>
                    )}

                    <div className="chart-legend">
                        <span>
                            <i className="legend-dot legend-dot-mental" />{" "}
                            {result.score_labels?.mental ?? "Mental Health"}
                        </span>
                        <span>
                            <i className="legend-dot legend-dot-protective" />{" "}
                            {result.score_labels?.protective ?? "Protective Factors"}
                        </span>
                        <span>
                            <i className="legend-dot legend-dot-provider" />{" "}
                            {result.score_labels?.provider ?? "Provider Support"}
                        </span>
                        <span>
                            <i className="legend-dot legend-dot-safeguarding" />{" "}
                            {result.score_labels?.safeguarding ?? "Safeguarding Risk"}
                        </span>
                    </div>
                </div>

                <div className="dashboard-panel bottom-table-panel equal-panel">
                    <div className="section-head compact-section-head">
                        <div>
                            <h3>Submitted Answers Snapshot</h3>
                            <p className="section-subtitle">
                                Review your submitted answers only when needed.
                            </p>
                        </div>

                        <button
                            className="ghost-btn small-btn"
                            onClick={() => setShowAnswers((prev) => !prev)}
                        >
                            {showAnswers ? "Hide" : "Show"}
                        </button>
                    </div>

                    {showAnswers ? (
                        <div className="answers-table-wrap compact-table-wrap">
                            <table className="answers-table">
                                <thead>
                                    <tr>
                                        <th>Question</th>
                                        <th>Category</th>
                                        <th>Construct</th>
                                        <th>Your Answer</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.questions.map((item) => (
                                        <tr key={item.question_id ?? item.question}>
                                            <td>{item.question}</td>
                                            <td>{item.category_name}</td>
                                            <td>{item.construct_type}</td>
                                            <td>{String(item.your_answer ?? "-")}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="collapsed-state">
                            <p>
                                Answers are hidden by default to keep the page focused and easy
                                to scan.
                            </p>
                        </div>
                    )}
                </div>
            </div>
            {ticketType && (
                <div className="ticket-modal-overlay" onClick={closeTicketForm}>
                    <div
                        className="ticket-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="ticket-modal-header">
                            <h3>
                                {ticketType === "wellbeing"
                                    ? "Create Wellbeing Ticket"
                                    : "Create Safeguarding Ticket"}
                            </h3>
                            <button className="ticket-close-btn" onClick={closeTicketForm}>
                                ×
                            </button>
                        </div>

                        <form className="ticket-form" onSubmit={handleTicketSubmit}>
                            <div className="ticket-form-grid">
                                <div>
                                    <label>Full name</label>
                                    <input
                                        type="text"
                                        value={ticketForm.full_name}
                                        onChange={(e) => updateTicketField("full_name", e.target.value)}
                                        required
                                    />
                                </div>

                                <div>
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={ticketForm.email}
                                        onChange={(e) => updateTicketField("email", e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label>Subject</label>
                                <input
                                    type="text"
                                    value={ticketForm.subject}
                                    onChange={(e) => updateTicketField("subject", e.target.value)}
                                    required
                                />
                            </div>

                            <div>
                                <label>Details</label>
                                <textarea
                                    rows={5}
                                    value={ticketForm.details}
                                    onChange={(e) => updateTicketField("details", e.target.value)}
                                    placeholder={
                                        ticketType === "wellbeing"
                                            ? "Describe the wellbeing support you need"
                                            : "Describe the safeguarding concern"
                                    }
                                    required
                                />
                            </div>

                            <div className="ticket-form-grid">
                                <div>
                                    <label>Urgency</label>
                                    <select
                                        value={ticketForm.urgency}
                                        onChange={(e) => updateTicketField("urgency", e.target.value)}
                                    >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                        <option value="critical">Critical</option>
                                    </select>
                                </div>

                                <div>
                                    <label>Preferred contact</label>
                                    <select
                                        value={ticketForm.preferred_contact}
                                        onChange={(e) =>
                                            updateTicketField("preferred_contact", e.target.value)
                                        }
                                    >
                                        <option value="email">Email</option>
                                        <option value="phone">Phone</option>
                                        <option value="teams">Teams</option>
                                    </select>
                                </div>
                            </div>

                            {ticketError && <p className="error">{ticketError}</p>}
                            {ticketSuccess && <p className="ticket-success">{ticketSuccess}</p>}

                            <div className="ticket-actions">
                                <button
                                    type="button"
                                    className="secondary-btn"
                                    onClick={closeTicketForm}
                                >
                                    Cancel
                                </button>

                                <button type="submit" className="primary-btn" disabled={ticketSubmitting}>
                                    {ticketSubmitting ? "Submitting..." : "Submit Ticket"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}