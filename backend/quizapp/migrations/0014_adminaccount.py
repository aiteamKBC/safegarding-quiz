from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0013_fix_report_fields_textfield"),
    ]

    operations = [
        migrations.CreateModel(
            name="AdminAccount",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("email", models.EmailField(max_length=254, unique=True)),
                ("full_name", models.TextField(blank=True, null=True)),
                ("password_hash", models.TextField()),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "admin_accounts",
                "ordering": ["email"],
            },
        ),
    ]
