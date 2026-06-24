# Wellbeing & Safeguarding Frontend

React + TypeScript frontend for a learner wellbeing and safeguarding assessment journey.

This app guides learners through onboarding questionnaires, unlocks the main assessment when the required onboarding sections are complete, and displays assessment results and support actions after submission.

## What This Frontend Does

- Authenticates a learner through the backend API.
- Shows an onboarding journey with six pre-assessment sections.
- Tracks onboarding progress and section reports.
- Keeps the **Who I Am** action visible during both incomplete and complete onboarding states.
- Starts the main safeguarding assessment after onboarding completion.
- Submits assessment answers and shows a thank-you flow.
- Displays learner results, trend data, AI-generated dashboard content, and support/referral actions.
- Generates/downloads report content from the results page.

## Main User Flow

1. Learner logs in.
2. Learner completes onboarding questionnaires in order.
3. The onboarding dashboard shows progress and available section reports.
4. Once onboarding is complete, the main safeguarding assessment becomes available.
5. Learner completes the main assessment.
6. Results and support actions are shown on the results dashboard.

## Routes

| Route | Purpose |
|---|---|
| `/` | Learner login |
| `/onboarding` | Onboarding journey dashboard |
| `/instructions` | Main assessment instructions |
| `/quiz/:attemptId` | Main assessment questions |
| `/thanks/:attemptId` | Post-submission confirmation |
| `/results/:attemptId` | Results dashboard |

## Key Files

| File | Purpose |
|---|---|
| `src/App.tsx` | App routes |
| `src/api.ts` | Shared API client and response types |
| `src/pages/LoginPage.tsx` | Learner login |
| `src/pages/OnboardingPage.tsx` | Onboarding journey and main assessment unlock state |
| `src/pages/QuizPage.tsx` | Main assessment question flow |
| `src/pages/ResultPage.tsx` | Results dashboard and support actions |
| `src/components/LearnerReportModal.tsx` | Onboarding section report modal |
| `src/styles.css` | Shared application styling |

## Onboarding Logic

The onboarding dashboard loads:

- Available onboarding sections.
- Completed section IDs.
- Section report data.
- Main assessment status once onboarding is complete.

The main assessment panel has two states:

- **Incomplete onboarding**: shows the number of remaining onboarding steps and the **Who I Am** action.
- **Complete onboarding**: shows either **Begin Assessment** or **Safeguarding Dashboard**, plus the **Who I Am** action.

The **Who I Am** action is intentionally available in both states so learners can access it before or after completing onboarding.

## Tech Stack

- React
- TypeScript
- Vite
- React Router
- Lucide React icons
- jsPDF

## Security Notes

- Do not commit real secrets, API keys, database URLs, webhook URLs, private tokens, or production credentials.
- Keep environment-specific backend configuration outside public documentation.
- The frontend stores only short-lived client state such as the learner auth token and learner email in browser storage.
- Sensitive scoring, escalation, ticketing, and data persistence rules should remain enforced by the backend.
- Public documentation should describe behavior and architecture at a high level, not private infrastructure details.

## Documentation

For broader system notes, see the root `DOCUMENTATION.md`.
