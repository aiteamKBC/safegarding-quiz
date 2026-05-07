from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("quizapp", "0005_supportticket_risk_level"),
    ]

    operations = [
        # created_by already exists in the DB — just drop submitted_by
        migrations.RunSQL(
            sql="ALTER TABLE support_tickets DROP COLUMN IF EXISTS submitted_by;",
            reverse_sql="ALTER TABLE support_tickets ADD COLUMN submitted_by text NOT NULL DEFAULT 'learner';",
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameField(
                    model_name="supportticket",
                    old_name="submitted_by",
                    new_name="created_by",
                ),
            ],
            database_operations=[],
        ),
    ]
