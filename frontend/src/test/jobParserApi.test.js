import { afterEach, describe, expect, test, vi } from 'vitest'

import { jobsApi } from '../api'

describe('jobsApi.parseDescriptionFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('parses with the fast service and persists the extracted full text', async () => {
    const parsedProfile = {
      profile: {
        job_title: 'Senior Backend Engineer',
        location: 'Luzern',
        remote_work: 'Hybrid',
        workload_pensum: '80–100 %',
        required_skills: { it_skills: ['Python', 'PostgreSQL'], soft_skills: [] },
      },
      raw_text: 'Complete job description with responsibilities and requirements.',
    }
    const persistedJob = {
      id: 41,
      title: 'Senior Backend Engineer',
      description: parsedProfile.raw_text,
      graphRag: { id: 'graph-job-41', message: 'Job ingested successfully' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => parsedProfile })
      .mockResolvedValueOnce({ ok: true, json: async () => persistedJob })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['pdf bytes'], 'backend-engineer.pdf', { type: 'application/pdf' })

    const result = await jobsApi.parseDescriptionFile(file, false, true)

    expect(fetchMock.mock.calls[0][0]).toBe('/graphrag-api/api/v1/parse/job')
    expect(fetchMock.mock.calls[0][1].body.get('file')).toBe(file)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/jobs')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(expect.objectContaining({
      title: 'Senior Backend Engineer',
      description: parsedProfile.raw_text,
      skills: 'Python, PostgreSQL',
      location: 'Luzern',
      requirements: 'Pensum: 80–100 %\nArbeitsmodell: Hybrid',
      type: 'Vollzeit',
    }))
    const graphRagProfile = JSON.parse(fetchMock.mock.calls[1][1].body).graphRagProfile
    expect(graphRagProfile.description).toBe(parsedProfile.raw_text)
    expect(graphRagProfile.required_skills).toEqual([
      { name: 'Python', category: 'HardSkill', priority: 'Mandatory' },
      { name: 'PostgreSQL', category: 'HardSkill', priority: 'Mandatory' },
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('raw_text')
    expect(result.id).toBe(41)
    expect(result.graphRag.id).toBe('graph-job-41')
  })

  test('rejects non-PDF files before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['text'], 'job-description.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await expect(jobsApi.parseDescriptionFile(file)).rejects.toThrow('Nur PDF-Dateien')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})