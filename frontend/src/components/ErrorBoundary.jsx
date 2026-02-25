import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-[#ff3b30]" />
            </div>
            <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-3">
              Etwas ist schiefgelaufen
            </h2>
            <p className="text-[16px] text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              Ein unerwarteter Fehler ist aufgetreten. Versuche die Seite neu zu laden.
            </p>
            {this.state.error && (
              <div className="mb-6 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-left">
                <p className="text-[13px] font-mono text-gray-600 dark:text-gray-400 break-all">
                  {this.state.error.message || 'Unbekannter Fehler'}
                </p>
              </div>
            )}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-black text-white text-[15px] font-semibold hover:opacity-80 transition-opacity cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Erneut versuchen
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="px-6 py-3 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 text-[15px] font-semibold hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
              >
                Zur Startseite
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
