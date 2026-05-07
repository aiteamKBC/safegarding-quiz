from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0004_supportticket_submitted_by"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportticket",
            name="risk_level",
            field=models.TextField(blank=True, null=True),
        ),
    ]
