from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0006_rename_submitted_by_to_created_by"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportticket",
            name="source",
            field=models.TextField(blank=True, null=True),
        ),
    ]
