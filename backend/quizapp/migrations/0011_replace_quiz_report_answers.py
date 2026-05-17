from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0010_supportticket_evidence"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="LearnerInclusivenessQuizResponse",
                    fields=[
                        ("id", models.BigAutoField(primary_key=True, serialize=False)),
                        ("learner_id", models.BigIntegerField(unique=True)),
                        ("learner_name", models.TextField(blank=True, null=True)),
                        ("learner_email", models.TextField(blank=True, null=True)),
                        ("sections", models.JSONField(default=dict)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                    ],
                    options={"managed": False, "db_table": "learner_inclusiveness_quiz_responses"},
                ),
            ],
        )
    ]
