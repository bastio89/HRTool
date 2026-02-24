#!/usr/bin/env python3
"""Deploy the HR Matching workflow to n8n"""
import json
import urllib.request
import sys

N8N_URL = "http://localhost:5678"
N8N_KEY = sys.argv[1] if len(sys.argv) > 1 else ""

JS_CODE = r"""
const body = $input.first().json.body;
const jobDescription = body.jobDescription;
const jobTitle = body.jobTitle || 'Unbenannte Stelle';
const candidates = body.candidates || [];

const results = [];

for (const candidate of candidates) {
  const prompt = `Du bist ein erfahrener HR-Experte und Recruiting-Spezialist. Bewerte wie gut der folgende Bewerber zu der Stellenbeschreibung passt.

STELLENBESCHREIBUNG:
${jobDescription}

BEWERBER-PROFIL:
Name: ${candidate.name}
Berufserfahrung: ${candidate.experience || 'Nicht angegeben'}
Skills: ${candidate.skills || 'Nicht angegeben'}
Ausbildung: ${candidate.education || 'Nicht angegeben'}
Sprachen: ${candidate.languages || 'Nicht angegeben'}
Zertifikate: ${candidate.certificates || 'Nicht angegeben'}
Standort: ${candidate.location || 'Nicht angegeben'}
Gehaltsvorstellung: ${candidate.desired_salary || 'Nicht angegeben'}
Verfuegbarkeit: ${candidate.availability || 'Nicht angegeben'}
Fuehrerschein: ${candidate.drivers_license || 'Nicht angegeben'}
Mobilitaet: ${candidate.mobility || 'Nicht angegeben'}

Bewerte den Bewerber auf einer Skala von 0.00 bis 1.00 (1.00 = perfekte Uebereinstimmung).

Antworte AUSSCHLIESSLICH im folgenden JSON-Format ohne zusaetzlichen Text:
{"score": 0.XX, "summary": "Kurze Zusammenfassung in 2-3 Saetzen warum dieser Score vergeben wurde.", "strengths": ["Staerke 1", "Staerke 2"], "weaknesses": ["Schwaeche 1", "Schwaeche 2"]}`;

  let score = 0;
  let summary = 'Bewertung konnte nicht durchgefuehrt werden.';
  let strengths = [];
  let weaknesses = [];

  try {
    const data = await this.helpers.httpRequest({
      method: 'POST',
      url: 'http://host.docker.internal:11434/api/generate',
      body: { model: 'llama3.2', prompt, stream: false },
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000,
    });
    const ollamaResponse = data.response || '';

    const jsonMatch = ollamaResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Clean common LLM JSON issues: trailing commas, unescaped newlines in strings
      let jsonStr = jsonMatch[0]
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\x00-\x1f]/g, ' ');
      const parsed = JSON.parse(jsonStr);
      let rawScore = parseFloat(parsed.score) || 0;
      // Normalize: model may return 0-10 or 0-100 instead of 0-1
      if (rawScore > 1 && rawScore <= 10) rawScore = rawScore / 10;
      else if (rawScore > 10) rawScore = rawScore / 100;
      score = Math.min(1, Math.max(0, rawScore));
      summary = parsed.summary || summary;
      strengths = Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 5) : [];
      weaknesses = Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String).slice(0, 5) : [];
    }
  } catch (e) {
    // Fallback: try to extract score with regex
    const ollamaResp = data?.response || '';
    const scoreMatch = ollamaResp.match(/"score"\s*:\s*([\d.]+)/);
    if (scoreMatch) {
      let rawScore = parseFloat(scoreMatch[1]) || 0;
      if (rawScore > 1 && rawScore <= 10) rawScore = rawScore / 10;
      else if (rawScore > 10) rawScore = rawScore / 100;
      score = Math.min(1, Math.max(0, rawScore));
    }
    const summaryMatch = ollamaResp.match(/"summary"\s*:\s*"([^"]+)"/);
    if (summaryMatch) summary = summaryMatch[1];
    else summary = `Bewertung konnte nur teilweise durchgefuehrt werden (Score: ${score}).`;
  }

  results.push({
    candidateId: candidate.id,
    candidateName: candidate.name,
    score: Math.round(score * 100) / 100,
    summary,
    strengths,
    weaknesses
  });
}

results.sort((a, b) => b.score - a.score);

return [{ json: { results, matchedAt: new Date().toISOString() } }];
"""

workflow = {
    "name": "HR Bewerber-Matching",
    "nodes": [
        {
            "parameters": {
                "httpMethod": "POST",
                "path": "hr-matching",
                "responseMode": "responseNode",
                "options": {}
            },
            "id": "webhook-trigger",
            "name": "Webhook",
            "type": "n8n-nodes-base.webhook",
            "typeVersion": 2,
            "position": [220, 300],
            "webhookId": "hr-matching"
        },
        {
            "parameters": {
                "jsCode": JS_CODE
            },
            "id": "matching-engine",
            "name": "KI Matching Engine",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [480, 300]
        },
        {
            "parameters": {
                "respondWith": "json",
                "responseBody": "={{ JSON.stringify($json) }}"
            },
            "id": "respond-webhook",
            "name": "Respond to Webhook",
            "type": "n8n-nodes-base.respondToWebhook",
            "typeVersion": 1.1,
            "position": [740, 300]
        }
    ],
    "connections": {
        "Webhook": {
            "main": [[{"node": "KI Matching Engine", "type": "main", "index": 0}]]
        },
        "KI Matching Engine": {
            "main": [[{"node": "Respond to Webhook", "type": "main", "index": 0}]]
        }
    },
    "settings": {
        "executionOrder": "v1"
    }
}

data = json.dumps(workflow).encode()
req = urllib.request.Request(
    f"{N8N_URL}/api/v1/workflows",
    data=data,
    headers={
        "Content-Type": "application/json",
        "X-N8N-API-KEY": N8N_KEY
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        wf_id = result["id"]
        print(f"Created workflow: {wf_id}")

        # Activate
        activate_req = urllib.request.Request(
            f"{N8N_URL}/api/v1/workflows/{wf_id}/activate",
            headers={"X-N8N-API-KEY": N8N_KEY},
            method="POST"
        )
        with urllib.request.urlopen(activate_req) as resp2:
            act_result = json.loads(resp2.read())
            print(f"Activated: {act_result.get('active')}")
            print(f"Workflow ID: {wf_id}")
except Exception as e:
    print(f"Error: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode())
