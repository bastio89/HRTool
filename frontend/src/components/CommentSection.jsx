import { useState, useEffect } from 'react'
import { MessageSquare, Send, Trash2, AtSign, X } from 'lucide-react'
import { collaborationApi } from '../api'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'

export default function CommentSection({ entityType, entityId }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [users, setUsers] = useState([])
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')

  useEffect(() => {
    if (!entityType || !entityId) return
    setLoading(true)
    Promise.all([
      collaborationApi.getComments(entityType, entityId).catch(() => []),
      collaborationApi.getUsers().catch(() => []),
    ]).then(([c, u]) => { setComments(c); setUsers(u) }).finally(() => setLoading(false))
  }, [entityType, entityId])

  const handleSubmit = async () => {
    if (!newComment.trim() || sending) return
    setSending(true)
    try {
      const result = await collaborationApi.createComment({ entity_type: entityType, entity_id: entityId, content: newComment })
      setComments(prev => [...prev, result])
      setNewComment('')
    } catch (_) {}
    setSending(false)
  }

  const handleDelete = async (id) => {
    try {
      await collaborationApi.deleteComment(id)
      setComments(prev => prev.filter(c => c.id !== id))
    } catch (_) {}
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === '@') {
      setShowMentions(true)
      setMentionFilter('')
    }
    if (e.key === 'Escape') setShowMentions(false)
  }

  const handleInputChange = (e) => {
    const val = e.target.value
    setNewComment(val)
    // Track @mention typing
    const lastAt = val.lastIndexOf('@')
    if (lastAt >= 0 && lastAt === val.length - 1) {
      setShowMentions(true)
      setMentionFilter('')
    } else if (lastAt >= 0) {
      const after = val.substring(lastAt + 1)
      if (!after.includes(' ')) {
        setShowMentions(true)
        setMentionFilter(after.toLowerCase())
      } else {
        setShowMentions(false)
      }
    } else {
      setShowMentions(false)
    }
  }

  const insertMention = (username) => {
    const lastAt = newComment.lastIndexOf('@')
    setNewComment(newComment.substring(0, lastAt) + '@' + username + ' ')
    setShowMentions(false)
  }

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(mentionFilter) || 
    u.display_name.toLowerCase().includes(mentionFilter)
  )

  const formatContent = (text) => {
    return text.replace(/@(\w+)/g, '<span class="text-[#0071e3] dark:text-[#0a84ff] font-semibold">@$1</span>')
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-5 h-5 text-[#5e5ce6]" />
        <h3 className="text-[15px] font-bold text-black dark:text-white">{t('collab.comments')} ({comments.length})</h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-[#5e5ce6] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Comments list */}
          <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto">
            {comments.map(c => (
              <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] group">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${c.author_name || c.author_username}`} alt="" className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-black dark:text-white">{c.author_name || c.author_username}</span>
                    <span className="text-[11px] text-gray-400">{new Date(c.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[13px] text-gray-700 dark:text-gray-300 mt-0.5 break-words" dangerouslySetInnerHTML={{ __html: formatContent(c.content) }} />
                </div>
                {(c.user_id === user?.id || user?.role === 'admin') && (
                  <button onClick={() => handleDelete(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-[#ff3b30] transition-all cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {comments.length === 0 && (
              <p className="text-center text-[13px] text-gray-400 py-4">{t('collab.no_comments')}</p>
            )}
          </div>

          {/* New comment input */}
          <div className="relative flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea value={newComment} onChange={handleInputChange} onKeyDown={handleKeyDown}
                rows={2} placeholder={t('collab.write_comment')}
                className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-gray-200 dark:border-gray-700 text-[13px] outline-none focus:ring-2 focus:ring-[#5e5ce6]/30 resize-none" />
              
              {/* Mention dropdown */}
              {showMentions && filteredUsers.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-h-40 overflow-y-auto z-10">
                  {filteredUsers.slice(0, 5).map(u => (
                    <button key={u.id} onClick={() => insertMention(u.username)}
                      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer">
                      <AtSign className="w-3 h-3 text-[#5e5ce6]" />
                      <span className="text-[13px] font-semibold text-black dark:text-white">{u.display_name}</span>
                      <span className="text-[11px] text-gray-400">@{u.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleSubmit} disabled={!newComment.trim() || sending}
              className="p-3 bg-[#5e5ce6] hover:bg-[#4d4bc5] text-white rounded-xl disabled:opacity-50 transition-colors cursor-pointer flex-shrink-0">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
