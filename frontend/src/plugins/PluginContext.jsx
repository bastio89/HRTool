import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { pluginsApi } from '../api'
import { useAuth } from '../AuthContext'
import { getPluginDefinitions } from './registry'

const PluginContext = createContext({
  loading: false,
  plugins: [],
  activePlugins: [],
  error: null,
  isEnabled: () => false,
  getPlugin: () => null,
})

function buildFallbackPlugins() {
  return getPluginDefinitions().map((definition) => ({
    id: definition.id,
    name: definition.name,
    enabled: definition.defaultEnabled !== false,
    uiSlots: definition.uiSlots || [],
    routes: definition.route ? [definition.route.path] : [],
  }))
}

export function PluginProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState({
    loading: false,
    plugins: buildFallbackPlugins(),
    activePlugins: buildFallbackPlugins().filter((plugin) => plugin.enabled),
    error: null,
  })

  const loadPlugins = useCallback(async () => {
    if (authLoading || !user) {
      setState({
        loading: false,
        plugins: [],
        activePlugins: [],
        error: null,
      })
      return
    }

    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const response = await pluginsApi.getAll()
      const plugins = Array.isArray(response?.plugins) ? response.plugins : []
      const activePlugins = plugins.filter((plugin) => plugin && plugin.enabled)
      setState({
        loading: false,
        plugins,
        activePlugins,
        error: null,
      })
    } catch (error) {
      const fallbackPlugins = buildFallbackPlugins()
      setState({
        loading: false,
        plugins: fallbackPlugins,
        activePlugins: fallbackPlugins.filter((plugin) => plugin.enabled),
        error: error?.message || 'Plugin-Registry konnte nicht geladen werden',
      })
    }
  }, [authLoading, user])

  useEffect(() => {
    let cancelled = false

    void loadPlugins().finally(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [authLoading, loadPlugins])

  const value = useMemo(() => {
    const pluginMap = new Map(state.plugins.map((plugin) => [plugin.id, plugin]))
    return {
      ...state,
      refreshPlugins: loadPlugins,
      isEnabled: (pluginId) => Boolean(pluginMap.get(pluginId)?.enabled),
      getPlugin: (pluginId) => pluginMap.get(pluginId) || null,
    }
  }, [state, loadPlugins])

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}

export function usePlugins() {
  return useContext(PluginContext)
}
