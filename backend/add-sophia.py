#!/usr/bin/env python3
import urllib.request, json

data = json.dumps({
    "name": "Sophia Chen",
    "email": "sophia.chen@example.com",
    "phone": "+49 152 3456789",
    "location": "Hamburg",
    "experience": "12 Jahre in der Softwareentwicklung. 5 Jahre Engineering Manager bei Xing. 4 Jahre Senior Developer bei Otto (Microservices, Kotlin). 3 Jahre DevOps/Platform Engineer.",
    "skills": "Kotlin, Java, Microservices, AWS, Terraform, Team Leadership, Agile, System Design, Python, Go",
    "education": "Dipl.-Ing. Informatik, Universitaet Hamburg",
    "desired_salary": "95.000 - 110.000 EUR",
    "availability": "Ab Mai 2026",
    "languages": "Deutsch (C2), Englisch (C2), Mandarin (Muttersprache)",
    "certificates": "AWS DevOps Engineer Professional, SAFe Agilist",
    "drivers_license": "B",
    "mobility": "Hamburg, Remote moeglich, bundesweit reisebereit",
    "notes": "Top-Kandidatin fuer Leadership-Positionen"
}).encode()

req = urllib.request.Request(
    "http://localhost:3001/api/candidates",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST"
)
resp = urllib.request.urlopen(req)
r = json.loads(resp.read())
print(f"Created: {r['name']} (ID: {r['id']})")
