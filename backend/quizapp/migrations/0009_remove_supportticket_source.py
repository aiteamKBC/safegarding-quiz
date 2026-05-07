from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0008_remove_supportticket_risk_level"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="supportticket",
            name="source",
        ),
    ]
