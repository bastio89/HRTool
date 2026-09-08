import { Link } from 'react-router-dom'
import { ArrowLeft, Linkedin, FileText, PlayCircle } from 'lucide-react'

export default function ToolsLinkedIn() {
  return (
    <div className="max-w-[1200px] mx-auto fade-in">
      <div className="mb-8 sm:mb-12">
        <Link to="/tools" className="inline-flex items-center gap-2 text-[14px] font-medium text-[#0071e3] hover:opacity-80 transition-opacity mb-4">
          <ArrowLeft className="w-4 h-4" />
          Zurück zu Tools
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
            <Linkedin className="w-7 h-7 text-[#0077b5]" />
          </div>
          <div>
            <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">LinkedIn</h1>
            <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-2">
              Werkzeuge für LinkedIn-Profile, Apify-Importe und PDF-Export.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#0077b5]" />
            </div>
            <h2 className="text-[18px] font-semibold text-black dark:text-white">Profil-Import</h2>
          </div>
          <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-7">
            Hier kannst du später LinkedIn-Links auswerten, Profile sammeln und die Kandidatenverarbeitung zentral starten.
          </p>
        </section>

        <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center">
              <PlayCircle className="w-5 h-5 text-black dark:text-white" />
            </div>
            <h2 className="text-[18px] font-semibold text-black dark:text-white">Workflow</h2>
          </div>
          <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-7">
            Diese Unterseite ist als Platzhalter für LinkedIn-bezogene Automationen gedacht und kann später mit deinen Skripten verknüpft werden.
          </p>
        </section>
      </div>
    </div>
  )
}