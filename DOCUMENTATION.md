# Wellbeing & Safeguarding Monitoring System
### Technical Documentation

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Quiz Flow](#3-quiz-flow)
4. [Scoring & Risk Engine](#4-scoring--risk-engine)
5. [Trigger & Ticket Flow](#5-trigger--ticket-flow)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Integrations](#8-integrations)
9. [Frontend UI Components](#9-frontend-ui-components)
10. [Changelog](#10-changelog)

---

## 1. Project Overview

The **Wellbeing & Safeguarding Monitoring System** is a digital check-in platform for apprentices at Kent Business College. Learners complete a wellbeing questionnaire, the system scores their responses, detects risk indicators, and automatically escalates concerns to the safeguarding and wellbeing teams through a structured ticketing workflow.

### Key Capabilities
| Capability | Description |
|---|---|
| Wellbeing Assessment | Scored questionnaire across 4 domains |
| Risk Classification | Automated Low / Medium / High scoring |
| Trigger Detection | Identifies safeguarding and wellbeing red flags |
| Auto-Ticketing | Creates support tickets automatically when risk is detected |
| AI Insights | Personalised dashboard generated via n8n + AI |
| Employer Notification | Optional nudge to employer (no scores shared) |

---

## 2. System Architecture

```mermaid
flowchart TD
    subgraph Frontend["🖥️ Frontend (React + Vite)"]
        A[Login Page] --> B[Instructions Page]
        B --> C[Quiz Page]
        C --> D[Results Page]
    end

    subgraph Backend["⚙️ Backend (Django REST)"]
        E[Auth API] --> F[Quiz API]
        F --> G[Scoring Engine]
        G --> H[Trigger Engine]
        H --> I[Ticket Engine]
    end

    subgraph Databases["🗄️ Databases (NeonDB / PostgreSQL)"]
        J[(wsms DB\nwellbeing_safeguarding\n_monitoring_system)]
        K[(default DB\nsupport_tickets)]
        L[(automation DB\nsafeguarding_wellbeing\n_automation)]
    end

    subgraph External["🔗 External Services"]
        M[n8n Automation\nWorkflow]
        N[AI Engine\nInsights Generator]
        O[Email Service]
    end

    Frontend -->|REST API| Backend
    Backend -->|read/write| J
    Backend -->|read/write| K
    Backend -->|read| L
    Backend -->|webhook POST| M
    M --> N
    N -->|write insights| L
    H -->|auto-create| K
    Backend -->|send_mail| O
```

---

## 3. Quiz Flow

```mermaid
flowchart TD
    A([🔐 Learner Login\nEmail lookup]) --> B{Has existing\nrecord?}
    B -->|No| C[Create MonitoringRecord]
    B -->|Yes| D[Load existing record]
    C --> E[Return Bearer Token]
    D --> E

    E --> F[View Instructions]
    F --> G[Load Questions\nCore + Rotation cycle]
    G --> H[Learner answers\nall questions]

    H --> I[POST /quiz/submit/]

    subgraph Scoring ["📊 Scoring Engine"]
        I --> J[Normalize answers\nreverse scoring]
        J --> K[Group averages\nmental · protective\nprovider · safeguarding]
        K --> L[Weighted overall score\nmental 40% · protective 20%\nprovider 20% · safeguarding 20%]
        L --> M[Classify Risk\n≥8 Low · ≥5 Medium · below 5 High]
    end

    M --> N[Detect Triggers]
    N --> O[Save to DB\n+ history_json]
    O --> P[Send Webhook\nto n8n]
    O --> Q{trigger_count > 0?}
    Q -->|Yes| R[Auto-create\nSupport Ticket]
    Q -->|No| S[Return results]
    R --> S

    S --> T[Results Page\npoll automation dashboard]
    T --> U{AI data ready?}
    U -->|Polling every 5s\nmax 60s| U
    U -->|Ready| V[Display full\nAI dashboard]
```

---

## 4. Scoring & Risk Engine

```mermaid
flowchart LR
    subgraph Scoring Groups
        A[Mental Health\nweight 40%]
        B[Protective Factors\nweight 20%]
        C[Provider Support\nweight 20%]
        D[Safeguarding\nweight 20%]
    end

    subgraph Safeguarding Logic
        D --> E{Any answer\n≤ 8?}
        E -->|Yes| F[Score = 1.0\nHigh Risk]
        E -->|No| G[Score = 10.0\nLow Risk]
    end

    subgraph Risk Classification
        H[Overall Score]
        H -->|≥ 8.0| I[🟢 Low]
        H -->|5.0 – 7.99| J[🟡 Medium]
        H -->|below 5.0| K[🔴 High]
    end

    A & B & C & D --> H
```

---

## 5. Trigger & Ticket Flow

```mermaid
flowchart TD
    A[Submit Quiz] --> B[detect_triggers]

    subgraph Trigger Detection
        B --> C{Safeguarding\nquestion score ≤ 8?}
        C -->|Yes| D[🔴 HIGH trigger\nquestion text + score]

        B --> E{Anxiety / Mood / Sleep\nLoneliness / Leaving\nscore ≤ 3 or 4?}
        E -->|Yes| F[🟡 MEDIUM trigger\ncoded flag]

        B --> G{3+ categories\nbelow 5?\nProtective < 5?}
        G -->|Yes| H[🟠 PATTERN trigger\nstructural flag]
    end

    D & F & H --> I[triggered_questions JSON\nsaved to DB]
    I --> J[trigger_count saved\nto DB]

    J --> K{Any triggers?}
    K -->|HIGH| L[🎫 Safeguarding Ticket\nurgency = high risk level\ncreated_by = System\nstatus = New]
    K -->|MEDIUM / PATTERN| M[🎫 Wellbeing Ticket\nurgency = risk level\ncreated_by = System\nstatus = New]
    K -->|None| N[No ticket created]

    L & M --> O[Ticket visible\nin Ticket System]

    J --> P[Webhook → n8n\ntrigger_count +\ntriggered_questions\nincluded in payload]
```

---

## 6. Database Schema

```mermaid
erDiagram
    wellbeing_safeguarding_monitoring_system {
        bigint id PK
        text learner_name
        text learner_email
        text learner_phone
        text programme
        text coach_name
        text coach_email
        text manager_name
        text manager_email
        text organization_name
        float total_score
        float personal_wellbeing_score
        float emotional_stress_score
        float provider_culture_score
        float safeguarding_vulnerability_score
        int trigger_count
        jsonb triggered_questions
        text risk_level
        jsonb submission_json
        jsonb history_json
        timestamptz submitted_at
        boolean completed
        timestamptz employer_notified_at
    }

    support_tickets {
        bigint id PK
        bigint wellbeing_record_id FK
        text ticket_type
        text created_by
        text full_name
        text email
        text subject
        text details
        text urgency
        text preferred_contact
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    safeguarding_questions {
        bigint id PK
        int category_no
        text category_name
        text question_text
        text question_code
        text score_group
        bool is_trigger
        text trigger_rule
        text trigger_priority
        text trigger_note
        bool is_reverse_scored
        bool is_core
        int rotation_cycle
    }

    safeguarding_wellbeing_automation {
        bigint id PK
        bigint wellbeing_record_id FK
        text apprentice_dashboard
        text follow_up_by_coach
        text suggested_coach_actions
        timestamptz created_at
        timestamptz updated_at
    }

    wellbeing_safeguarding_monitoring_system ||--o{ support_tickets : "wellbeing_record_id"
    wellbeing_safeguarding_monitoring_system ||--o| safeguarding_wellbeing_automation : "wellbeing_record_id"
```

---

## 7. API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login/` | Login with email, returns Bearer token |

### Quiz
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/quiz/instructions/` | Quiz instructions and learner info |
| POST | `/api/quiz/start/` | Start a quiz attempt |
| GET | `/api/quiz/questions/` | Get active questions (core + rotation) |
| POST | `/api/quiz/submit/` | Submit answers → score → detect triggers → auto-ticket |

### Results
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/quiz/results/:id/` | Get scores, risk level, triggers |
| GET | `/api/quiz/results/:id/automation-dashboard/` | Get AI-generated insights (poll until ready) |
| POST | `/api/quiz/results/:id/send-to-employer/` | Email results to manager/coach |
| POST | `/api/quiz/results/:id/notify-employer/` | Send employer a check-up nudge |

### Tickets
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/tickets/create/` | Learner manually submits a support ticket |

---

## 8. Integrations

### n8n Automation Webhook
Triggered on every quiz submission. Payload includes:

```json
{
  "attempt_id": 123,
  "wellbeing_record_id": 123,
  "learner": {
    "name": "John Smith",
    "email": "j.smith@email.com",
    "phone": "07700900123",
    "programme": "Business Admin L3",
    "organization_name": "Acme Ltd",
    "coach_name": "Lisa Carter",
    "coach_email": "l.carter@kbc.ac.uk",
    "manager_name": "Sarah Jones",
    "manager_email": "s.jones@acme.com"
  },
  "submitted_at": "2026-05-07T13:31:55Z",
  "risk_level": "High",
  "trigger_count": 3,
  "triggered_questions": {
    "high": [
      { "question_text": "I feel safe at home", "normalized_score": 5, "trigger_note": "..." }
    ],
    "medium": ["anxiety_high", "low_mood"],
    "pattern": ["three_categories_below_5"]
  },
  "result": { "scores": {}, "answers": [] }
}
```

### Ticket Sources
| `created_by` | Description |
|---|---|
| `System` | Auto-created by scoring engine when triggers are detected on quiz submission |
| `learner` | Manually submitted by the learner via the Results page support form |

### Score Group Weights
| Group | Weight | Trigger Logic |
|---|---|---|
| Mental Health | 40% | Average of normalized scores |
| Protective Factors | 20% | Average of normalized scores |
| Provider Support | 20% | Average of normalized scores |
| Safeguarding | 20% | Binary: any score ≤ 8 → 1.0, all > 8 → 10.0 |

---

## 9. Frontend UI Components

### Results Page — Wellbeing Summary Status Cards

The AI Wellbeing Summary section displays status cards for each assessed domain. Each card uses a colour-coded style based on the label returned from the AI:

| Label | Icon | CSS Class | Colour |
|---|---|---|---|
| `Improving` | `↑` | `status-improving` | Green (`#eef8f1`) |
| `Watch` | `◎` | `status-watch` | Amber (`#fff6e8`) |
| `Next step` | `→` | `status-next` | Lavender (`#f9f5ff`) |
| `Observation` | `◉` | `status-observation` | Blue (`#e8f4fd`) |

Labels are mapped in `STATUS_LABEL_MAP` in `frontend/src/pages/ResultPage.tsx`. Any unrecognised label falls back to `status-next`.

---

### Results Page — Skeleton Loader

While the AI automation dashboard data is being fetched (polling every 5 seconds, up to 60 seconds), a shimmer skeleton animation is shown in place of each AI section card.

- **CSS classes**: `.skeleton-bone`, `.skeleton-card`
- **Animation**: `@keyframes skeleton-shimmer` — horizontal gradient sweep
- Skeleton is replaced by real content as soon as polling returns a non-empty dashboard response

---

### Results Page — Safeguarding Referral Form

A full Safeguarding Referral Form is available to staff via the **"Submit Safeguarding Referral"** button on the Results page. The form follows the KBC SR-001 structure and is presented as a modal.

#### Form Structure (7 Parts)

| Part | Title | Fields |
|---|---|---|
| 1 | Referrer Details | Name, job title, phone, email, date, relationship to learner |
| 2 | Learner Details | Full name, DOB, gender, phone, email, address, apprenticeship programme |
| 3 | Concern Details | Category (abuse / neglect / self-harm / domestic violence / radicalisation / other), description, date/time of concern, immediate risk toggle |
| 4 | Risk Indicators | 12 checkboxes — physical signs, behaviour change, self-harm, domestic violence, substance misuse, safeguarding history, mental health crisis, financial exploitation, online risk, radicalisation, missing episodes, not engaging with support |
| 5 | Actions Taken | Actions taken so far, who else was informed |
| 6 | Consent | Whether learner was informed, reason if not, parental awareness (if under 18) |
| 7 | Declaration | Signature field and confirmation of accuracy |

On submit, the form builds a structured plain-text `details` string and POSTs to `POST /api/tickets/create/` with `ticket_type = "safeguarding"` and `created_by = "learner"`.

---

### Onboarding Dashboard - Main Assessment Actions

The Onboarding Dashboard in `frontend/src/pages/OnboardingPage.tsx` shows the learner's pre-assessment journey before the main safeguarding assessment.

The **Who I Am** external action is always visible in the Main Assessment panel, regardless of onboarding progress:

- Before all six onboarding questionnaires are complete, the panel shows the remaining step count next to the **Who I Am** button.
- After all six questionnaires are complete, the panel shows the main assessment action (**Begin Assessment** or **Safeguarding Dashboard**) next to **Who I Am**.
- The **Who I Am** link passes the learner email as a query parameter: `https://who-i-am.kentbusinesscollege.net/?email={learner_email}`

Relevant CSS classes in `frontend/src/styles.css`:

| Class | Purpose |
|---|---|
| `.ob-main-remaining` | Displays the remaining onboarding step count as a compact pill |
| `.ob-who-i-am-btn` | Styles the Who I Am action as a secondary button |
| `.ob-sel-btn--purple + .ob-who-i-am-btn` | Aligns Who I Am beside the primary assessment button |
| `.ob-main-remaining + .ob-who-i-am-btn` | Aligns Who I Am beside the remaining-step pill |

On small screens, both the remaining-step pill and the action buttons become full-width stacked controls.

---

### Login Page — KBC Branding

- KBC logo (`/kbc-logo.png`) is displayed centred above the login form using `.login-logo-wrap` / `.login-logo`
- The same logo is used as the browser tab favicon via `<link rel="icon" href="/kbc-logo.png">` in `frontend/index.html`
- Logo file must be placed at `frontend/public/kbc-logo.png`

---

## 10. Changelog

### v2.9 - Onboarding Action Updates (2026-06)
- Updated the Onboarding Dashboard so **Who I Am** remains visible whether onboarding is incomplete or complete
- Restyled Main Assessment panel actions so **Who I Am** aligns consistently beside either the remaining-step pill or the primary assessment button
- Added responsive mobile handling for stacked onboarding action controls

### v2.8 — UI & Referral Form (2026-05)
- Added **Safeguarding Referral Form** (7-part modal, KBC SR-001 structure) to Results page
- Added **Observation** status card with blue colour scheme to Wellbeing Summary
- Added **skeleton loader** shimmer animation while AI dashboard polls
- Added **KBC logo** to Login page and as browser favicon
- Fixed polling logic: switched from timestamp comparison to content-based check (`Object.keys(dashboard).length > 0`) to prevent stale data on page refresh

### v2.5 — Auto-Ticketing & Triggered Questions (2026-04)
- Added `triggered_questions` JSONField to `wellbeing_safeguarding_monitoring_system` table
- Auto-ticket creation in `submit_quiz_view` when `trigger_count > 0`
- Ticket `details` includes structured breakdown: risk level, total score, trigger count, programme, coach, and per-question triggered scores
- Removed `source` column from `support_tickets`; origin is now identified by `created_by` (`System` vs `learner`)
- Risk level stored in `urgency` column of `support_tickets` (removed separate `risk_level` column)
- `triggered_questions` payload included in n8n automation webhook
- Removed email sending from manual ticket creation — DB storage only
