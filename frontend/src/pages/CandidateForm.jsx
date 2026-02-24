import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { candidatesApi } from '../api'
import { Card, Button, Input, Textarea, LoadingSpinner } from '../components/UI'

const emptyCandidate = {
  name: '', email: '', phone: '', location: '',
  experience: '', skills: '', education: '',
  desired_salary: '', availability: '', languages: '',
  certificates: '', drivers_license: '', mobility: '', notes: ''
}

export default function CandidateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(emptyCandidate)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isEdit) {
      candidatesApi.getById(id)
        .then(data => setForm({
          name: data.name || '', email: data.email || '', phone: data.phone || '', location: data.location || '',
          experience: data.experience || '', skills: data.skills || '', education: data.education || '',
          desired_salary: data.desired_salary || '', availability: data.availability || '', languages: data.languages || '',
          certificates: data.certificates || '', drivers_license: data.drivers_license || '', mobility: data.mobility || '', notes: data.notes || '',
        }))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      if (isEdit) {
        await candidatesApi.update(id, form)
      } else {
        await candidatesApi.create(form)
      }
      navigate('/candidates')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner text="Bewerber wird geladen..." />

  return (
    <div className="fade-in max-w-[800px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-8 mb-14">
        <button onClick={() => navigate('/candidates')} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight text-black">
            {isEdit ? 'Bewerber bearbeiten' : 'Neuer Bewerber'}
          </h1>
          <p className="text-[18px] text-gray-500 mt-2">
            {isEdit ? 'Daten des Bewerbers aktualisieren' : 'Neuen Bewerber in der Kartei anlegen'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Persönliche Daten</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Name *" placeholder="Max Mustermann" value={form.name} onChange={handleChange('name')} required />
            <Input label="E-Mail" type="email" placeholder="max@example.com" value={form.email} onChange={handleChange('email')} />
            <Input label="Telefon" placeholder="+49 171 1234567" value={form.phone} onChange={handleChange('phone')} />
            <Input label="Wohnort" placeholder="Berlin" value={form.location} onChange={handleChange('location')} />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Berufliches Profil</h2>
          <div className="space-y-8">
            <Textarea 
              label="Berufserfahrung" 
              placeholder="5 Jahre Software-Entwicklung bei Firma XY, davon 2 Jahre als Teamlead..."
              value={form.experience} 
              onChange={handleChange('experience')}
              rows={4}
            />
            <Input 
              label="Skills / Kompetenzen" 
              placeholder="JavaScript, React, Node.js, Python (kommagetrennt)"
              value={form.skills} 
              onChange={handleChange('skills')} 
            />
            <Input 
              label="Ausbildung" 
              placeholder="B.Sc. Informatik, Universität Berlin"
              value={form.education} 
              onChange={handleChange('education')} 
            />
            <Input 
              label="Zertifikate" 
              placeholder="AWS Solutions Architect, PMP, Scrum Master"
              value={form.certificates} 
              onChange={handleChange('certificates')} 
            />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Erweiterte Informationen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Sprachen" placeholder="Deutsch (C2), Englisch (C1)" value={form.languages} onChange={handleChange('languages')} />
            <Input label="Führerschein" placeholder="B, BE" value={form.drivers_license} onChange={handleChange('drivers_license')} />
            <Input label="Mobilität" placeholder="Bundesweit, Remote bevorzugt" value={form.mobility} onChange={handleChange('mobility')} />
            <Input label="Gehaltsvorstellung" placeholder="55.000 - 65.000 € p.a." value={form.desired_salary} onChange={handleChange('desired_salary')} />
            <Input label="Verfügbarkeit" placeholder="Ab sofort / 3 Monate Kündigungsfrist" value={form.availability} onChange={handleChange('availability')} />
          </div>
        </Card>

        <Card className="p-12">
          <Textarea 
            label="Notizen" 
            placeholder="Interne Notizen zum Bewerber..."
            value={form.notes} 
            onChange={handleChange('notes')}
            rows={3}
          />
        </Card>

        <div className="flex items-center justify-end gap-5 pt-6 pb-12">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/candidates')}>
            Abbrechen
          </Button>
          <Button variant="dark" type="submit" size="lg" disabled={saving || !form.name.trim()}>
            <Save className="w-5 h-5" />
            {saving ? 'Wird gespeichert...' : (isEdit ? 'Aktualisieren' : 'Anlegen')}
          </Button>
        </div>
      </form>
    </div>
  )
}
