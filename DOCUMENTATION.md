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
    K -->|HIGH| L[🎫 Safeguarding Ticket\nurgency = high risk level\nsource = System\ncreated_by = Automatic\nstatus = New]
    K -->|MEDIUM / PATTERN| M[🎫 Wellbeing Ticket\nurgency = risk level\nsource = System\ncreated_by = Automatic\nstatus = New]
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
        text source
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
| `created_by` | `source` | Description |
|---|---|---|
| `Automatic` | `System` | Created by scoring engine when triggers detected |
| `learner` | _(null)_ | Created manually by learner via Results page |

### Score Group Weights
| Group | Weight | Trigger Logic |
|---|---|---|
| Mental Health | 40% | Average of normalized scores |
| Protective Factors | 20% | Average of normalized scores |
| Provider Support | 20% | Average of normalized scores |
| Safeguarding | 20% | Binary: any score ≤ 8 → 1.0, all > 8 → 10.0 |
