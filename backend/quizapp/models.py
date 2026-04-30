from django.db import models


class SafeguardingQuestion(models.Model):
    id = models.BigAutoField(primary_key=True)
    category_no = models.SmallIntegerField()
    category_name = models.TextField()
    question_order = models.IntegerField()
    construct_type = models.TextField()
    question_text = models.TextField()
    scale_prompt = models.TextField(blank=True, null=True)
    min_score = models.SmallIntegerField()
    max_score = models.SmallIntegerField()
    is_trigger = models.BooleanField()
    trigger_rule = models.TextField(blank=True, null=True)
    is_reverse_scored = models.BooleanField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    score_group = models.TextField(blank=True, null=True)
    question_code = models.TextField(blank=True, null=True)
    is_core = models.BooleanField(default=True)
    rotation_cycle = models.IntegerField(blank=True, null=True)
    trigger_key = models.TextField(blank=True, null=True)
    trigger_priority = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "safeguarding_questions"
        unique_together = (("category_no", "question_order"),)

    def __str__(self):
        return f"{self.category_no}.{self.question_order} - {self.question_text[:60]}"


class MonitoringRecord(models.Model):
    id = models.BigAutoField(primary_key=True)
    learner_name = models.TextField(blank=True, null=True)
    learner_email = models.TextField(blank=True, null=True)
    learner_phone = models.TextField(blank=True, null=True)
    learner_address = models.TextField(blank=True, null=True)
    programme = models.TextField(blank=True, null=True)
    manager_name = models.TextField(blank=True, null=True)
    manager_email = models.TextField(blank=True, null=True)
    coach_name = models.TextField(blank=True, null=True)
    coach_email = models.TextField(blank=True, null=True)
    coach_phone = models.TextField(blank=True, null=True, db_column="Coach_Phone")
    organization_name = models.TextField(blank=True, null=True, db_column="OrganizationName")

    submission_json = models.JSONField(blank=True, null=True)
    total_score = models.FloatField(blank=True, null=True)
    category_1_score = models.FloatField(blank=True, null=True, db_column="personal_wellbeing_protective_factors_score")
    category_2_score = models.FloatField(blank=True, null=True, db_column="emotional_stress_resilience_score")
    category_3_score = models.FloatField(blank=True, null=True, db_column="provider_culture_support_score")
    category_4_score = models.FloatField(blank=True, null=True, db_column="safeguarding_vulnerability_score")
    trigger_count = models.IntegerField(blank=True, null=True, default=0)
    risk_level = models.TextField(blank=True, null=True)
    submitted_at = models.DateTimeField(blank=True, null=True)
    completed = models.BooleanField(blank=True, null=True, default=False)
    history_json = models.JSONField(blank=True, null=True)
    employer_notified_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "wellbeing_safeguarding_monitoring_system"

    def __str__(self):
        return self.learner_email or f"Record {self.id}"


class SafeguardingWellbeingAutomation(models.Model):
    id = models.BigAutoField(primary_key=True)
    wellbeing_record_id = models.BigIntegerField()
    created_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(blank=True, null=True)

    apprentice_dashboard = models.TextField(blank=True, null=True)

    follow_up_by_coach = models.TextField(
        blank=True,
        null=True,
        db_column="Follow-up_by_Coach",
    )

    suggested_coach_actions = models.TextField(
        blank=True,
        null=True,
        db_column="Suggested_Coach_Actions",
    )

    class Meta:
        managed = False
        db_table = "safeguarding_wellbeing_automation"

    def __str__(self):
        return f"Automation {self.id} / wellbeing_record_id={self.wellbeing_record_id}"

# tickets
class SupportTicket(models.Model):
    id = models.BigAutoField(primary_key=True)
    wellbeing_record_id = models.BigIntegerField(blank=True, null=True)
    ticket_type = models.TextField()
    full_name = models.TextField()
    email = models.TextField()
    subject = models.TextField()
    details = models.TextField()
    urgency = models.TextField(blank=True, null=True)
    preferred_contact = models.TextField(blank=True, null=True)
    status = models.TextField(default="open")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_tickets"

    def __str__(self):
        return f"{self.ticket_type} - {self.full_name} - {self.subject[:40]}"