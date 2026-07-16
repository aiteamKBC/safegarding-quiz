from django.core.management.base import BaseCommand
from django.utils.crypto import get_random_string

from quizapp.models import AdminAccount, MonitoringRecord


class Command(BaseCommand):
    help = "Create standalone admin accounts for KBC coach emails and print temporary passwords."

    def add_arguments(self, parser):
        parser.add_argument(
            "--domain",
            default="kentbusinesscollege.com",
            help="Allowed admin email domain.",
        )
        parser.add_argument(
            "--include-managers",
            action="store_true",
            help="Also include manager_email values from monitoring records.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show matching emails without changing users or passwords.",
        )
        parser.add_argument(
            "--reset-existing",
            action="store_true",
            help="Reset passwords for existing admin_accounts rows.",
        )

    def handle(self, *args, **options):
        domain = options["domain"].strip().lower().lstrip("@")
        dry_run = options["dry_run"]
        include_managers = options["include_managers"]
        reset_existing = options["reset_existing"]

        emails = set()
        record_fields = ["coach_email"]
        if include_managers:
            record_fields.append("manager_email")

        for field in record_fields:
            values = (
                MonitoringRecord.objects.using("wsms")
                .exclude(**{f"{field}__isnull": True})
                .exclude(**{field: ""})
                .values_list(field, flat=True)
                .distinct()
            )
            emails.update(self._normalise_email(value, domain) for value in values)

        emails.discard(None)

        existing_admins = AdminAccount.objects.filter(email__iendswith=f"@{domain}").values_list(
            "email",
            flat=True,
        )
        emails.update(self._normalise_email(value, domain) for value in existing_admins)
        emails.discard(None)

        if not emails:
            self.stdout.write(self.style.WARNING(f"No emails found for @{domain}."))
            return

        self.stdout.write("email,password,status")

        for email in sorted(emails):
            if dry_run:
                self.stdout.write(f"{email},,dry-run")
                continue

            account = AdminAccount.objects.filter(email__iexact=email).first()
            created = False

            if not account:
                account = AdminAccount(email=email)
                created = True
            elif not reset_existing:
                self.stdout.write(f"{email},,exists")
                continue

            password = get_random_string(14)
            account.set_password(password)
            account.is_active = True
            account.save()

            status = "created" if created else "updated"
            self.stdout.write(f"{email},{password},{status}")

    @staticmethod
    def _normalise_email(value, domain):
        email = str(value or "").strip().lower()
        if not email or not email.endswith(f"@{domain}"):
            return None
        return email
