from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0014_adminaccount"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE learner_inclusiveness_quiz_responses "
                        "ADD COLUMN IF NOT EXISTS report_emailed_at timestamp with time zone NULL;"
                    ),
                    reverse_sql=(
                        "ALTER TABLE learner_inclusiveness_quiz_responses "
                        "DROP COLUMN IF EXISTS report_emailed_at;"
                    ),
                )
            ],
            state_operations=[
                migrations.AddField(
                    model_name="learnerinclusivenessquizresponse",
                    name="report_emailed_at",
                    field=models.DateTimeField(blank=True, null=True),
                ),
            ],
        )
    ]
