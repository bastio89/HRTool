import { ArrowLeft, Bot, Shield, Eye, Scale, UserCheck, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/UI'

const sections = [
  {
    icon: Bot,
    color: '#5e5ce6',
    title: 'Welche KI-Funktionen nutzt dieses Tool?',
    content: [
      {
        label: 'KI-Matching (Hochrisiko)',
        text: 'Vergleicht Bewerberprofile automatisch mit Stellenanforderungen und berechnet einen Matching-Score (0–100%). Nutzt ein Large Language Model (LLM) zur Analyse von Erfahrung, Skills, Ausbildung und weiteren Kriterien.',
      },
      {
        label: 'KI-CV-Parser (Hochrisiko)',
        text: 'Extrahiert automatisch strukturierte Daten (Name, Skills, Erfahrung etc.) aus hochgeladenen Lebensläufen (PDF/Word). Nutzt ein LLM zur intelligenten Textanalyse.',
      },
      {
        label: 'KI-Stellenbeschreibung (Niedriges Risiko)',
        text: 'Generiert auf Basis von Stichpunkten und Jobtitel eine Stellenbeschreibung. Hier werden keine personenbezogenen Daten verarbeitet – es handelt sich um eine reine Textgenerierung.',
      },
    ],
  },
  {
    icon: Shield,
    color: '#0071e3',
    title: 'Risikoklassifizierung nach EU AI Act',
    content: [
      {
        label: 'Hochrisiko-Einstufung',
        text: 'Das KI-Matching und der KI-CV-Parser fallen unter Anhang III, Kategorie 4 des EU AI Acts (\"Beschäftigung, Arbeitnehmerverwaltung und Zugang zur Selbständigkeit\"). Diese KI-Systeme werden zur Filterung und Bewertung von Bewerbungen eingesetzt und unterliegen daher strengen Anforderungen.',
      },
    ],
  },
  {
    icon: Eye,
    color: '#34c759',
    title: 'Transparenz & Nachvollziehbarkeit',
    content: [
      {
        label: 'Prompt-Logging (Art. 12)',
        text: 'Jeder KI-Aufruf wird vollständig protokolliert: Eingabe (Prompt), Ausgabe (Response), verwendetes Modell, Dauer und Zeitstempel. Diese Logs ermöglichen eine lückenlose Nachvollziehbarkeit aller KI-Entscheidungen.',
      },
      {
        label: 'KI-Kennzeichnung (Art. 13)',
        text: 'Alle KI-generierten Inhalte sind im Frontend eindeutig als solche gekennzeichnet – durch lila Badges und Transparenzhinweise. So ist jederzeit erkennbar, welche Informationen von einer KI stammen.',
      },
    ],
  },
  {
    icon: UserCheck,
    color: '#ff9f0a',
    title: 'Menschliche Aufsicht (Art. 14)',
    content: [
      {
        label: 'Keine automatisierten Entscheidungen',
        text: 'Die KI trifft keine eigenständigen Einstellungsentscheidungen. Alle KI-Ergebnisse (Matching-Scores, extrahierte CV-Daten, generierte Texte) sind Vorschläge, die von einem Recruiter geprüft und ggf. korrigiert werden müssen.',
      },
      {
        label: 'Override-Möglichkeit',
        text: 'Recruiter können alle KI-Ergebnisse jederzeit überstimmen, bearbeiten oder verwerfen. Die finale Entscheidung liegt immer beim Menschen.',
      },
    ],
  },
  {
    icon: Scale,
    color: '#ff3b30',
    title: 'Datenschutz & Fairness',
    content: [
      {
        label: 'Anonymisierung beim Matching',
        text: 'Beim KI-Matching werden Bewerbernamen durch Platzhalter ersetzt (z.B. \"Kandidat 1\"), sodass Name, Geschlecht und Herkunft keinen Einfluss auf die Bewertung haben.',
      },
      {
        label: 'Datenminimierung',
        text: 'Es werden nur die für die jeweilige KI-Funktion relevanten Daten an das Sprachmodell übermittelt. Sensible Daten werden nicht unnötig verarbeitet.',
      },
      {
        label: 'Lokale Verarbeitung',
        text: 'Das verwendete LLM (Ollama) läuft lokal – Bewerberdaten werden nicht an externe Cloud-Dienste gesendet.',
      },
    ],
  },
]

export default function KITransparenz() {
  const navigate = useNavigate()

  return (
    <div className="fade-in max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">
            KI-Transparenz
          </h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">
            Informationen zur Nutzung künstlicher Intelligenz gemäß EU AI Act
          </p>
        </div>
      </div>

      {/* Intro Banner */}
      <Card className="p-8 sm:p-10 mb-10 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 dark:from-[#5e5ce6]/10 dark:to-[#0071e3]/10 border border-[#5e5ce6]/10">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-7 h-7 text-[#5e5ce6]" />
          </div>
          <div>
            <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">
              Hinweis für Bewerber und Nutzer
            </h2>
            <p className="text-[15px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
              Dieses HR-Tool setzt in bestimmten Funktionen KI-basierte Systeme ein, die nach dem{' '}
              <span className="font-semibold text-[#5e5ce6]">EU AI Act (Verordnung (EU) 2024/1689)</span>{' '}
              als Hochrisiko-KI-Systeme eingestuft sind. Nachfolgend informieren wir Sie transparent über
              den Einsatz, die Funktionsweise und Ihre Rechte.
            </p>
          </div>
        </div>
      </Card>

      {/* Sections */}
      <div className="space-y-8">
        {sections.map((section, idx) => {
          const Icon = section.icon
          return (
            <Card key={idx} className="p-8 sm:p-10">
              <div className="flex items-center gap-4 mb-8">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${section.color}15` }}
                >
                  <Icon className="w-6 h-6" style={{ color: section.color }} />
                </div>
                <h2 className="text-[20px] font-semibold tracking-tight text-black dark:text-white">
                  {section.title}
                </h2>
              </div>
              <div className="space-y-6">
                {section.content.map((item, i) => (
                  <div key={i} className="pl-4 border-l-2 border-gray-100 dark:border-gray-700">
                    <h3 className="text-[15px] font-bold text-black dark:text-white mb-1">{item.label}</h3>
                    <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Legal Reference */}
      <Card className="p-8 sm:p-10 mt-10 mb-16">
        <h2 className="text-[18px] font-semibold text-black dark:text-white mb-4">Rechtsgrundlage</h2>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
          Die hier dargestellten Informationen dienen der Erfüllung der Transparenzpflichten nach{' '}
          <span className="font-semibold">Art. 13 und Art. 50 der Verordnung (EU) 2024/1689</span> (EU AI Act).
        </p>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
          Bei Fragen zur KI-Nutzung in diesem Tool oder zur Ausübung Ihrer Rechte wenden Sie sich bitte
          an den zuständigen Ansprechpartner Ihres Unternehmens.
        </p>
        <p className="text-[13px] text-gray-400 dark:text-gray-500 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
          Letzte Aktualisierung: {new Date().toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </Card>
    </div>
  )
}
