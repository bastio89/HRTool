import { lazy } from 'react'
import { Bot, FileText } from 'lucide-react'

const LinkedInToolsPage = lazy(() => import('../pages/ToolsLinkedIn'))
const JobsChPage = lazy(() => import('./jobs_ch/JobsChPage'))

export const pluginDefinitions = {
  jobs_ch: {
    id: 'jobs_ch',
    name: 'Jobs.ch',
    defaultEnabled: true,
    uiSlots: ['sidebar', 'tools', 'routes'],
    navItem: {
      to: '/tools/jobs-ch',
      icon: FileText,
      labelKey: 'nav.jobs_ch',
    },
    route: {
      path: 'tools/jobs-ch',
      element: JobsChPage,
    },
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    defaultEnabled: true,
    uiSlots: ['sidebar', 'tools', 'routes'],
    navItem: {
      to: '/tools/linkedin',
      icon: Bot,
      labelKey: 'nav.linkedin',
    },
    route: {
      path: 'tools/linkedin',
      element: LinkedInToolsPage,
    },
  },
  skill_matching_tests: {
    id: 'skill_matching_tests',
    name: 'Skill-Matching CSV-Test',
    defaultEnabled: false,
    uiSlots: ['tools'],
  },
}

export function getPluginDefinition(pluginId) {
  return pluginDefinitions[pluginId] || null
}

export function getPluginDefinitions() {
  return Object.values(pluginDefinitions)
}
