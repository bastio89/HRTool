import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Settings, GripVertical, Eye, EyeOff, RotateCcw, X, BarChart2, GitMerge, GitCompare, MapPin, Share2 } from 'lucide-react'
import { useI18n } from '../I18nContext'

const ICONS = {
  BarChart2, GitBranch: GitMerge, GitCompare, MapPin, Share2
}

export default function WidgetConfigurator({ widgets, onToggle, onReorder, onReset }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const dragItem = useRef(null)
  const dragOverItem = useRef(null)
  const [dragIndex, setDragIndex] = useState(null)

  const handleDragStart = (index) => {
    dragItem.current = index
    setDragIndex(index)
  }

  const handleDragEnter = (index) => {
    dragOverItem.current = index
  }

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      onReorder(dragItem.current, dragOverItem.current)
    }
    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] text-gray-600 dark:text-gray-300 text-[14px] font-medium transition-all duration-300 cursor-pointer"
      >
        <Settings className="w-4 h-4" />
        {t('widget.title')}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          
          {/* Panel */}
          <div
            className="relative w-full max-w-md bg-white dark:bg-[#1c1c1e] rounded-[24px] shadow-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-[20px] font-semibold text-black dark:text-white">{t('widget.dashboard_widgets')}</h3>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{t('widget.config_desc')}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Widget List */}
            <div className="p-4 space-y-1.5 max-h-[400px] overflow-y-auto">
              {widgets.map((widget, index) => {
                const Icon = ICONS[widget.icon] || BarChart2
                const isDragging = dragIndex === index
                return (
                  <div
                    key={widget.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragEnter={() => handleDragEnter(index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => e.preventDefault()}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 select-none
                      ${isDragging 
                        ? 'opacity-50 scale-[0.97] bg-[#0071e3]/10 border border-[#0071e3]/30' 
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent hover:border-gray-200 dark:hover:border-gray-600'
                      }`}
                    style={{ cursor: 'grab' }}
                  >
                    <GripVertical className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      widget.visible 
                        ? 'bg-[#0071e3]/10' 
                        : 'bg-gray-200/60 dark:bg-gray-700/60'
                    }`}>
                      <Icon className={`w-4.5 h-4.5 ${widget.visible ? 'text-[#0071e3]' : 'text-gray-400'}`} />
                    </div>
                    
                    <span className={`flex-1 text-[15px] font-medium ${
                      widget.visible 
                        ? 'text-black dark:text-white' 
                        : 'text-gray-400 dark:text-gray-500 line-through'
                    }`}>
                      {widget.label}
                    </span>

                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(widget.id) }}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        widget.visible 
                          ? 'bg-[#34c759]/10 hover:bg-[#34c759]/20' 
                          : 'bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20'
                      }`}
                    >
                      {widget.visible 
                        ? <Eye className="w-4 h-4 text-[#34c759]" /> 
                        : <EyeOff className="w-4 h-4 text-[#ff3b30]" />
                      }
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-7 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={onReset}
                className="flex items-center gap-2 text-[14px] font-medium text-gray-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                {t('widget.reset')}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-5 py-2.5 rounded-full bg-[#0071e3] text-white text-[14px] font-medium hover:bg-[#0077ed] transition-colors cursor-pointer"
              >
                {t('widget.done')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
