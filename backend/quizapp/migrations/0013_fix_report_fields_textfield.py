from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0012_learnerinclusivenessreport"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="technology_report",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="visual_hearing_report",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="dyslexia_report",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="adhd_report",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="social_anxiety_report",
                    field=models.TextField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="learnerinclusivenessreport",
                    name="mood_report",
                    field=models.TextField(blank=True, null=True, db_column="mood_learning_capacity_report"),
                ),
            ],
        )
    ]
