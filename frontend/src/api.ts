const API_BASE = "http://127.0.0.1:8000/api";

export type Learner = {
  id: number;
  full_name: string;
  email: string;
  programme?: string;
};

export type LoginResponse = {
  token: string;
  learner: Learner;
  has_completed_quiz: boolean;
  attempt_id: number;
  next_route: string;
};

export type InstructionsResponse = {
  learner: Learner;
  quiz: {
    id: number;
    title: string;
    instructions: string;
    questions_count?: number;
  };
};

export type Question = {
  id: number;
  category_no: number;
  category_name: string;
  construct_type: string;
  score_group?: string;
  question_code?: string;
  text: string;
  question_type: "single";
  options: string[];
  order: number;
  is_required: boolean;
  scale_prompt: string;
  min_score: number;
  max_score: number;
  is_trigger: boolean;
  trigger_rule: string | null;
  trigger_key?: string | null;
  trigger_priority?: string | null;
  is_reverse_scored: boolean;
  is_core?: boolean;
  rotation_cycle?: number | null;
};

export type QuestionsResponse = {
  quiz_id: number;
  questions: Question[];
};

export type SubmitAnswerItem = {
  question_id: number;
  answer: string;
};

export type SubmitQuizResponse = {
  message: string;
  attempt_id: number;
  scores: {
    mental: number;
    protective: number;
    provider: number;
    safeguarding: number;
    overall: number;
  };
  risk_level: string;
  triggers: {
    high: string[];
    medium: string[];
    pattern: string[];
  };
  actions: string[];
  webhook_sent?: boolean;
  webhook_error?: string | null;
};

export type ResultQuestion = {
  question_id?: number;
  question: string;
  your_answer: number | string | null;
  category_no?: number;
  category_name?: string;
  construct_type?: string;
  is_reverse_scored?: boolean;
  is_trigger?: boolean;
};

export type ResultTrend = {
  label: string;
  mental: number;
  protective: number;
  provider: number;
  safeguarding: number;
  overall: number;
  risk_level?: string;
};

export type ResultResponse = {
  attempt_id: number;
  learner: {
    name: string;
    email: string;
    programme: string;
  };
  quiz: string;
  submitted_at: string | null;
  score?: number;
  total_score?: number;
  trigger_count: number;
  risk_level: string;
  scores: {
    mental: number;
    protective: number;
    provider: number;
    safeguarding: number;
    overall: number;
  };
  score_labels?: {
    mental?: string;
    protective?: string;
    provider?: string;
    safeguarding?: string;
    overall?: string;
  };
  triggers: {
    high: string[];
    medium: string[];
    pattern: string[];
  };
  actions: string[];
  trends: ResultTrend[];
  total_questions: number;
  questions: ResultQuestion[];
};

export type AutomationDashboardResponse = {
  attempt_id: number;
  apprentice_dashboard: Record<string, any>;
  follow_up_by_coach: Record<string, any>;
  suggested_coach_actions: Record<string, any>;
  created_at?: string | null;
  updated_at?: string | null;
  message?: string;
};

export type MessageResponse = {
  message: string;
};

export function setToken(token: string): void {
  localStorage.setItem("quiz_token", token);
}

export function getToken(): string | null {
  return localStorage.getItem("quiz_token");
}

export function clearToken(): void {
  localStorage.removeItem("quiz_token");
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const message: string = data.detail || data.message || "Something went wrong";
    if (response.status === 401 || response.status === 403) {
      clearToken();
      window.location.href = "/";
    }
    throw new Error(message);
  }

  return data as T;
}

// tickets
export type CreateTicketPayload = {
  ticket_type: "wellbeing" | "safeguarding";
  full_name: string;
  email: string;
  subject: string;
  details: string;
  urgency: "low" | "medium" | "high" | "critical";
  preferred_contact: "email" | "phone" | "teams";
};

export type CreateTicketResponse = {
  message: string;
  ticket_id?: number | string;
};