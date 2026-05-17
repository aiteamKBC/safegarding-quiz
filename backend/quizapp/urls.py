from django.urls import path
from .views import (
    login_view,
    instructions_view,
    start_quiz_view,
    questions_view,
    submit_quiz_view,
    result_view,
    send_result_to_employer_view,
    notify_employer_view,
    automation_dashboard_view,
    create_ticket_view,
    onboarding_sections_view,
    onboarding_questions_view,
    onboarding_submit_view,
)

urlpatterns = [
    path("auth/login/", login_view),
    path("quiz/instructions/", instructions_view),
    path("quiz/start/", start_quiz_view),
    path("quiz/questions/", questions_view),
    path("quiz/submit/", submit_quiz_view),
    path("quiz/results/<int:attempt_id>/", result_view),
    path("quiz/results/<int:attempt_id>/send-to-employer/", send_result_to_employer_view),
    path("quiz/results/<int:attempt_id>/notify-employer/", notify_employer_view),
    path("quiz/results/<int:attempt_id>/automation-dashboard/", automation_dashboard_view),
    path("tickets/create/", create_ticket_view),
    path("onboarding/sections/", onboarding_sections_view),
    path("onboarding/sections/<str:section_id>/questions/", onboarding_questions_view),
    path("onboarding/sections/<str:section_id>/submit/", onboarding_submit_view),
]