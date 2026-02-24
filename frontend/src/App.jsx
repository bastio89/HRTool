import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Candidates from './pages/Candidates'
import CandidateForm from './pages/CandidateForm'
import CandidateDetail from './pages/CandidateDetail'
import Matching from './pages/Matching'
import MatchingResults from './pages/MatchingResults'
import History from './pages/History'
import Jobs from './pages/Jobs'
import Pipeline from './pages/Pipeline'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="candidates" element={<Candidates />} />
        <Route path="candidates/new" element={<CandidateForm />} />
        <Route path="candidates/:id/edit" element={<CandidateForm />} />
        <Route path="candidates/:id/detail" element={<CandidateDetail />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="pipeline/:jobId" element={<Pipeline />} />
        <Route path="matching" element={<Matching />} />
        <Route path="matching/results/:id" element={<MatchingResults />} />
        <Route path="history" element={<History />} />
      </Route>
    </Routes>
  )
}
