import base64
import json
import logging
import os
import re
import textwrap
import uuid
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.mail import EmailMessage, send_mail
from django.db import connections
from django.db import models
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .auth import create_admin_token, create_login_token, get_admin_from_request, get_record_from_request
from .models import (
    AdminAccount,
    LearnerInclusivenessQuestion,
    LearnerInclusivenessQuizResponse,
    LearnerInclusivenessReport,
    MonitoringRecord,
    SafeguardingQuestion,
    SafeguardingWellbeingAutomation,
    SupportTicket,
)

logger = logging.getLogger(__name__)

AUTOMATION_WEBHOOK_URL = getattr(
    settings,
    "WELLBEING_AUTOMATION_WEBHOOK_URL",
    "https://n8n.srv943390.hstgr.cloud/webhook/wellbeing_safegarden",
)

CURRENT_ROTATION_CYCLE = 1
ADMIN_EMAIL_DOMAIN = getattr(settings, "ADMIN_EMAIL_DOMAIN", "kentbusinesscollege.com").lower()
ADMIN_PASSWORD_RESET_SALT = "admin-password-reset"
ADMIN_PASSWORD_RESET_MAX_AGE = 60 * 60
ADMIN_MICROSOFT_STATE_SALT = "admin-microsoft-login-state"

GROUP_WEIGHTS = {
    "mental": 0.40,
    "protective": 0.20,
    "provider": 0.20,
    "safeguarding": 0.20,
}


def normalize_text(value):
    return str(value).strip().lower()


def display_name_from_email(email: str) -> str:
    local_part = email.split("@", 1)[0]
    return " ".join(part.capitalize() for part in local_part.replace("_", ".").split(".") if part) or email


def get_or_create_admin_monitoring_record(admin: AdminAccount) -> MonitoringRecord:
    record = (
        MonitoringRecord.objects.using("wsms")
        .filter(learner_email__iexact=admin.email)
        .order_by("id")
        .first()
    )

    if record:
        return record

    return MonitoringRecord.objects.using("wsms").create(
        learner_name=admin.full_name or display_name_from_email(admin.email),
        learner_email=admin.email,
        coach_email=admin.email,
        manager_email=admin.email,
        organization_name="Kent Business College",
        completed=False,
        trigger_count=0,
    )


def external_kbc_user_exists(email: str) -> bool:
    lookup = normalize_text(email)
    if not lookup:
        return False

    aliases = ["kbc_users"] if "kbc_users" in connections else []
    aliases.append("default")
    user_tables = ("auth_user", "accounts_user")

    for alias in aliases:
        try:
            connection = connections[alias]
            table_names = connection.introspection.table_names()

            for table_name in user_tables:
                if table_name not in table_names:
                    continue

                with connection.cursor() as cursor:
                    columns = {
                        column.name
                        for column in connection.introspection.get_table_description(
                            cursor,
                            table_name,
                        )
                    }
                search_columns = [col for col in ("email", "username") if col in columns]
                if not search_columns:
                    continue

                conditions = " OR ".join(f"LOWER({col}) = %s" for col in search_columns)
                params = [lookup for _ in search_columns]
                active_filter = " AND is_active = TRUE" if "is_active" in columns else ""
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"SELECT 1 FROM {table_name} WHERE ({conditions}){active_filter} LIMIT 1",
                        params,
                    )
                    if cursor.fetchone():
                        return True
        except Exception as exc:
            logger.warning("Could not check external user tables on %s for %s: %s", alias, lookup, exc)

    return False


def build_frontend_login_html(token, admin, record, next_route="/onboarding"):
    frontend_url = f"{settings.FRONTEND_BASE_URL}{next_route}"
    payload = {
        "quiz_token": token,
        "learner_email": record.learner_email or admin.email,
        "admin_email": admin.email,
        "admin_name": admin.full_name or admin.email,
        "frontend_url": frontend_url,
    }
    return HttpResponse(
        f"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Signing you in...</title>
  </head>
  <body>
    <p>Signing you in...</p>
    <script>
      const payload = {json.dumps(payload)};
      localStorage.setItem("quiz_token", payload.quiz_token);
      localStorage.setItem("learner_email", payload.learner_email);
      localStorage.setItem("admin_email", payload.admin_email);
      localStorage.setItem("admin_name", payload.admin_name);
      window.location.replace(payload.frontend_url);
    </script>
  </body>
</html>
        """,
        content_type="text/html",
    )


def scale_label_for_value(value) -> str:
    """Map a 1-10 scale response to its verbal label."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return ""
    if v == 1:
        return "Never"
    if v in (2, 3):
        return "Rarely"
    if v in (4, 5):
        return "Sometimes"
    if v in (6, 7):
        return "Often"
    if v in (8, 9):
        return "Very often"
    if v == 10:
        return "Always / almost always"
    return str(v)


def ensure_json_value(value, default=None):
    if default is None:
        default = {}

    if value is None:
        return default

    if isinstance(value, (dict, list)):
        return value

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return default
        try:
            return json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            return default

    return default


def send_to_automation_webhook(record, result_json):
    payload = {
        "attempt_id": record.id,
        "wellbeing_record_id": record.id,
        "learner": {
            "id": record.id,
            "name": record.learner_name or "",
            "email": record.learner_email or "",
            "phone": record.learner_phone or "",
            "programme": record.programme or "",
            "manager_name": record.manager_name or "",
            "manager_email": record.manager_email or "",
            "coach_name": record.coach_name or "",
            "coach_email": record.coach_email or "",
            "organization_name": record.organization_name or "",
        },
        "result": result_json,
        "submitted_at": record.submitted_at.isoformat() if record.submitted_at else None,
        "risk_level": record.risk_level or "Low",
        "trigger_count": int(record.trigger_count or 0),
        "triggered_questions": record.triggered_questions or {"high": [], "medium": [], "pattern": []},
    }

    response = requests.post(
        AUTOMATION_WEBHOOK_URL,
        json=payload,
        timeout=15,
    )
    response.raise_for_status()
    return response


def serialize_question(q: SafeguardingQuestion):
    return {
        "id": q.id,
        "category_no": q.category_no,
        "category_name": q.category_name,
        "construct_type": q.construct_type,
        "score_group": q.score_group,
        "question_code": q.question_code,
        "text": q.question_text,
        "question_type": "single",
        "options": [str(i) for i in range(q.min_score, q.max_score + 1)],
        "order": q.question_order,
        "is_required": True,
        "scale_prompt": q.scale_prompt or "",
        "min_score": q.min_score,
        "max_score": q.max_score,
        "is_trigger": q.is_trigger,
        "trigger_rule": q.trigger_rule,
        "trigger_key": q.trigger_key,
        "trigger_priority": q.trigger_priority,
        "trigger_note": q.trigger_note or "",
        "is_reverse_scored": q.is_reverse_scored,
        "is_core": q.is_core,
        "rotation_cycle": q.rotation_cycle,
    }


def compute_rotation_cycle(record):
    history = record.history_json or []
    if not isinstance(history, list):
        history = []
    attempt_count = len(history)

    cycles = sorted(set(
        SafeguardingQuestion.objects.filter(
            is_active=True, is_core=False, rotation_cycle__isnull=False
        ).values_list("rotation_cycle", flat=True)
    ))

    if not cycles:
        return CURRENT_ROTATION_CYCLE

    return cycles[attempt_count % len(cycles)]


def get_active_questions(rotation_cycle=CURRENT_ROTATION_CYCLE):
    return (
        SafeguardingQuestion.objects.filter(is_active=True)
        .filter(
            models.Q(is_core=True)
            | models.Q(rotation_cycle=rotation_cycle)
        )
        .order_by("category_no", "question_order", "id")
    )


def get_all_active_questions():
    return (
        SafeguardingQuestion.objects.filter(is_active=True)
        .order_by("category_no", "question_order", "id")
    )


def normalize_answer(question: SafeguardingQuestion, raw_answer):
    try:
        raw_value = int(raw_answer)
    except (TypeError, ValueError):
        return None

    if question.is_reverse_scored:
        return question.min_score + question.max_score - raw_value

    return raw_value


def calculate_group_averages(answer_rows):
    grouped = {
        "mental": [],
        "protective": [],
        "provider": [],
        "safeguarding": [],
    }

    for row in answer_rows:
        score_group = row.get("score_group")
        if score_group in grouped:
            normalized_score = row.get("normalized_score")
            if normalized_score is not None:
                grouped[score_group].append(normalized_score)

    averages = {}
    for group_name, values in grouped.items():
        if not values:
            averages[group_name] = 0.0
        else:
            averages[group_name] = round(sum(values) / len(values), 2)

    return averages


def calculate_overall_score(group_scores):
    overall = 0.0
    for group_name, weight in GROUP_WEIGHTS.items():
        overall += group_scores.get(group_name, 0.0) * weight
    return round(overall, 2)


def classify_risk(overall_score):
    if overall_score >= 8:
        return "High"
    if overall_score >= 5:
        return "Medium"
    return "Low"


def _trigger_item(row, key):
    return {
        "question_code": key,
        "question_text": row.get("question_text", ""),
        "question_id": row.get("question_id"),
        "trigger_note": row.get("trigger_note", ""),
        "trigger_rule": row.get("trigger_rule", ""),
        "raw_answer": row.get("raw_answer"),
        "normalized_score": row.get("normalized_score"),
        "is_reverse_scored": row.get("is_reverse_scored"),
    }


def _is_triggered(row):
    """Return (triggered: bool, priority: str).
    normalized_score is the RISK score — high means more concern."""
    score = row.get("normalized_score")
    if score is None:
        return False, ""
    rule = (row.get("trigger_rule") or "").lower()
    priority = row.get("trigger_priority")
    min_s = row.get("min_score", 1)
    max_s = row.get("max_score", 10)

    def resolved_priority(default):
        return str(priority).lower() if priority else default

    # "score >= X" → trigger when risk score reaches threshold
    high_match = re.search(
        r"(?:>=|≥|above|over|greater than|high(?: score)?(?: of)?)\s*(\d+(?:\.\d+)?)",
        rule,
    )
    if high_match and score >= float(high_match.group(1)):
        return True, resolved_priority("high")

    # "low wellness <= X" → convert to risk: risk_threshold = max+min-X
    low_match = re.search(
        r"(?:<=|≤|below|under|less than|low(?: score)?(?: of)?)\s*(\d+(?:\.\d+)?)",
        rule,
    )
    if low_match:
        risk_threshold = max_s + min_s - float(low_match.group(1))
        if score >= risk_threshold:
            return True, resolved_priority("high")

    # Fallback based on risk score level — score takes authority
    if score >= 8:
        return True, "high"
    elif score >= 5:
        return True, "medium"

    return False, ""


def detect_triggers(answer_rows, group_scores):
    high = []
    medium = []
    pattern = []
    seen_keys = set()

    for row in answer_rows:
        if not row.get("is_trigger"):
            continue
        triggered, priority = _is_triggered(row)
        if not triggered:
            continue
        key = row.get("question_code") or f"q_{row.get('question_id', 'unknown')}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        item = _trigger_item(row, key)
        if priority == "high":
            high.append(item)
        else:
            medium.append(item)

    # Pattern triggers (high risk score = concerning)
    above_5_count = sum(
        1 for v in group_scores.values()
        if isinstance(v, (int, float)) and v >= 5
    )
    if above_5_count >= 3:
        pattern.append("three_categories_above_5")
    if group_scores.get("protective", 0) >= 5:
        pattern.append("protective_above_5")

    return {
        "high": high,
        "medium": medium,
        "pattern": pattern,
    }


def build_actions(triggers):
    actions = []

    if triggers["high"]:
        actions.extend(
            [
                "create_safeguarding_ticket",
                "notify_safeguarding",
                "send_email_alert",
                "send_teams_alert",
            ]
        )

    if triggers["medium"]:
        actions.extend(
            [
                "coach_followup",
                "dashboard_flag",
            ]
        )

    if triggers["pattern"]:
        actions.extend(
            [
                "monitoring_review",
                "coach_followup",
            ]
        )

    return list(dict.fromkeys(actions))


def get_latest_automation_record(record_id: int):
    return (
        SafeguardingWellbeingAutomation.objects.using("automation")
        .filter(wellbeing_record_id=record_id)
        .order_by("-created_at", "-id")
        .first()
    )


def transform_automation_payload(apprentice_dashboard, follow_up_by_coach, suggested_coach_actions):
    apprentice_dashboard = ensure_json_value(apprentice_dashboard, default={})
    follow_up_by_coach = ensure_json_value(follow_up_by_coach, default={})
    suggested_coach_actions = ensure_json_value(suggested_coach_actions, default={})

    if not isinstance(apprentice_dashboard, dict):
        apprentice_dashboard = {}
    if not isinstance(follow_up_by_coach, dict):
        follow_up_by_coach = {}
    if not isinstance(suggested_coach_actions, dict):
        suggested_coach_actions = {}

    overall_wellbeing = apprentice_dashboard.get("overall_wellbeing", {})
    workplace_experience = apprentice_dashboard.get("workplace_experience", {})
    coach_summary = follow_up_by_coach.get("summary", {})
    coach_issues = follow_up_by_coach.get("issues", {})
    coach_actions = suggested_coach_actions.get("actions", [])

    if not isinstance(overall_wellbeing, dict):
        overall_wellbeing = {}
    if not isinstance(workplace_experience, dict):
        workplace_experience = {}
    if not isinstance(coach_summary, dict):
        coach_summary = {}
    if not isinstance(coach_issues, dict):
        coach_issues = {}
    if not isinstance(coach_actions, list):
        coach_actions = []

    ai_summary = (
        coach_summary.get("followUpReason")
        or coach_summary.get("cardSubtitle")
        or ""
    )

    what_matters_now = apprentice_dashboard.get("what_matters_now", [])
    if not isinstance(what_matters_now, list) or not what_matters_now:
        what_matters_now = coach_issues.get("mainIssues", [])
    if not isinstance(what_matters_now, list):
        what_matters_now = []

    resources_self_help = []

    direct_resources = apprentice_dashboard.get("resources_self_help", [])
    if isinstance(direct_resources, list):
        for item in direct_resources:
            if isinstance(item, dict):
                title = item.get("title") or item.get("text") or item.get("label")
                if not title:
                    continue
                bullet_points = item.get("bullet_points") or []
                if not isinstance(bullet_points, list):
                    bullet_points = []
                resources_self_help.append(
                    {
                        "title": title,
                        "code": item.get("code") or "",
                        "source_url": item.get("source_url") or "",
                        "source_title": item.get("source_title") or "",
                        "bullet_points": [b for b in bullet_points if isinstance(b, str) and b.strip()],
                    }
                )
            elif isinstance(item, str) and item.strip():
                resources_self_help.append(
                    {
                        "title": item.strip(),
                        "code": "",
                        "source_url": "",
                        "source_title": "",
                        "bullet_points": [],
                    }
                )

    if not resources_self_help:
        wellbeing_actions = overall_wellbeing.get("recommended_actions", [])
        if isinstance(wellbeing_actions, list):
            for item in wellbeing_actions:
                if isinstance(item, str) and item.strip():
                    resources_self_help.append(
                        {
                            "title": item.strip(),
                            "code": "",
                            "source_url": "",
                            "source_title": "",
                            "bullet_points": [],
                        }
                    )
                elif isinstance(item, dict):
                    title = item.get("title") or item.get("text") or item.get("label")
                    if not title:
                        continue
                    bullet_points = item.get("bullet_points") or []
                    if not isinstance(bullet_points, list):
                        bullet_points = []
                    resources_self_help.append(
                        {
                            "title": title,
                            "code": item.get("code") or "",
                            "source_url": item.get("source_url") or "",
                            "source_title": item.get("source_title") or "",
                            "bullet_points": [b for b in bullet_points if isinstance(b, str) and b.strip()],
                        }
                    )

    personalised_recommendations = []

    direct_recommendations = apprentice_dashboard.get("personalised_recommendations", [])
    if isinstance(direct_recommendations, list):
        for item in direct_recommendations:
            if isinstance(item, dict):
                title = item.get("title") or item.get("text") or item.get("label")
                if not title:
                    continue
                personalised_recommendations.append(
                    {
                        "title": title,
                        "reason": item.get("reason") or item.get("description") or "",
                        "tag": item.get("tag") or item.get("type") or "SUPPORT",
                        "category": item.get("category") or "",
                        "suggested_timeline": item.get("suggested_timeline")
                        or item.get("suggestedTimeline")
                        or "",
                        "tags": item.get("tags") or [],
                    }
                )
            elif isinstance(item, str) and item.strip():
                personalised_recommendations.append(
                    {
                        "title": item.strip(),
                        "reason": "",
                        "tag": "SUPPORT",
                        "category": "",
                        "suggested_timeline": "",
                        "tags": [],
                    }
                )

    if not personalised_recommendations:
        for item in coach_actions:
            if not isinstance(item, dict):
                continue

            personalised_recommendations.append(
                {
                    "title": item.get("title") or "Recommendation",
                    "reason": item.get("reason") or "",
                    "tag": item.get("urgency") or item.get("category") or "SUPPORT",
                    "category": item.get("category") or "",
                    "suggested_timeline": item.get("suggestedTimeline") or "",
                    "tags": item.get("tags") or [],
                }
            )

    if not personalised_recommendations:
        workplace_actions = workplace_experience.get("recommended_actions", [])
        if isinstance(workplace_actions, list):
            for item in workplace_actions:
                if isinstance(item, str) and item.strip():
                    personalised_recommendations.append(
                        {
                            "title": item.strip(),
                            "reason": "",
                            "tag": "SUPPORT",
                            "category": "",
                            "suggested_timeline": "",
                            "tags": [],
                        }
                    )
                elif isinstance(item, dict):
                    title = item.get("title") or item.get("text") or item.get("label")
                    if not title:
                        continue
                    personalised_recommendations.append(
                        {
                            "title": title,
                            "reason": item.get("reason") or item.get("description") or "",
                            "tag": item.get("tag") or "SUPPORT",
                            "category": item.get("category") or "",
                            "suggested_timeline": item.get("suggested_timeline")
                            or item.get("suggestedTimeline")
                            or "",
                            "tags": item.get("tags") or [],
                        }
                    )

    transformed_apprentice_dashboard = {
        "ai_wellbeing_summary": ai_summary,
        "summary": ai_summary,
        "what_matters_now": what_matters_now,
        "resources_self_help": resources_self_help,
        "personalised_recommendations": personalised_recommendations,
        "raw_sections": apprentice_dashboard,
    }

    return {
        "apprentice_dashboard": transformed_apprentice_dashboard,
        "follow_up_by_coach": follow_up_by_coach,
        "suggested_coach_actions": suggested_coach_actions,
    }
    
@api_view(["POST"])
def login_view(request):
    email = normalize_text(request.data.get("email", ""))

    if not email:
        return Response(
            {"detail": "Email is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    record = MonitoringRecord.objects.using("wsms").filter(
        learner_email__iexact=email
    ).first()

    if not record:
        return Response(
            {"detail": "Email not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    token = create_login_token(record)

    has_completed_quiz = bool(record.completed and record.submission_json)

    return Response(
        {
            "token": token,
            "learner": {
                "id": record.id,
                "full_name": record.learner_name or "",
                "email": record.learner_email or "",
                "programme": record.programme or "",
            },
            "has_completed_quiz": has_completed_quiz,
            "attempt_id": record.id,
            "next_route": "/onboarding",
        }
    )


@api_view(["POST"])
def admin_login_view(request):
    email = normalize_text(request.data.get("email", ""))
    password = str(request.data.get("password", "")).strip()

    if not email:
        return Response(
            {"detail": "Email is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not password:
        return Response(
            {"detail": "Password is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not email.endswith(f"@{ADMIN_EMAIL_DOMAIN}"):
        return Response(
            {"detail": "Please use a Kent Business College admin email."},
            status=status.HTTP_403_FORBIDDEN,
        )

    admin = AdminAccount.objects.filter(email__iexact=email, is_active=True).first()

    if not admin or not admin.check_password(password):
        return Response(
            {"detail": "Invalid admin email or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    record = get_or_create_admin_monitoring_record(admin)
    token = create_login_token(record)
    display_name = admin.full_name or admin.email

    return Response(
        {
            "token": token,
            "admin": {
                "id": admin.id,
                "full_name": display_name,
                "email": admin.email,
                "is_staff": True,
            },
            "learner": {
                "id": record.id,
                "full_name": record.learner_name or display_name,
                "email": record.learner_email or admin.email,
                "programme": record.programme or "",
            },
            "next_route": "/onboarding",
        }
    )


@api_view(["GET"])
def admin_microsoft_start_view(request):
    if not settings.MS_TENANT_ID or not settings.MS_CLIENT_ID:
        return Response(
            {"detail": "Microsoft login is not configured."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    state = signing.dumps(
        {"nonce": uuid.uuid4().hex},
        salt=ADMIN_MICROSOFT_STATE_SALT,
    )
    params = {
        "client_id": settings.MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.MS_REDIRECT_URI,
        "response_mode": "query",
        "scope": "openid profile email User.Read",
        "state": state,
        "prompt": "select_account",
    }
    auth_url = (
        f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}"
        f"/oauth2/v2.0/authorize?{urlencode(params)}"
    )
    return HttpResponse(status=302, headers={"Location": auth_url})


@api_view(["GET"])
def admin_microsoft_callback_view(request):
    error = request.GET.get("error")
    if error:
        description = request.GET.get("error_description", error)
        return HttpResponse(f"Microsoft login failed: {_pdf_escape(description)}", status=400)

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code or not state:
        return HttpResponse("Missing Microsoft login code or state.", status=400)

    try:
        signing.loads(state, salt=ADMIN_MICROSOFT_STATE_SALT, max_age=60 * 10)
    except signing.BadSignature:
        return HttpResponse("Invalid or expired Microsoft login state.", status=400)

    token_response = requests.post(
        f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": settings.MS_CLIENT_ID,
            "client_secret": settings.MS_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.MS_REDIRECT_URI,
            "scope": "openid profile email User.Read",
        },
        timeout=30,
    )
    if not token_response.ok:
        logger.warning("Microsoft login token exchange failed: %s", token_response.text)
        return HttpResponse("Microsoft login token exchange failed.", status=400)

    access_token = token_response.json().get("access_token")
    if not access_token:
        return HttpResponse("Microsoft did not return an access token.", status=400)

    me_response = requests.get(
        "https://graph.microsoft.com/v1.0/me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if not me_response.ok:
        logger.warning("Microsoft /me failed: %s", me_response.text)
        return HttpResponse("Could not read Microsoft account details.", status=400)

    profile = me_response.json()
    email = normalize_text(profile.get("mail") or profile.get("userPrincipalName") or "")
    full_name = (profile.get("displayName") or display_name_from_email(email)).strip()

    if not email or not email.endswith(f"@{ADMIN_EMAIL_DOMAIN}"):
        return HttpResponse("Please use a Kent Business College Microsoft account.", status=403)

    admin = AdminAccount.objects.filter(email__iexact=email).first()
    if not admin:
        User = get_user_model()
        django_user_exists = User.objects.filter(email__iexact=email, is_active=True).exists()
        if not django_user_exists:
            django_user_exists = User.objects.filter(username__iexact=email, is_active=True).exists()
        kbc_user_exists = external_kbc_user_exists(email)
        if not django_user_exists and not kbc_user_exists:
            return HttpResponse("This Microsoft account is not registered for admin access.", status=403)

        admin = AdminAccount(
            email=email,
            full_name=full_name,
            password_hash="!microsoft-oauth",
            is_active=True,
        )
        admin.save()
    else:
        updates = []
        if full_name and admin.full_name != full_name:
            admin.full_name = full_name
            updates.append("full_name")
        if not admin.is_active:
            admin.is_active = True
            updates.append("is_active")
        if updates:
            updates.append("updated_at")
            admin.save(update_fields=updates)

    record = get_or_create_admin_monitoring_record(admin)
    token = create_login_token(record)
    return build_frontend_login_html(token, admin, record)


@api_view(["POST"])
def admin_register_view(request):
    email = normalize_text(request.data.get("email", ""))
    password = str(request.data.get("password", "")).strip()
    full_name = str(request.data.get("full_name", "")).strip()

    if not email:
        return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

    if not email.endswith(f"@{ADMIN_EMAIL_DOMAIN}"):
        return Response(
            {"detail": "Please use a Kent Business College admin email."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if len(password) < 10:
        return Response(
            {"detail": "Password must be at least 10 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if AdminAccount.objects.filter(email__iexact=email).exists():
        return Response(
            {"detail": "An admin account already exists for this email."},
            status=status.HTTP_409_CONFLICT,
        )

    admin = AdminAccount(
        email=email,
        full_name=full_name or display_name_from_email(email),
        is_active=True,
    )
    admin.set_password(password)
    admin.save()

    return Response(
        {
            "message": "Admin account created successfully. You can sign in now.",
            "admin": {
                "id": admin.id,
                "full_name": admin.full_name or admin.email,
                "email": admin.email,
                "is_staff": True,
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def admin_change_password_view(request):
    email = normalize_text(request.data.get("email", ""))
    current_password = str(request.data.get("current_password", "")).strip()
    new_password = str(request.data.get("new_password", "")).strip()

    if not email:
        return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

    if not email.endswith(f"@{ADMIN_EMAIL_DOMAIN}"):
        return Response(
            {"detail": "Please use a Kent Business College admin email."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not current_password or not new_password:
        return Response(
            {"detail": "Current password and new password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < 10:
        return Response(
            {"detail": "New password must be at least 10 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    admin = AdminAccount.objects.filter(email__iexact=email, is_active=True).first()

    if not admin or not admin.check_password(current_password):
        return Response(
            {"detail": "Invalid admin email or current password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    admin.set_password(new_password)
    admin.save(update_fields=["password_hash", "updated_at"])

    return Response({"message": "Password changed successfully."})


@api_view(["POST"])
def admin_forgot_password_view(request):
    email = normalize_text(request.data.get("email", ""))

    if not email:
        return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

    if not email.endswith(f"@{ADMIN_EMAIL_DOMAIN}"):
        return Response(
            {"detail": "Please use a Kent Business College admin email."},
            status=status.HTTP_403_FORBIDDEN,
        )

    admin = AdminAccount.objects.filter(email__iexact=email, is_active=True).first()

    if admin:
        token = signing.dumps(
            {"admin_id": admin.id, "email": admin.email},
            salt=ADMIN_PASSWORD_RESET_SALT,
        )
        reset_url = f"{settings.FRONTEND_BASE_URL}/admin/reset-password?token={token}"
        try:
            send_mail(
                "Reset your KBC admin password",
                (
                    "Use the link below to set a new KBC admin password.\n\n"
                    f"{reset_url}\n\n"
                    "This link expires in 1 hour. If you did not request this, you can ignore this email."
                ),
                settings.DEFAULT_FROM_EMAIL,
                [admin.email],
                fail_silently=False,
            )
        except Exception as exc:
            logger.warning("Admin password reset email failed for %s: %s", admin.email, exc)
            return Response(
                {"detail": "Could not send reset email. Please check SMTP settings."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    return Response({"message": "If this admin account exists, a reset link has been sent."})


@api_view(["POST"])
def admin_reset_password_view(request):
    token = str(request.data.get("token", "")).strip()
    new_password = str(request.data.get("new_password", "")).strip()

    if not token:
        return Response({"detail": "Reset token is required."}, status=status.HTTP_400_BAD_REQUEST)

    if len(new_password) < 10:
        return Response(
            {"detail": "New password must be at least 10 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        data = signing.loads(
            token,
            salt=ADMIN_PASSWORD_RESET_SALT,
            max_age=ADMIN_PASSWORD_RESET_MAX_AGE,
        )
    except signing.SignatureExpired:
        return Response({"detail": "Reset link has expired."}, status=status.HTTP_400_BAD_REQUEST)
    except signing.BadSignature:
        return Response({"detail": "Invalid reset link."}, status=status.HTTP_400_BAD_REQUEST)

    admin = AdminAccount.objects.filter(
        id=data.get("admin_id"),
        email__iexact=data.get("email"),
        is_active=True,
    ).first()

    if not admin:
        return Response({"detail": "Admin account not found."}, status=status.HTTP_404_NOT_FOUND)

    admin.set_password(new_password)
    admin.save(update_fields=["password_hash", "updated_at"])

    return Response({"message": "Password reset successfully. You can sign in now."})


@api_view(["GET"])
def admin_me_view(request):
    admin = get_admin_from_request(request)
    return Response(
        {
            "admin": {
                "id": admin.id,
                "full_name": admin.full_name or admin.email,
                "email": admin.email,
                "is_staff": True,
            }
        }
    )


@api_view(["GET"])
def admin_learners_view(request):
    admin = get_admin_from_request(request)
    email = normalize_text(admin.email)

    records = (
        MonitoringRecord.objects.using("wsms")
        .filter(models.Q(coach_email__iexact=email) | models.Q(manager_email__iexact=email))
        .order_by("learner_name", "learner_email")
    )

    return Response(
        {
            "learners": [
                {
                    "id": record.id,
                    "full_name": record.learner_name or "",
                    "email": record.learner_email or "",
                    "programme": record.programme or "",
                    "coach_email": record.coach_email or "",
                    "manager_email": record.manager_email or "",
                    "completed": bool(record.completed),
                }
                for record in records
            ]
        }
    )


@api_view(["POST"])
def admin_learner_token_view(request, learner_id: int):
    admin = get_admin_from_request(request)
    email = normalize_text(admin.email)

    record = (
        MonitoringRecord.objects.using("wsms")
        .filter(
            models.Q(coach_email__iexact=email) | models.Q(manager_email__iexact=email),
            id=learner_id,
        )
        .first()
    )

    if not record:
        return Response(
            {"detail": "Learner not found for this admin."},
            status=status.HTTP_404_NOT_FOUND,
        )

    return Response(
        {
            "token": create_login_token(record),
            "learner": {
                "id": record.id,
                "full_name": record.learner_name or "",
                "email": record.learner_email or "",
                "programme": record.programme or "",
            },
            "next_route": "/onboarding",
        }
    )


@api_view(["GET"])
def instructions_view(request):
    record = get_record_from_request(request)
    questions_count = get_active_questions(compute_rotation_cycle(record)).count()

    return Response(
        {
            "learner": {
                "id": record.id,
                "full_name": record.learner_name or "",
                "email": record.learner_email or "",
                "programme": record.programme or "",
            },
            "quiz": {
                "id": 1,
                "title": "Wellbeing & Safeguarding Assessment",
                "instructions": (
                    "Please answer each question honestly. "
                    "Your responses will be used for wellbeing and safeguarding monitoring."
                ),
                "questions_count": questions_count,
            },
        }
    )


@api_view(["GET"])
def quiz_status_view(request):
    """Returns whether the learner has previous quiz history and their record id."""
    record = get_record_from_request(request)
    history = ensure_json_value(record.history_json, default=[])
    if not isinstance(history, list):
        history = []
    return Response({
        "has_history": len(history) > 0,
        "attempt_id": record.id,
    })


@api_view(["POST"])
def start_quiz_view(request):
    record = get_record_from_request(request)

    return Response(
        {
            "attempt_id": record.id,
            "message": "Assessment started successfully.",
        }
    )


@api_view(["GET"])
def questions_view(request):
    record = get_record_from_request(request)

    questions = [serialize_question(q) for q in get_active_questions(compute_rotation_cycle(record))]

    return Response(
        {
            "quiz_id": 1,
            "questions": questions,
        }
    )


@api_view(["POST"])
def submit_quiz_view(request):
    record = get_record_from_request(request)
    submitted_answers = request.data.get("answers", [])
    submitted_at = timezone.now()

    questions = {q.id: q for q in get_all_active_questions()}
    answer_rows = []

    for item in submitted_answers:
        question_id = item.get("question_id")
        raw_answer = item.get("answer")

        question = questions.get(question_id)
        if not question:
            continue

        try:
            raw_answer_int = int(raw_answer)
        except (TypeError, ValueError):
            raw_answer_int = None

        normalized_score = normalize_answer(question, raw_answer_int)

        answer_rows.append(
            {
                "question_id": question.id,
                "question_code": question.question_code,
                "question_text": question.question_text,
                "category_no": question.category_no,
                "category_name": question.category_name,
                "construct_type": question.construct_type,
                "score_group": question.score_group,
                "scale_prompt": question.scale_prompt or "",
                "raw_answer": raw_answer_int,
                "normalized_score": normalized_score,
                "min_score": question.min_score,
                "max_score": question.max_score,
                "is_reverse_scored": question.is_reverse_scored,
                "is_trigger": question.is_trigger,
                "trigger_rule": question.trigger_rule or "",
                "trigger_key": question.trigger_key,
                "trigger_priority": question.trigger_priority,
                "trigger_note": question.trigger_note or "",
            }
        )

    group_scores = calculate_group_averages(answer_rows)
    overall_score = calculate_overall_score(group_scores)
    risk_level = classify_risk(overall_score)
    triggers = detect_triggers(answer_rows, group_scores)
    actions = build_actions(triggers)

    result_json = {
        "student_id": str(record.id),
        "scores": {
            "mental": group_scores.get("mental", 0.0),
            "protective": group_scores.get("protective", 0.0),
            "provider": group_scores.get("provider", 0.0),
            "safeguarding": group_scores.get("safeguarding", 0.0),
            "overall": overall_score,
        },
        "score_labels": {
            "mental": "Mental Health",
            "protective": "Protective Factors",
            "provider": "Provider Support",
            "safeguarding": "Safeguarding Safety",
            "overall": "Overall Score",
        },
        "risk_level": risk_level,
        "triggers": triggers,
        "actions": actions,
        "answers": answer_rows,
        "timestamp": submitted_at.isoformat(),
    }

    record.submission_json = result_json
    record.total_score = overall_score
    record.category_1_score = group_scores.get("protective", 0.0)
    record.category_2_score = group_scores.get("mental", 0.0)
    record.category_3_score = group_scores.get("provider", 0.0)
    record.category_4_score = group_scores.get("safeguarding", 0.0)
    record.trigger_count = (
        len(triggers["high"]) + len(triggers["medium"]) + len(triggers["pattern"])
    )
    record.triggered_questions = triggers
    record.risk_level = risk_level
    record.submitted_at = submitted_at
    record.completed = True

    existing_history = record.history_json or []
    if not isinstance(existing_history, list):
        existing_history = []

    existing_history.append(result_json)
    record.history_json = existing_history

    record.save(
        using="wsms",
        update_fields=[
            "submission_json",
            "history_json",
            "total_score",
            "category_1_score",
            "category_2_score",
            "category_3_score",
            "category_4_score",
            "trigger_count",
            "triggered_questions",
            "risk_level",
            "submitted_at",
            "completed",
        ],
    )

    # Auto-create ticket when triggers are detected
    if triggers["high"]:
        ticket_type = "safeguarding"
        subject = f"[AUTO] Safeguarding concern flagged — {record.learner_name or record.learner_email}"
    elif triggers["medium"] or triggers["pattern"]:
        ticket_type = "wellbeing"
        subject = f"[AUTO] Wellbeing concern flagged — {record.learner_name or record.learner_email}"
    else:
        ticket_type = None

    if ticket_type:
        triggered_lines = []
        for row in answer_rows:
            if not row.get("is_trigger"):
                continue
            triggered, priority = _is_triggered(row)
            if not triggered:
                continue
            raw = row.get("raw_answer")
            text = row.get("question_text") or row.get("question_code") or ""
            triggered_lines.append(f"• {text} (Score: {raw}) [{priority}]")

        details = (
            f"Auto-generated ticket from wellbeing survey.\n\n"
            f"Risk Level:    {risk_level}\n"
            f"Total Score:   {overall_score}\n"
            f"Trigger Count: {record.trigger_count}\n"
            f"Programme:     {record.programme or '—'}\n"
            f"Coach:         {record.coach_name or '—'}\n"
        )
        if triggered_lines:
            details += "\nTriggered Questions:\n" + "\n".join(triggered_lines)

        try:
            from datetime import timedelta
            recent_exists = SupportTicket.objects.filter(
                wellbeing_record_id=record.id,
                created_by__iexact="system",
                created_at__gte=timezone.now() - timedelta(minutes=2),
            ).exists()
            if not recent_exists:
                SupportTicket.objects.create(
                    wellbeing_record_id=record.id,
                    created_by="system",
                    ticket_type=ticket_type,
                    full_name=record.learner_name or "",
                    email=record.learner_email or "",
                    subject=subject,
                    details=details,
                    urgency=risk_level.lower(),
                    preferred_contact="email",
                    status="New",
                )
        except Exception:
            logger.exception(
                "Failed to auto-create ticket for record %s", record.id
            )

    webhook_sent = False
    webhook_error = None

    try:
        send_to_automation_webhook(record, result_json)
        webhook_sent = True
    except Exception as exc:
        webhook_error = str(exc)
        logger.exception(
            "Failed to send wellbeing automation webhook for record %s",
            record.id,
        )

    return Response(
        {
            "message": "Assessment submitted successfully.",
            "attempt_id": record.id,
            "scores": result_json["scores"],
            "risk_level": risk_level,
            "triggers": triggers,
            "actions": actions,
            "webhook_sent": webhook_sent,
            "webhook_error": webhook_error,
        }
    )


@api_view(["GET"])
def result_view(request, attempt_id):
    record = get_record_from_request(request)

    if record.id != attempt_id:
        return Response(
            {"detail": "Result not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    submission_data = ensure_json_value(record.submission_json, default={})
    submission_items = ensure_json_value(submission_data.get("answers", []), default=[])

    if not isinstance(submission_items, list):
        submission_items = []

    result_questions = []
    for item in submission_items:
        if not isinstance(item, dict):
            continue

        result_questions.append(
            {
                "question_id": item.get("question_id"),
                "question": item.get("question_text"),
                "your_answer": item.get("raw_answer"),
                "category_no": item.get("category_no"),
                "category_name": item.get("category_name"),
                "construct_type": item.get("construct_type"),
            }
        )

    history_items = ensure_json_value(record.history_json, default=[])
    if not isinstance(history_items, list):
        history_items = []

    history_items = history_items[-4:]

    trends = []
    for item in history_items:
        if not isinstance(item, dict):
            continue

        submitted_at_value = item.get("timestamp")
        label = "Unknown"

        if submitted_at_value:
            try:
                dt = timezone.datetime.fromisoformat(
                    str(submitted_at_value).replace("Z", "+00:00")
                )
                label = dt.strftime("%b %Y")
            except Exception:
                label = "Unknown"

        scores = ensure_json_value(item.get("scores", {}), default={})
        if not isinstance(scores, dict):
            scores = {}

        trends.append(
            {
                "label": label,
                "mental": float(scores.get("mental", 0) or 0),
                "protective": float(scores.get("protective", 0) or 0),
                "provider": float(scores.get("provider", 0) or 0),
                "safeguarding": float(scores.get("safeguarding", 0) or 0),
                "overall": float(scores.get("overall", 0) or 0),
                "risk_level": item.get("risk_level", "Low") or "Low",
            }
        )

    current_scores = ensure_json_value(submission_data.get("scores", {}), default={})
    if not isinstance(current_scores, dict):
        current_scores = {}

    return Response(
        {
            "attempt_id": record.id,
            "learner": {
                "name": record.learner_name or "",
                "email": record.learner_email or "",
                "programme": record.programme or "",
            },
            "quiz": "Wellbeing & Safeguarding Assessment",
            "submitted_at": record.submitted_at,
            "score": float(record.total_score or 0),
            "total_score": float(record.total_score or 0),
            "trigger_count": int(record.trigger_count or 0),
            "risk_level": record.risk_level or "Low",
            "scores": {
                "mental": float(current_scores.get("mental", 0) or 0),
                "protective": float(current_scores.get("protective", 0) or 0),
                "provider": float(current_scores.get("provider", 0) or 0),
                "safeguarding": float(current_scores.get("safeguarding", 0) or 0),
                "overall": float(current_scores.get("overall", 0) or 0),
            },
            "score_labels": {
                "mental": "Mental Health",
                "protective": "Protective Factors",
                "provider": "Provider Support",
                "safeguarding": "Safeguarding Safety",
                "overall": "Overall Score",
            },
            "triggers": ensure_json_value(
                submission_data.get("triggers", {"high": [], "medium": [], "pattern": []}),
                default={"high": [], "medium": [], "pattern": []},
            ),
            "actions": ensure_json_value(submission_data.get("actions", []), default=[]),
            "trends": trends,
            "questions": result_questions,
            "total_questions": len(result_questions),
        }
    )


@api_view(["POST"])
def send_result_to_employer_view(request, attempt_id):
    record = get_record_from_request(request)

    if record.id != attempt_id:
        return Response(
            {"detail": "Result not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    recipient = record.manager_email or record.coach_email
    if not recipient:
        return Response(
            {"detail": "No employer or manager email found."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    send_mail(
        subject=f"Wellbeing & Safeguarding Result for {record.learner_name or record.learner_email}",
        message=(
            f"Learner: {record.learner_name or ''}\n"
            f"Email: {record.learner_email or ''}\n"
            f"Programme: {record.programme or ''}\n"
            f"Total Score: {record.total_score or 0}\n"
            f"Risk Level: {record.risk_level or 'Low'}\n"
            f"Trigger Count: {record.trigger_count or 0}\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient],
        fail_silently=False,
    )

    return Response({"message": "Result sent successfully."})


@api_view(["GET"])
def automation_dashboard_view(request, attempt_id):
    record = get_record_from_request(request)

    if record.id != attempt_id:
        return Response(
            {"detail": "Result not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    empty_dashboard = {
        "attempt_id": record.id,
        "apprentice_dashboard": {
            "ai_wellbeing_summary": "",
            "summary": "",
            "what_matters_now": [],
            "resources_self_help": [],
            "personalised_recommendations": [],
        },
        "follow_up_by_coach": {},
        "suggested_coach_actions": {},
        "message": "Automation dashboard not available.",
    }

    try:
        automation_record = get_latest_automation_record(record.id)
    except Exception as exc:
        logger.warning(
            "Could not fetch automation record for wellbeing record %s: %s",
            record.id,
            exc,
        )
        return Response(empty_dashboard)

    if not automation_record:
        return Response(
            {
                "attempt_id": record.id,
                "apprentice_dashboard": {
                    "ai_wellbeing_summary": "",
                    "summary": "",
                    "what_matters_now": [],
                    "resources_self_help": [],
                    "personalised_recommendations": [],
                },
                "follow_up_by_coach": {},
                "suggested_coach_actions": {},
                "message": "No automation dashboard found.",
            }
        )

    transformed = transform_automation_payload(
        automation_record.apprentice_dashboard,
        automation_record.follow_up_by_coach,
        automation_record.suggested_coach_actions,
    )

    return Response(
        {
            "attempt_id": record.id,
            "apprentice_dashboard": transformed["apprentice_dashboard"],
            "follow_up_by_coach": transformed["follow_up_by_coach"],
            "suggested_coach_actions": transformed["suggested_coach_actions"],
            "created_at": automation_record.created_at,
            "updated_at": automation_record.updated_at,
        }
    )

# tickets
EMPLOYER_NOTIFY_WEBHOOK_URL = "https://n8n.srv943390.hstgr.cloud/webhook/cb4f0c50-e92c-418a-ad3e-c1b25f6c951e"

@api_view(["POST"])
def notify_employer_view(request, attempt_id):
    record = get_record_from_request(request)

    if record.id != attempt_id:
        return Response({"detail": "Result not found."}, status=status.HTTP_404_NOT_FOUND)

    record.employer_notified_at = timezone.now()
    record.save(using="wsms", update_fields=["employer_notified_at"])

    try:
        requests.get(
            EMPLOYER_NOTIFY_WEBHOOK_URL,
            params={
                "attempt_id": record.id,
                "learner_name": record.learner_name or "",
                "learner_email": record.learner_email or "",
                "employer_email": record.manager_email or record.coach_email or "",
            },
            timeout=10,
        )
    except Exception as exc:
        logger.warning("Employer notification webhook failed: %s", exc)

    return Response({"message": "Employer notification recorded successfully."})


def _normalize_pdf_text(value):
    text = str(value or "")
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2011": "-",
        "\u2022": "-",
        "\u00a0": " ",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text


def _pdf_escape(value):
    text = _normalize_pdf_text(value)
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _make_simple_pdf(title, lines):
    pages = []
    current = []
    for raw_line in lines:
        text = str(raw_line or "")
        wrapped = textwrap.wrap(text, width=92) or [""]
        for line in wrapped:
            current.append(line)
            if len(current) >= 46:
                pages.append(current)
                current = []
    if current or not pages:
        pages.append(current)

    objects = [""]  # 1-indexed PDF objects
    page_object_ids = []
    content_object_ids = []

    catalog_id = len(objects)
    objects.append("")
    pages_id = len(objects)
    objects.append("")
    font_id = len(objects)
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    bold_font_id = len(objects)
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    for page_lines in pages:
        content_id = len(objects)
        content_object_ids.append(content_id)
        page_id = len(objects) + 1
        page_object_ids.append(page_id)

        stream = [
            "BT",
            "/F2 16 Tf",
            "50 790 Td",
            f"({_pdf_escape(title)}) Tj",
            "/F1 9 Tf",
            "0 -24 Td",
        ]
        for line in page_lines:
            stream.append(f"({_pdf_escape(line)}) Tj")
            stream.append("0 -14 Td")
        stream.append("ET")
        stream_data = "\n".join(stream).encode("latin-1", errors="replace")
        objects.append(
            f"<< /Length {len(stream_data)} >>\nstream\n"
            + stream_data.decode("latin-1")
            + "\nendstream"
        )
        objects.append(
            "<< /Type /Page "
            f"/Parent {pages_id} 0 R "
            "/MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_id} 0 R /F2 {bold_font_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        )

    objects[catalog_id] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>"
    objects[pages_id] = (
        f"<< /Type /Pages /Kids [{' '.join(f'{pid} 0 R' for pid in page_object_ids)}] "
        f"/Count {len(page_object_ids)} >>"
    )

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj_id in range(1, len(objects)):
        offsets.append(len(pdf))
        pdf.extend(f"{obj_id} 0 obj\n{objects[obj_id]}\nendobj\n".encode("latin-1", errors="replace"))

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects)} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf)


class SimplePdf:
    width = 595
    height = 842
    margin = 42
    purple = (36, 20, 83)
    deep_purple = (68, 47, 115)
    gold = (178, 119, 21)
    gold_light = (249, 244, 236)
    gold_mid = (233, 217, 189)
    muted = (92, 86, 106)
    ink = (37, 35, 45)
    success = (34, 97, 58)
    warning = (138, 90, 18)
    danger = (159, 47, 67)

    def __init__(self, title):
        self.title = title
        self.pages = []
        self.ops = []
        self.y = self.height - self.margin
        self.page_no = 0
        self.add_page()

    def add_page(self):
        if self.ops:
            self._footer()
            self.pages.append("\n".join(self.ops))
        self.page_no += 1
        self.ops = []
        self.y = self.height - self.margin
        if self.page_no > 1:
            self.text(self.title, self.margin, self.y, size=9, color=self.muted)
            self.y -= 18

    def finish(self):
        self._footer()
        self.pages.append("\n".join(self.ops))
        return self._build_pdf()

    def _footer(self):
        self.rect(0, 0, self.width, 26, fill=self.gold_light)
        self.rect(0, 25, self.width, 1, fill=self.gold_mid)
        self.text(
            "Kent Business College | Employee Inclusiveness Report",
            self.margin,
            10,
            size=7,
            color=self.muted,
        )
        self.text(
            f"Page {self.page_no}",
            self.width - self.margin,
            10,
            size=7,
            color=self.muted,
            align="right",
        )

    @staticmethod
    def _rgb(color):
        return " ".join(f"{c / 255:.4f}" for c in color)

    def rect(self, x, y, w, h, fill=None, stroke=None, line_width=1):
        if fill:
            self.ops.append(f"{self._rgb(fill)} rg")
        if stroke:
            self.ops.append(f"{self._rgb(stroke)} RG {line_width} w")
        mode = "B" if fill and stroke else "f" if fill else "S"
        self.ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {mode}")

    def line(self, x1, y1, x2, y2, color=None, line_width=1):
        if color:
            self.ops.append(f"{self._rgb(color)} RG {line_width} w")
        self.ops.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def text(self, text, x, y, size=10, color=None, bold=False, align="left"):
        text = _pdf_escape(text)
        if color:
            self.ops.append(f"{self._rgb(color)} rg")
        font = "F2" if bold else "F1"
        if align != "left":
            # Rough but stable enough for right/center labels in Helvetica.
            estimated = len(text) * size * 0.48
            if align == "right":
                x -= estimated
            elif align == "center":
                x -= estimated / 2
        self.ops.append(f"BT /{font} {size:.2f} Tf {x:.2f} {y:.2f} Td ({text}) Tj ET")

    def wrapped_text(self, text, x, y, width_chars=80, size=9, color=None, bold=False, leading=12, paragraph_gap=4):
        paragraphs = [p.strip() for p in _normalize_pdf_text(text).splitlines() if p.strip()] or [""]
        for idx, paragraph in enumerate(paragraphs):
            lines = textwrap.wrap(paragraph, width=width_chars) or [""]
            for line in lines:
                if y < 66:
                    self.add_page()
                    y = self.y
                self.text(line, x, y, size=size, color=color, bold=bold)
                y -= leading
            if idx < len(paragraphs) - 1:
                y -= paragraph_gap
        return y

    def wrap_lines(self, text, width_chars=80, max_lines=None):
        lines = []
        for paragraph in _normalize_pdf_text(text).splitlines() or [""]:
            lines.extend(textwrap.wrap(paragraph, width=width_chars) or [""])
        if max_lines and len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = lines[-1][: max(0, width_chars - 3)].rstrip() + "..."
        return lines

    def draw_lines(self, lines, x, y, size=9, color=None, bold=False, leading=12):
        for line in lines:
            if y < 66:
                self.add_page()
                y = self.y
            self.text(line, x, y, size=size, color=color, bold=bold)
            y -= leading
        return y

    def ensure_space(self, height):
        if self.y - height < 56:
            self.add_page()

    def section_label(self, label, min_following=72):
        self.ensure_space(min_following)
        self.text(label.upper(), self.margin, self.y, size=8, color=self.gold, bold=True)
        self.y -= 16

    def badge(self, text, x, y, width, fill, color=None):
        self.rect(x, y - 3, width, 16, fill=fill, stroke=None)
        self.text(text, x + width / 2, y + 2, size=8, color=color or self.purple, bold=True, align="center")

    def bullet_list(self, items, x, width_chars=74):
        for item in items[:8]:
            lines = self.wrap_lines(item, width_chars=width_chars)
            self.ensure_space(max(34, len(lines) * 12 + 8))
            self.text("-", x, self.y, size=9, color=self.gold, bold=True)
            self.y = self.draw_lines(lines, x + 12, self.y, size=8.5, color=self.ink, leading=12)
            self.y -= 5

    def _build_pdf(self):
        objects = [""]
        catalog_id = len(objects)
        objects.append("")
        pages_id = len(objects)
        objects.append("")
        font_id = len(objects)
        objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        bold_font_id = len(objects)
        objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

        page_ids = []
        for stream_text in self.pages:
            stream_data = stream_text.encode("latin-1", errors="replace")
            content_id = len(objects)
            objects.append(
                f"<< /Length {len(stream_data)} >>\nstream\n"
                + stream_data.decode("latin-1")
                + "\nendstream"
            )
            page_id = len(objects)
            page_ids.append(page_id)
            objects.append(
                "<< /Type /Page "
                f"/Parent {pages_id} 0 R "
                "/MediaBox [0 0 595 842] "
                f"/Resources << /Font << /F1 {font_id} 0 R /F2 {bold_font_id} 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            )

        objects[catalog_id] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>"
        objects[pages_id] = (
            f"<< /Type /Pages /Kids [{' '.join(f'{pid} 0 R' for pid in page_ids)}] "
            f"/Count {len(page_ids)} >>"
        )

        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for obj_id in range(1, len(objects)):
            offsets.append(len(pdf))
            pdf.extend(f"{obj_id} 0 obj\n{objects[obj_id]}\nendobj\n".encode("latin-1", errors="replace"))
        xref_pos = len(pdf)
        pdf.extend(f"xref\n0 {len(objects)}\n".encode("ascii"))
        pdf.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        pdf.extend(
            (
                f"trailer\n<< /Size {len(objects)} /Root {catalog_id} 0 R >>\n"
                f"startxref\n{xref_pos}\n%%EOF\n"
            ).encode("ascii")
        )
        return bytes(pdf)


def _risk_color(risk):
    risk = str(risk or "").lower()
    if "very" in risk:
        return SimplePdf.danger
    if "high" in risk:
        return (217, 119, 6)
    if "medium" in risk:
        return (29, 90, 158)
    return SimplePdf.success


def _employee_report_text(value):
    text = _normalize_pdf_text(value)
    text = re.sub(r"\s*\(?selected[_\s-]*value\s*[:=]?\s*\d+\)?\.?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*\(?value\s*[:=]\s*\d+\)?\.?", "", text, flags=re.IGNORECASE)
    phrase_replacements = [
        ("Overall, your responses suggest", "Overall, your answers indicate"),
        ("Most of your answers indicate", "Most answers show"),
        ("The employee shows generally", "The responses show generally"),
        ("there are targeted indicators in:", "the main points to note are:"),
        ("Support planning can be proportionate:", "Support can stay proportionate:"),
        ("rather than intensive intervention", "rather than a formal intervention"),
    ]
    for old, new in phrase_replacements:
        text = text.replace(old, new)
    replacements = [
        (r"\bprogramme tasks\b", "work tasks"),
        (r"\bProgramme tasks\b", "Work tasks"),
        (r"\bprogrammes\b", "roles"),
        (r"\bProgrammes\b", "Roles"),
        (r"\bprogramme\b", "role"),
        (r"\bProgramme\b", "Role"),
        (r"\blearners\b", "employees"),
        (r"\bLearners\b", "Employees"),
        (r"\blearner\b", "employee"),
        (r"\bLearner\b", "Employee"),
        (r"\bcoaches\b", "managers"),
        (r"\bCoaches\b", "Managers"),
        (r"\bcoach\b", "manager"),
        (r"\bCoach\b", "Manager"),
        (r"\btutors\b", "line managers"),
        (r"\bTutors\b", "Line Managers"),
        (r"\btutor\b", "line manager"),
        (r"\bTutor\b", "Line Manager"),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)
    return _normalize_pdf_text(text)


def _employee_action_owner(owner):
    normalized = str(owner or "").strip().lower()
    mapping = {
        "learner": "Employee",
        "coach": "Manager",
        "tutor": "Line Manager",
        "employer": "Employer",
        "support team": "Support Team",
    }
    return mapping.get(normalized, _employee_report_text(owner or "Owner"))


def _build_designed_onboarding_pdf(record, reports):
    title = f"Inclusiveness report - {record.learner_name or record.learner_email or record.id}"
    pdf = SimplePdf(title)

    # Cover/header.
    pdf.rect(0, 772, pdf.width, 70, fill=pdf.purple)
    pdf.rect(0, 768, pdf.width, 4, fill=pdf.gold)
    pdf.text("Kent Business College", pdf.margin, 810, size=15, color=(255, 255, 255), bold=True)
    pdf.text("Employee Inclusiveness Report", pdf.margin, 792, size=10, color=pdf.gold_mid)
    pdf.text(timezone.now().strftime("%d %b %Y"), pdf.width - pdf.margin, 804, size=9, color=pdf.gold_mid, align="right")
    pdf.y = 742

    pdf.text("Inclusiveness Report", pdf.margin, pdf.y, size=21, color=pdf.deep_purple, bold=True)
    pdf.y -= 24
    pdf.rect(pdf.margin, pdf.y - 44, pdf.width - pdf.margin * 2, 54, fill=pdf.gold_light, stroke=pdf.gold_mid)
    detail_y = pdf.y - 10
    pdf.text("Employee", pdf.margin + 16, detail_y, size=8, color=pdf.gold, bold=True)
    pdf.text(record.learner_name or "Unknown", pdf.margin + 16, detail_y - 15, size=12, color=pdf.deep_purple, bold=True)
    pdf.text("Email", pdf.margin + 220, detail_y, size=8, color=pdf.gold, bold=True)
    pdf.text(record.learner_email or "", pdf.margin + 220, detail_y - 15, size=10, color=pdf.ink)
    pdf.y -= 72

    summary_rows = []
    for section_id, _field in _SECTION_REPORT_FIELD.items():
        report = reports.get(section_id, {})
        section = report.get("section", {}) if isinstance(report.get("section"), dict) else {}
        score = report.get("score", {}) if isinstance(report.get("score"), dict) else {}
        summary_rows.append(
            (
                section.get("title") or section_id.replace("_", " ").title(),
                score.get("total", ""),
                score.get("max", ""),
                score.get("riskLevel", "Low"),
            )
        )

    pdf.section_label("At a glance")
    pdf.rect(pdf.margin, pdf.y - 24, pdf.width - pdf.margin * 2, 28, fill=pdf.deep_purple)
    pdf.text("Area", pdf.margin + 12, pdf.y - 8, size=8, color=(255, 255, 255), bold=True)
    pdf.text("Score", pdf.margin + 335, pdf.y - 8, size=8, color=(255, 255, 255), bold=True)
    pdf.text("Risk", pdf.margin + 420, pdf.y - 8, size=8, color=(255, 255, 255), bold=True)
    pdf.y -= 34
    for idx, (area, total, max_score, risk) in enumerate(summary_rows, start=1):
        fill = (255, 255, 255) if idx % 2 else (252, 249, 255)
        pdf.rect(pdf.margin, pdf.y - 19, pdf.width - pdf.margin * 2, 23, fill=fill, stroke=(232, 224, 242), line_width=0.4)
        pdf.text(area[:58], pdf.margin + 12, pdf.y - 7, size=8.5, color=pdf.ink)
        pdf.text(f"{total}/{max_score}", pdf.margin + 335, pdf.y - 7, size=8.5, color=pdf.deep_purple, bold=True)
        pdf.text(str(risk), pdf.margin + 420, pdf.y - 7, size=8.5, color=_risk_color(risk), bold=True)
        pdf.y -= 23
    pdf.y -= 10

    # Detailed sections.
    for index, (section_id, _field) in enumerate(_SECTION_REPORT_FIELD.items(), start=1):
        report = reports.get(section_id, {})
        section = report.get("section", {}) if isinstance(report.get("section"), dict) else {}
        score = report.get("score", {}) if isinstance(report.get("score"), dict) else {}
        summaries = report.get("summaries", {}) if isinstance(report.get("summaries"), dict) else {}
        findings = report.get("findings", {}) if isinstance(report.get("findings"), dict) else {}
        answers = report.get("answers") or []

        section_title = section.get("title") or section_id.replace("_", " ").title()
        risk = score.get("riskLevel", "Low")
        risk_color = _risk_color(risk)

        pdf.ensure_space(180)
        pdf.rect(pdf.margin, pdf.y - 42, pdf.width - pdf.margin * 2, 52, fill=pdf.purple)
        pdf.text(f"{index}. {section_title}", pdf.margin + 16, pdf.y - 13, size=13, color=(255, 255, 255), bold=True)
        pdf.text(
            f"Score {score.get('total', '')}/{score.get('max', '')}",
            pdf.margin + 16,
            pdf.y - 31,
            size=9,
            color=pdf.gold_mid,
            bold=True,
        )
        pdf.badge(str(risk), pdf.width - pdf.margin - 92, pdf.y - 29, 72, fill=pdf.gold_light, color=risk_color)
        pdf.y -= 62

        if summaries.get("learner"):
            pdf.section_label("Employee summary")
            pdf.y = pdf.wrapped_text(
                _employee_report_text(summaries.get("learner")),
                pdf.margin,
                pdf.y,
                width_chars=84,
                size=8.8,
                color=pdf.ink,
                leading=13,
            )
            pdf.y -= 10

        if summaries.get("coach"):
            pdf.ensure_space(96)
            box_top = pdf.y + 8
            coach_lines = []
            coach_text = _employee_report_text(summaries.get("coach"))
            for paragraph in coach_text.splitlines() or [""]:
                coach_lines.extend(textwrap.wrap(paragraph, width=78) or [""])
            box_h = min(148, max(68, len(coach_lines[:9]) * 12 + 34))
            pdf.rect(pdf.margin, box_top - box_h, pdf.width - pdf.margin * 2, box_h, fill=pdf.gold_light, stroke=pdf.gold_mid, line_width=0.7)
            pdf.text("Manager notes", pdf.margin + 14, box_top - 18, size=9, color=pdf.gold, bold=True)
            y = box_top - 36
            for line in coach_lines[:9]:
                pdf.text(line, pdf.margin + 14, y, size=8.35, color=pdf.ink)
                y -= 12
            pdf.y = box_top - box_h - 16

        indicators = findings.get("mainIndicators") or []
        adjustments = findings.get("recommendedAdjustments") or []
        actions = findings.get("recommendedActions") or []

        if indicators:
            pdf.section_label("Key indicators", min_following=82)
            pdf.bullet_list([_employee_report_text(item) for item in indicators], pdf.margin, width_chars=78)
            pdf.y -= 8

        if adjustments:
            pdf.section_label("Recommended adjustments", min_following=82)
            pdf.bullet_list([_employee_report_text(item) for item in adjustments], pdf.margin, width_chars=78)
            pdf.y -= 8

        if actions:
            pdf.section_label("Priority actions", min_following=90)
            for action in actions[:5]:
                if not isinstance(action, dict):
                    continue
                owner = _employee_action_owner(action.get("owner", "Owner"))
                due = action.get("due", "")
                action_text = _employee_report_text(action.get("action", ""))
                action_lines = pdf.wrap_lines(action_text, width_chars=74, max_lines=5)
                box_h = max(50, 31 + len(action_lines) * 11)
                pdf.ensure_space(box_h + 10)
                top = pdf.y
                pdf.rect(
                    pdf.margin,
                    top - box_h,
                    pdf.width - pdf.margin * 2,
                    box_h,
                    fill=(248, 248, 250),
                    stroke=(225, 225, 232),
                    line_width=0.5,
                )
                pdf.text(owner, pdf.margin + 12, top - 14, size=8.5, color=pdf.deep_purple, bold=True)
                if due:
                    pdf.text(f"Due: {due}", pdf.width - pdf.margin - 12, top - 14, size=7.3, color=pdf.muted, align="right")
                pdf.draw_lines(action_lines, pdf.margin + 12, top - 31, size=8.05, color=pdf.ink, leading=11)
                pdf.y = top - box_h - 12

        if answers:
            pdf.ensure_space(90)
            pdf.section_label("Answer snapshot", min_following=86)
            for ans in answers[:8]:
                pdf.ensure_space(30)
                q = _employee_report_text(ans.get("question_text") or ans.get("question_id") or "")
                val = ans.get("label") or ans.get("value") or ""
                q_lines = pdf.wrap_lines(q, width_chars=72, max_lines=3)
                row_h = max(28, len(q_lines) * 11 + 9)
                pdf.rect(
                    pdf.margin,
                    pdf.y - row_h + 4,
                    pdf.width - pdf.margin * 2,
                    row_h,
                    fill=(255, 255, 255),
                    stroke=(238, 232, 245),
                    line_width=0.35,
                )
                pdf.text(f"{val}", pdf.margin + 10, pdf.y - 9, size=7.4, color=pdf.gold, bold=True)
                pdf.draw_lines(q_lines, pdf.margin + 68, pdf.y - 9, size=7.65, color=pdf.muted, leading=10.5)
                pdf.y -= row_h + 5
        pdf.y -= 12

    return pdf.finish()


def graph_mail_is_configured():
    return all(
        [
            getattr(settings, "MS_GRAPH_TENANT_ID", ""),
            getattr(settings, "MS_GRAPH_CLIENT_ID", ""),
            getattr(settings, "MS_GRAPH_CLIENT_SECRET", ""),
            getattr(settings, "MS_GRAPH_REFRESH_TOKEN", ""),
            getattr(settings, "MS_GRAPH_SENDER_EMAIL", ""),
        ]
    )


def get_ms_graph_access_token():
    token_url = (
        "https://login.microsoftonline.com/"
        f"{settings.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token"
    )
    response = requests.post(
        token_url,
        data={
            "client_id": settings.MS_GRAPH_CLIENT_ID,
            "client_secret": settings.MS_GRAPH_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": settings.MS_GRAPH_REFRESH_TOKEN,
            "scope": "offline_access User.Read Mail.Send",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError("Microsoft Graph token response did not include an access token.")
    if data.get("refresh_token") and data.get("refresh_token") != settings.MS_GRAPH_REFRESH_TOKEN:
        logger.warning("Microsoft Graph returned a new refresh token. Update MS_GRAPH_REFRESH_TOKEN in .env if sending later fails.")
    return access_token


def send_ms_graph_mail(subject, body, recipient_list, attachments=None, cc_list=None):
    if not graph_mail_is_configured():
        raise RuntimeError("Microsoft Graph mail settings are not configured.")

    access_token = get_ms_graph_access_token()
    sender = settings.MS_GRAPH_SENDER_EMAIL
    send_url = f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail"

    message = {
        "subject": subject,
        "body": {
            "contentType": "Text",
            "content": body,
        },
        "toRecipients": [
            {"emailAddress": {"address": email}}
            for email in recipient_list
        ],
        "from": {
            "emailAddress": {
                "name": settings.MS_GRAPH_FROM_NAME,
                "address": sender,
            }
        },
    }

    if cc_list:
        message["ccRecipients"] = [
            {"emailAddress": {"address": email}}
            for email in cc_list
            if email
        ]

    if attachments:
        message["attachments"] = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": attachment["name"],
                "contentType": attachment["content_type"],
                "contentBytes": base64.b64encode(attachment["content"]).decode("ascii"),
            }
            for attachment in attachments
        ]

    response = requests.post(
        send_url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={
            "message": message,
            "saveToSentItems": True,
        },
        timeout=30,
    )
    response.raise_for_status()
    return True


def _load_onboarding_reports_for_record(record, sections_data=None):
    reports = {}
    try:
        row = LearnerInclusivenessReport.objects.using("wsms").filter(learner_id=record.id).first()
        if row:
            for section_id, field in _SECTION_REPORT_FIELD.items():
                value = getattr(row, field, None)
                if not value:
                    continue
                if isinstance(value, str):
                    try:
                        value = json.loads(value)
                    except (ValueError, TypeError, json.JSONDecodeError):
                        continue
                if isinstance(value, dict):
                    reports[section_id] = value
    except Exception as exc:
        logger.warning("Could not load onboarding reports for learner %s: %s", record.id, exc)

    if sections_data is None:
        try:
            quiz_resp = LearnerInclusivenessQuizResponse.objects.get(learner_id=record.id)
            sections_data = quiz_resp.sections if isinstance(quiz_resp.sections, dict) else {}
        except LearnerInclusivenessQuizResponse.DoesNotExist:
            sections_data = {}

    for section_id, report_data in reports.items():
        raw_answers = sections_data.get(section_id, {}).get("answers", {})
        if not raw_answers:
            continue
        report_data["answers"] = sorted(
            [
                {
                    "question_id": qid,
                    "value": ans.get("value"),
                    "label": ans.get("label"),
                    "question_text": ans.get("question_text", ""),
                }
                for qid, ans in raw_answers.items()
            ],
            key=lambda x: x["question_id"],
        )

    return reports


def _build_onboarding_report_lines(record, reports):
    lines = [
        "Kent Business College - Employee Inclusiveness Report",
        "",
        f"Employee: {record.learner_name or ''}",
        f"Email: {record.learner_email or ''}",
        f"Generated: {timezone.now().strftime('%d %b %Y %H:%M')}",
        "",
    ]

    for section_id, _field in _SECTION_REPORT_FIELD.items():
        report = reports.get(section_id, {})
        section = report.get("section", {}) if isinstance(report.get("section"), dict) else {}
        score = report.get("score", {}) if isinstance(report.get("score"), dict) else {}
        summaries = report.get("summaries", {}) if isinstance(report.get("summaries"), dict) else {}
        findings = report.get("findings", {}) if isinstance(report.get("findings"), dict) else {}

        title = section.get("title") or section_id.replace("_", " ").title()
        lines.extend([
            "=" * 78,
            title,
            f"Score: {score.get('total', '')}/{score.get('max', '')} | Risk: {score.get('riskLevel', '')}",
            "",
        ])

        if summaries.get("learner"):
            lines.extend(["Employee summary:", _employee_report_text(summaries.get("learner")), ""])
        if summaries.get("coach"):
            lines.extend(["Manager summary:", _employee_report_text(summaries.get("coach")), ""])

        indicators = findings.get("mainIndicators") or []
        if indicators:
            lines.append("Main indicators:")
            lines.extend(f"- {_employee_report_text(item)}" for item in indicators)
            lines.append("")

        adjustments = findings.get("recommendedAdjustments") or []
        if adjustments:
            lines.append("Recommended adjustments:")
            lines.extend(f"- {_employee_report_text(item)}" for item in adjustments)
            lines.append("")

        actions = findings.get("recommendedActions") or []
        if actions:
            lines.append("Recommended actions:")
            for action in actions:
                if isinstance(action, dict):
                    lines.append(
                        f"- {_employee_action_owner(action.get('owner', ''))}: "
                        f"{_employee_report_text(action.get('action', ''))} "
                        f"({action.get('priority', '')}, {action.get('due', '')})"
                    )
            lines.append("")

        answers = report.get("answers") or []
        if answers:
            lines.append("Answers:")
            for ans in answers:
                lines.append(
                    f"- {_employee_report_text(ans.get('question_text', ans.get('question_id', '')))}: "
                    f"{ans.get('label', ans.get('value', ''))}"
                )
            lines.append("")

    return lines


def maybe_send_onboarding_report_email(record, response_obj):
    if response_obj.report_emailed_at:
        return False

    if not AdminAccount.objects.filter(email__iexact=record.learner_email, is_active=True).exists():
        return False

    sections = response_obj.sections if isinstance(response_obj.sections, dict) else {}
    required_sections = set(_SECTION_REPORT_FIELD.keys())
    if not required_sections.issubset(set(sections.keys())):
        return False

    reports = _load_onboarding_reports_for_record(record, sections)
    if not required_sections.issubset(set(reports.keys())):
        return False

    recipient = getattr(settings, "ONBOARDING_REPORT_RECIPIENT", "").strip()
    if not recipient:
        logger.warning("ONBOARDING_REPORT_RECIPIENT is not configured.")
        return False
    cc_recipient = (record.learner_email or "").strip()
    cc_list = [cc_recipient] if cc_recipient and cc_recipient.lower() != recipient.lower() else None

    title = f"Inclusiveness report - {record.learner_name or record.learner_email or record.id}"
    pdf_bytes = _build_designed_onboarding_pdf(record, reports)
    filename_base = re.sub(r"[^a-z0-9]+", "_", (record.learner_name or record.learner_email or str(record.id)).lower()).strip("_")
    filename = f"{filename_base or 'employee'}_inclusiveness_report.pdf"

    body = (
        "The employee has completed all six inclusiveness questionnaires. "
        "The generated PDF report is attached.\n\n"
        f"Employee: {record.learner_name or ''}\n"
        f"Email: {record.learner_email or ''}\n"
    )

    if graph_mail_is_configured():
        send_ms_graph_mail(
            subject=title,
            body=body,
            recipient_list=[recipient],
            cc_list=cc_list,
            attachments=[
                {
                    "name": filename,
                    "content_type": "application/pdf",
                    "content": pdf_bytes,
                }
            ],
        )
    else:
        email = EmailMessage(
            subject=title,
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient],
            cc=cc_list,
        )
        email.attach(filename, pdf_bytes, "application/pdf")
        email.send(fail_silently=False)

    response_obj.report_emailed_at = timezone.now()
    response_obj.save(update_fields=["report_emailed_at", "updated_at"])
    return True


_ALLOWED_EVIDENCE_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_MAX_EVIDENCE_SIZE = 10 * 1024 * 1024   # 10 MB
_MAX_EVIDENCE_FILES = 5


@api_view(["POST"])
def create_ticket_view(request):
    record = get_record_from_request(request)

    # support both multipart/form-data (with files) and application/json
    data = request.POST if request.FILES else request.data

    ticket_type = normalize_text(data.get("ticket_type", ""))
    full_name = (record.learner_name or (data.get("full_name") or "")).strip()
    email = (record.learner_email or (data.get("email") or "")).strip()
    subject = (data.get("subject") or "").strip()
    details = (data.get("details") or "").strip()
    urgency = normalize_text(data.get("urgency", "medium"))
    preferred_contact = normalize_text(data.get("preferred_contact", "email"))

    if ticket_type not in {"wellbeing", "safeguarding"}:
        return Response(
            {"detail": "ticket_type must be wellbeing or safeguarding."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not full_name:
        return Response(
            {"detail": "Full name is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not email:
        return Response(
            {"detail": "Email is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not subject:
        return Response(
            {"detail": "Subject is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not details:
        return Response(
            {"detail": "Details are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if urgency not in {"low", "medium", "high", "critical"}:
        urgency = "medium"

    if preferred_contact not in {"email", "phone", "teams"}:
        preferred_contact = "email"

    ticket = SupportTicket.objects.create(
        wellbeing_record_id=record.id,
        ticket_type=ticket_type,
        created_by="learner",
        full_name=full_name,
        email=email,
        subject=subject,
        details=details,
        urgency=urgency,
        preferred_contact=preferred_contact,
        status="open",
    )

    # handle evidence file uploads
    uploaded_files = request.FILES.getlist("evidence")[:_MAX_EVIDENCE_FILES]
    evidence_list = []
    for f in uploaded_files:
        if f.content_type not in _ALLOWED_EVIDENCE_TYPES:
            continue
        if f.size > _MAX_EVIDENCE_SIZE:
            continue
        ext = os.path.splitext(f.name)[1].lower() or ""
        safe_name = f"{uuid.uuid4().hex}{ext}"
        rel_dir = os.path.join("tickets", str(ticket.id))
        abs_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
        os.makedirs(abs_dir, exist_ok=True)
        abs_path = os.path.join(abs_dir, safe_name)
        with open(abs_path, "wb") as dest:
            for chunk in f.chunks():
                dest.write(chunk)
        evidence_list.append({
            "uploaded_by": "learner",
            "original_name": f.name,
            "filename": safe_name,
            "url": f"{settings.MEDIA_URL}{rel_dir}/{safe_name}",
            "size": f.size,
            "mime_type": f.content_type,
        })

    if evidence_list:
        ticket.evidence = evidence_list
        ticket.save(update_fields=["evidence"])

    return Response(
        {
            "message": "Ticket submitted successfully.",
            "ticket_id": ticket.id,
            "ticket_type": ticket.ticket_type,
            "status": ticket.status,
            "evidence_count": len(evidence_list),
        },
        status=status.HTTP_201_CREATED,
    )


# ── Tasks-API: file upload (API key protected, no learner token needed) ──────

@api_view(["POST"])
def upload_ticket_evidence_view(request, ticket_id: int):
    """
    POST /tasks-api/tickets/<ticket_id>/upload-file/
    Header: X-API-Key: <TASKS_API_KEY>
    Body:   multipart/form-data  field name = "file" (single file)
            optional field "uploaded_by" (default "learner")

    Appends one file to the ticket's evidence JSON column.
    """
    # ── auth ──
    expected_key = getattr(settings, "TASKS_API_KEY", "")
    if not expected_key:
        return Response({"detail": "Tasks API key not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    provided_key = request.headers.get("X-API-Key", "")
    if not provided_key or provided_key != expected_key:
        return Response({"detail": "Invalid or missing API key."}, status=status.HTTP_403_FORBIDDEN)

    # ── ticket lookup ──
    try:
        ticket = SupportTicket.objects.get(pk=ticket_id)
    except SupportTicket.DoesNotExist:
        return Response({"detail": "Ticket not found."}, status=status.HTTP_404_NOT_FOUND)

    # ── file validation ──
    f = request.FILES.get("file")
    if not f:
        return Response({"detail": "No file provided. Use field name 'file'."}, status=status.HTTP_400_BAD_REQUEST)

    if f.content_type not in _ALLOWED_EVIDENCE_TYPES:
        return Response(
            {"detail": f"File type '{f.content_type}' is not allowed."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if f.size > _MAX_EVIDENCE_SIZE:
        return Response(
            {"detail": f"File exceeds the 10 MB limit ({f.size / 1024 / 1024:.1f} MB)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── save file ──
    ext = os.path.splitext(f.name)[1].lower() or ""
    safe_name = f"{uuid.uuid4().hex}{ext}"
    rel_dir = os.path.join("tickets", str(ticket.id))
    abs_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, safe_name)
    with open(abs_path, "wb") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    uploaded_by = (request.POST.get("uploaded_by") or "learner").strip()
    new_entry = {
        "uploaded_by": uploaded_by,
        "original_name": f.name,
        "filename": safe_name,
        "url": f"{settings.MEDIA_URL}{rel_dir}/{safe_name}",
        "size": f.size,
        "mime_type": f.content_type,
    }

    # ── append to evidence column ──
    current = ticket.evidence or []
    current.append(new_entry)
    ticket.evidence = current
    ticket.save(update_fields=["evidence"])

    return Response(
        {
            "message": "File uploaded successfully.",
            "ticket_id": ticket.id,
            "url": new_entry["url"],
            "original_name": new_entry["original_name"],
            "uploaded_by": new_entry["uploaded_by"],
        },
        status=status.HTTP_201_CREATED,
    )


# ── Onboarding (Initial Inclusiveness Screening) ─────────────────────────────

ONBOARDING_WEBHOOKS = {
    "technology_anxiety_digital_access": "https://n8n.srv943390.hstgr.cloud/webhook/Technology_anxiety",
    "visual_hearing_accessibility": "https://n8n.srv943390.hstgr.cloud/webhook/visual_and_hearing_impairments",
    "dyslexia": "https://n8n.srv943390.hstgr.cloud/webhook/Dyslixia",
    "adhd": "https://n8n.srv943390.hstgr.cloud/webhook/ADHD",
    "social_anxiety": "https://n8n.srv943390.hstgr.cloud/webhook/Social_Anxiety",
    "mood_learning_capacity": "https://n8n.srv943390.hstgr.cloud/webhook/Depression",
}


@api_view(["POST"])
def onboarding_submit_view(request, section_id: str):
    record = get_record_from_request(request)

    raw_answers = request.data.get("answers", {})

    questions = (
        LearnerInclusivenessQuestion.objects
        .filter(is_active=True, section_id=section_id)
        .order_by("question_order")
    )

    if not questions.exists():
        return Response(
            {"detail": f"Section '{section_id}' not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    first = questions.first()
    answer_rows = []
    for q in questions:
        selected_value = raw_answers.get(str(q.id))
        selected_label = scale_label_for_value(selected_value) if selected_value is not None else None

        answer_rows.append({
            "question_id": q.question_id,
            "question_order": q.question_order,
            "sub_section": q.sub_section or "",
            "question_text": q.question_text,
            "selected_value": selected_value,
            "selected_label": selected_label,
            "score_min": 1,
            "score_max": 10,
            "answer_type": "scale_1_to_10",
            "required": q.required,
        })

    # ── Persist answers to DB (one row per learner, UPSERT) ──────────────
    report_id = uuid.uuid4()
    answered_rows = [r for r in answer_rows if r["selected_value"] is not None]

    section_data = {
        "section_title": first.section_title,
        "submitted_at": timezone.now().isoformat(),
        "answers": {
            r["question_id"]: {
                "value": r["selected_value"],
                "label": r["selected_label"],
                "question_text": r["question_text"],
            }
            for r in answered_rows
        },
    }

    response_obj, _ = LearnerInclusivenessQuizResponse.objects.get_or_create(
        learner_id=record.id,
        defaults={
            "learner_name": record.learner_name or "",
            "learner_email": record.learner_email or "",
            "sections": {},
        },
    )
    response_obj.sections[section_id] = section_data
    response_obj.learner_name = record.learner_name or ""
    response_obj.learner_email = record.learner_email or ""
    response_obj.save(update_fields=["sections", "learner_name", "learner_email", "updated_at"])

    try:
        maybe_send_onboarding_report_email(record, response_obj)
    except Exception as exc:
        logger.warning("Onboarding completion report email failed for learner %s: %s", record.id, exc)

    # ── Fire webhook ──────────────────────────────────────────────────────
    webhook_url = ONBOARDING_WEBHOOKS.get(section_id)
    if webhook_url:
        payload = {
            "report_id": str(report_id),
            "learner_id": record.id,
            "learner_name": record.learner_name or "",
            "learner_email": record.learner_email or "",
            "programme": record.programme or "",
            "manager_name": record.manager_name or "",
            "manager_email": record.manager_email or "",
            "coach_name": record.coach_name or "",
            "coach_email": record.coach_email or "",
            "organization_name": record.organization_name or "",
            "section_id": section_id,
            "section_title": first.section_title,
            "submitted_at": timezone.now().isoformat(),
            "answers": answer_rows,
        }
        try:
            requests.post(webhook_url, json=payload, timeout=10)
        except Exception as exc:
            logger.warning("Onboarding webhook failed for %s: %s", section_id, exc)

    return Response({"message": "Section submitted successfully.", "report_id": str(report_id)})


@api_view(["GET"])
def onboarding_progress_view(request):
    record = get_record_from_request(request)
    try:
        resp = LearnerInclusivenessQuizResponse.objects.get(learner_id=record.id)
        completed = list(resp.sections.keys())
    except LearnerInclusivenessQuizResponse.DoesNotExist:
        completed = []
    return Response({"completed_sections": completed})


# map section_id → model field name
_SECTION_REPORT_FIELD = {
    "technology_anxiety_digital_access": "technology_report",
    "visual_hearing_accessibility":      "visual_hearing_report",
    "dyslexia":                          "dyslexia_report",
    "adhd":                              "adhd_report",
    "social_anxiety":                    "social_anxiety_report",
    "mood_learning_capacity":            "mood_report",
}


@api_view(["GET"])
def onboarding_reports_view(request):
    record = get_record_from_request(request)

    # ── Load AI reports from wsms DB (single source of truth) ────────────
    reports = {}
    try:
        row = LearnerInclusivenessReport.objects.using("wsms").filter(learner_id=record.id).first()
        if row:
            for section_id, field in _SECTION_REPORT_FIELD.items():
                value = getattr(row, field, None)
                if not value:
                    continue
                if isinstance(value, str):
                    try:
                        value = json.loads(value)
                    except (ValueError, TypeError):
                        continue
                if isinstance(value, dict):
                    reports[section_id] = value
    except Exception as exc:
        logger.warning("onboarding_reports_view error for learner %s: %s", record.id, exc)

    # ── Inject answers from quiz response into each ready report ──────────
    try:
        quiz_resp = LearnerInclusivenessQuizResponse.objects.get(learner_id=record.id)
        sections_data = quiz_resp.sections if isinstance(quiz_resp.sections, dict) else {}
    except LearnerInclusivenessQuizResponse.DoesNotExist:
        sections_data = {}
    except Exception as exc:
        logger.warning("onboarding_reports_view answers error for learner %s: %s", record.id, exc)
        sections_data = {}

    for section_id, report_data in reports.items():
        raw_answers = sections_data.get(section_id, {}).get("answers", {})
        if not raw_answers:
            continue
        report_data["answers"] = sorted(
            [
                {
                    "question_id": qid,
                    "value": ans.get("value"),
                    "label": ans.get("label"),
                    "question_text": ans.get("question_text", ""),
                }
                for qid, ans in raw_answers.items()
            ],
            key=lambda x: x["question_id"],
        )

    if "quiz_resp" in locals():
        try:
            maybe_send_onboarding_report_email(record, quiz_resp)
        except Exception as exc:
            logger.warning("Onboarding report email failed while loading reports for learner %s: %s", record.id, exc)

    return Response({"reports": reports})


@api_view(["GET"])
def onboarding_sections_view(request):
    get_record_from_request(request)

    rows = (
        LearnerInclusivenessQuestion.objects
        .filter(is_active=True)
        .values("section_id", "section_title", "section_order")
        .distinct()
        .order_by("section_order")
    )

    seen = {}
    for row in rows:
        sid = row["section_id"]
        if sid not in seen:
            seen[sid] = {
                "section_id": sid,
                "section_title": row["section_title"],
                "section_order": row["section_order"],
            }

    counts = (
        LearnerInclusivenessQuestion.objects
        .filter(is_active=True)
        .values("section_id")
        .annotate(question_count=models.Count("id"))
    )
    count_map = {r["section_id"]: r["question_count"] for r in counts}

    sections = [
        {**s, "question_count": count_map.get(sid, 0)}
        for sid, s in seen.items()
    ]

    return Response({"sections": sections})


@api_view(["GET"])
def onboarding_questions_view(request, section_id: str):
    get_record_from_request(request)

    questions = (
        LearnerInclusivenessQuestion.objects
        .filter(is_active=True, section_id=section_id)
        .order_by("question_order")
    )

    if not questions.exists():
        return Response(
            {"detail": f"Section '{section_id}' not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    first = questions.first()
    return Response({
        "section_id": section_id,
        "section_title": first.section_title,
        "section_order": first.section_order,
        "questions": [
            {
                "id": q.id,
                "question_id": q.question_id,
                "question_order": q.question_order,
                "sub_section": q.sub_section or "",
                "question_text": q.question_text,
                "answer_type": q.answer_type,
                "required": q.required,
                "options": q.options or [],
                "score_min": q.score_min,
                "score_max": q.score_max,
            }
            for q in questions
        ],
    })
