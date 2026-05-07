from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0002_monitoringrecord_safeguardingquestion_and_more"),
    ]

    operations = [
        # MonitoringRecord is managed=False — run this SQL on the wsms (NeonDB) database:
        #   ALTER TABLE wellbeing_safeguarding_monitoring_system
        #     ADD COLUMN IF NOT EXISTS triggered_questions jsonb NULL;
        migrations.AddField(
            model_name="monitoringrecord",
            name="triggered_questions",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
