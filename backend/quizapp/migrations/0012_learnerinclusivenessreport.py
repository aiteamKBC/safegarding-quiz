from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0011_replace_quiz_report_answers"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="LearnerInclusivenessReport",
                    fields=[
                        ("id", models.BigAutoField(primary_key=True, serialize=False)),
                        ("learner_id", models.BigIntegerField(unique=True)),
                        ("learner_name", models.TextField(blank=True, null=True)),
                        ("learner_email", models.TextField(blank=True, null=True)),
                        ("technology_report", models.JSONField(blank=True, null=True)),
                        ("visual_hearing_report", models.JSONField(blank=True, null=True)),
                        ("dyslexia_report", models.JSONField(blank=True, null=True)),
                        ("adhd_report", models.JSONField(blank=True, null=True)),
                        ("social_anxiety_report", models.JSONField(blank=True, null=True)),
                        ("mood_report", models.JSONField(blank=True, null=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                    ],
                    options={"managed": False, "db_table": "learner_inclusiveness_reports"},
                ),
            ],
        )
    ]
