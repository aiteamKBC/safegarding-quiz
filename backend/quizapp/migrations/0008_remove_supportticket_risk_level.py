from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0007_supportticket_source"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="supportticket",
            name="risk_level",
        ),
    ]
