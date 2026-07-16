from django.core import signing
from rest_framework.exceptions import AuthenticationFailed
from .models import AdminAccount, MonitoringRecord

TOKEN_SALT = "wellbeing-login"
ADMIN_TOKEN_SALT = "wellbeing-admin-login"


def create_login_token(record: MonitoringRecord) -> str:
    return signing.dumps(
        {"record_id": record.id, "email": record.learner_email},
        salt=TOKEN_SALT,
    )


def create_admin_token(admin: AdminAccount) -> str:
    return signing.dumps(
        {"type": "admin", "admin_id": admin.id, "email": admin.email},
        salt=ADMIN_TOKEN_SALT,
    )


def get_record_from_request(request) -> MonitoringRecord:
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        raise AuthenticationFailed("Authentication required.")

    token = auth_header.split(" ", 1)[1]

    try:
        data = signing.loads(token, salt=TOKEN_SALT, max_age=60 * 60 * 8)
    except signing.SignatureExpired:
        raise AuthenticationFailed("Session expired.")
    except signing.BadSignature:
        raise AuthenticationFailed("Invalid token.")

    record = MonitoringRecord.objects.using("wsms").filter(
    id=data.get("record_id"),
    learner_email__iexact=data.get("email"),
).first()

    if not record:
        raise AuthenticationFailed("Learner record not found.")

    return record


def get_admin_from_request(request):
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        raise AuthenticationFailed("Admin authentication required.")

    token = auth_header.split(" ", 1)[1]

    try:
        data = signing.loads(token, salt=ADMIN_TOKEN_SALT, max_age=60 * 60 * 8)
    except signing.SignatureExpired:
        raise AuthenticationFailed("Admin session expired.")
    except signing.BadSignature:
        raise AuthenticationFailed("Invalid admin token.")

    if data.get("type") != "admin":
        raise AuthenticationFailed("Invalid admin token.")

    admin = AdminAccount.objects.filter(
        id=data.get("admin_id"),
        email__iexact=data.get("email"),
        is_active=True,
    ).first()

    if not admin:
        raise AuthenticationFailed("Admin account not found.")

    return admin
