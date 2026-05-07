from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0003_monitoringrecord_triggered_questions"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportticket",
            name="submitted_by",
            field=models.TextField(default="learner"),
        ),
    ]
