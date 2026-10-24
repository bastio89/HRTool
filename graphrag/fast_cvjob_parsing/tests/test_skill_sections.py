from fast_cvjob_parsing.app.skill_sections import extract_required_skill_sections


def test_extracts_german_required_skills_and_stops_at_offer_section():
    blocks = [
        "Jobtitel",
        "Deine Fähigkeiten",
        "●\u200b Mehrjährige Erfahrung in der Microsoft Office Palette als Power-User sowie XML, HTML und JavaScript",
        "●\u200b Verantwortungsbewusstsein und eine schnelle analytische Auffassungsgabe",
        "●\u200b Sehr gute Deutschkenntnisse (mind. C2) und gute Kenntnisse der englischen Sprache",
        "●\u200b Kundenorientiertes Denken, Motivationsfähigkeit und Talent, dich und deine Arbeit optimal zu organisieren",
        "●\u200b Offenes, sympathisches Auftreten",
        "Unser Angebot",
        "●\u200b Flexible Arbeitszeiten, bis zu drei Tage Homeoffice und Workation",
    ]

    skills = extract_required_skill_sections(blocks)

    assert skills["it_skills"] == [
        "Mehrjährige Erfahrung in der Microsoft Office Palette als Power-User sowie XML, HTML und JavaScript",
    ]
    assert skills["soft_skills"] == [
        "Verantwortungsbewusstsein und eine schnelle analytische Auffassungsgabe",
        "Kundenorientiertes Denken, Motivationsfähigkeit und Talent, dich und deine Arbeit optimal zu organisieren",
        "Offenes, sympathisches Auftreten",
    ]
    assert skills["language_skills"] == ["German (C2)", "English"]
    assert all("Flexible Arbeitszeiten" not in values for values in skills.values())


def test_joins_wrapped_bullet_continuation_lines():
    skills = extract_required_skill_sections([
        "Qualifications",
        "● Mehrjährige Erfahrung in Scrum, idealerweise zertifiziert (z. B.",
        "PSM I / CSM)",
        "Zusätzliche Informationen",
    ])

    assert skills["it_skills"] == ["Mehrjährige Erfahrung in Scrum, idealerweise zertifiziert (z. B. PSM I / CSM)"]