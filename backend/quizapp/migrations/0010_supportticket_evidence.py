from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0009_remove_supportticket_source"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="supportticket",
                    name="evidence",
                    field=models.JSONField(blank=True, null=True),
                ),
            ],
        )
    ]
