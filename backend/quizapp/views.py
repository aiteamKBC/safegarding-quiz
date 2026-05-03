import json
import logging
import re

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .auth import create_login_token, get_record_from_request
from .models import (
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

GROUP_WEIGHTS = {
    "mental": 0.40,
    "protective": 0.20,
    "provider": 0.20,
    "safeguarding": 0.20,
}


def normalize_text(value):
    return str(value).strip().lower()


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

    # is_reverse_scored=TRUE  → positive question  → keep score as-is
    # is_reverse_scored=FALSE → negative question  → flip score
    if not question.is_reverse_scored:
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

        if score_group == "safeguarding":
            normalized_score = row.get("normalized_score")
            if normalized_score is not None:
                # Binary: normalized ≤ 8 = high risk (1), normalized 9-10 = low risk (10)
                grouped["safeguarding"].append(1.0 if normalized_score <= 8 else 10.0)
        elif score_group in grouped:
            normalized_score = row.get("normalized_score")
            if normalized_score is not None:
                grouped[score_group].append(normalized_score)

    averages = {}
    for group_name, values in grouped.items():
        if not values:
            averages[group_name] = 0.0
        elif group_name == "safeguarding":
            # If any answer was 1-8 → whole safeguarding score = 1 (High risk, no medium)
            # Only if ALL answers were 9-10 → score = 10 (Low risk)
            averages[group_name] = 10.0 if all(v == 10.0 for v in values) else 1.0
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
        return "Low"
    if overall_score >= 5:
        return "Medium"
    return "High"


def detect_triggers(answer_rows, group_scores):
    high = []
    medium = []
    pattern = []

    # Safeguarding questions: normalized ≤ 8 = high risk (trigger), normalized 9-10 = safe
    # Uses normalized_score so is_reverse_scored is respected (negative questions are handled correctly)
    seen_keys = set()
    for row in answer_rows:
        if row.get("score_group") != "safeguarding":
            continue
        normalized = row.get("normalized_score")
        if normalized is None:
            continue
        if normalized <= 8:
            key = row.get("question_code") or f"safeguarding_{row.get('question_id', 'unknown')}"
            if key not in seen_keys:
                seen_keys.add(key)
                high.append({
                    "question_code": key,
                    "question_text": row.get("question_text", ""),
                    "question_id": row.get("question_id"),
                    "trigger_note": row.get("trigger_note", ""),
                    "normalized_score": normalized,
                })

    for row in answer_rows:
        code = row.get("question_code")
        score = row.get("normalized_score")

        if score is None:
            continue

        if code in {
            "i_feel_anxious_or_worried_most_of_the_time",
            "i_struggle_to_control_my_worries",
            "my_anxiety_affects_my_ability_to_focus_or_perform",
        } and score <= 3:
            if "anxiety_high" not in medium:
                medium.append("anxiety_high")

        if code == "i_feel_low_or_down" and score <= 3:
            if "low_mood" not in medium:
                medium.append("low_mood")

        if code in {
            "i_struggle_to_get_good_quality_sleep",
            "i_feel_tired_or_exhausted_most_days",
        } and score <= 3:
            if "sleep_problems" not in medium:
                medium.append("sleep_problems")

        if code == "i_feel_lonely_or_isolated" and score <= 3:
            if "loneliness" not in medium:
                medium.append("loneliness")

        if code == "i_am_considering_leaving_my_apprenticeship_programme" and score <= 4:
            if "considering_leaving" not in medium:
                medium.append("considering_leaving")

    below_5_count = sum(
        1 for v in group_scores.values()
        if isinstance(v, (int, float)) and v < 5
    )

    if below_5_count >= 3:
        pattern.append("three_categories_below_5")

    if group_scores.get("protective", 0) < 5:
        pattern.append("protective_below_5")

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
            "next_route": (
                f"/results/{record.id}" if has_completed_quiz else "/instructions"
            ),
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
                "is_reverse_scored": question.is_reverse_scored,
                "is_trigger": question.is_trigger,
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
            "risk_level",
            "submitted_at",
            "completed",
        ],
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


@api_view(["POST"])
def create_ticket_view(request):
    record = get_record_from_request(request)

    ticket_type = normalize_text(request.data.get("ticket_type", ""))
    full_name = (request.data.get("full_name") or "").strip()
    email = (request.data.get("email") or "").strip()
    subject = (request.data.get("subject") or "").strip()
    details = (request.data.get("details") or "").strip()
    urgency = normalize_text(request.data.get("urgency", "medium"))
    preferred_contact = normalize_text(
        request.data.get("preferred_contact", "email")
    )

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
        full_name=full_name,
        email=email,
        subject=subject,
        details=details,
        urgency=urgency,
        preferred_contact=preferred_contact,
        status="open",
    )

    if ticket_type == "safeguarding":
        try:
            send_mail(
                subject=f"New Safeguarding Ticket: {subject}",
                message=(
                    f"Ticket ID: {ticket.id}\n"
                    f"Type: {ticket_type}\n"
                    f"Name: {full_name}\n"
                    f"Email: {email}\n"
                    f"Urgency: {urgency}\n"
                    f"Preferred Contact: {preferred_contact}\n\n"
                    f"Details:\n{details}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=["safeguarding@kbc.ac.uk"],
                fail_silently=True,
            )
        except Exception:
            logger.exception(
                "Failed to send safeguarding ticket email for ticket %s",
                ticket.id,
            )

    if ticket_type == "wellbeing":
        try:
            send_mail(
                subject=f"New Wellbeing Ticket: {subject}",
                message=(
                    f"Ticket ID: {ticket.id}\n"
                    f"Type: {ticket_type}\n"
                    f"Name: {full_name}\n"
                    f"Email: {email}\n"
                    f"Urgency: {urgency}\n"
                    f"Preferred Contact: {preferred_contact}\n\n"
                    f"Details:\n{details}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=["wellbeing@kbc.ac.uk"],
                fail_silently=True,
            )
        except Exception:
            logger.exception(
                "Failed to send wellbeing ticket email for ticket %s",
                ticket.id,
            )

    return Response(
        {
            "message": "Ticket submitted successfully.",
            "ticket_id": ticket.id,
            "ticket_type": ticket.ticket_type,
            "status": ticket.status,
        },
        status=status.HTTP_201_CREATED,
    )