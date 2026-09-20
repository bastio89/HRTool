import { useEffect, useMemo, useState } from 'react'
import { BadgeEuro, Clock3, CreditCard, Loader2, Plus, RefreshCw, ShieldCheck, Users, Wallet } from 'lucide-react'
import { authApi, billingApi, subscribeCreditRefresh } from '../api'
import Modal from '../components/Modal'
import { Button, Card, Input, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'

function formatCredits(value) {
  const num = Number(value || 0)
  return num.toFixed(1)
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function AdminCreditsPage() {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [overview, setOverview] = useState(null)
  const [backendUsers, setBackendUsers] = useState([])
  const [billingUsers, setBillingUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [topUpSaving, setTopUpSaving] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState('')
  const [topUpReason, setTopUpReason] = useState('Manuelle Guthabenanpassung')
  const [topUpPin, setTopUpPin] = useState('')
  const [error, setError] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [usersRes, overviewRes, billingRes] = await Promise.all([
        authApi.getUsers(),
        billingApi.getOverview(),
        billingApi.getUsers(),
      ])
      setBackendUsers(usersRes.data || [])
      setOverview(overviewRes)
      setBillingUsers(billingRes.data || [])
    } catch (err) {
      setError(err?.message || 'Kreditdaten konnten nicht geladen werden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [refreshTick])

  useEffect(() => {
    const unsubscribe = subscribeCreditRefresh(() => setRefreshTick((value) => value + 1))
    return unsubscribe
  }, [])

  const mergedUsers = useMemo(() => {
    const billingMap = new Map((billingUsers || []).map((row) => [String(row.id), row]))
    const merged = (backendUsers || []).map((user) => {
      const billing = billingMap.get(String(user.id)) || {}
      return {
        ...user,
        ...billing,
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        current_balance: billing.current_balance ?? 0,
        total_credits_used: billing.total_credits_used ?? 0,
        total_credits_purchased: billing.total_credits_purchased ?? 0,
        last_activity_at: billing.last_activity_at ?? null,
      }
    })

    for (const row of billingUsers || []) {
      if (merged.some((user) => String(user.id) === String(row.id))) continue
      merged.push(row)
    }

    const query = search.trim().toLowerCase()
    if (!query) return merged
    return merged.filter((user) => {
      const haystack = [user.id, user.username, user.display_name, user.email, user.role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [backendUsers, billingUsers, search])

  const selectedUser = useMemo(
    () => mergedUsers.find((user) => String(user.id) === String(selectedUserId)) || null,
    [mergedUsers, selectedUserId],
  )

  useEffect(() => {
    if (!selectedUser) {
      setTransactions([])
      return undefined
    }

    let alive = true
    setTransactionsLoading(true)
    billingApi.getTransactions(selectedUser.id)
      .then((result) => {
        if (!alive) return
        setTransactions(result.data || [])
      })
      .catch((err) => {
        if (!alive) return
        setTransactions([])
        setError(err?.message || 'Transaktionen konnten nicht geladen werden')
      })
      .finally(() => {
        if (alive) setTransactionsLoading(false)
      })

    return () => {
      alive = false
    }
  }, [selectedUser?.id])

  const openTopUp = () => {
    if (!selectedUser) return
    setTopUpAmount('')
    setTopUpReason('Manuelle Guthabenanpassung')
    setTopUpPin('')
    setTopUpOpen(true)
  }

  const submitTopUp = async (event) => {
    event.preventDefault()
    if (!selectedUser) return
    setTopUpSaving(true)
    setError('')
    try {
      await billingApi.topUp({
        userId: selectedUser.id,
        amount: topUpAmount,
        reason: topUpReason,
        adminPin: topUpPin,
      })
      setTopUpOpen(false)
      setTopUpAmount('')
      setTopUpReason('Manuelle Guthabenanpassung')
      setTopUpPin('')
      setRefreshTick((value) => value + 1)
    } catch (err) {
      setError(err?.message || 'Top-up fehlgeschlagen')
    } finally {
      setTopUpSaving(false)
    }
  }

  return (
    <PageContainer width="content" className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#0071e3] dark:text-[#0a84ff]">{t('credits.section_label')}</p>
          <h1 className="mt-2 text-[26px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">
            {t('credits.page_title')}
          </h1>
          <p className="mt-2 text-[15px] text-gray-500 dark:text-gray-400 max-w-2xl">
            {t('credits.page_subtitle')}
          </p>
        </div>

        <div className="w-full lg:w-[360px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('credits.search_placeholder')}
            aria-label="Nutzer suchen"
          />
        </div>
      </div>

      {error && (
        <Card className="border-[#ff3b30]/20 bg-[#ff3b30]/5 text-[#b42318] dark:text-[#ffb4b0]">
          {error}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center text-[#0071e3]">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Verbrauchte Credits</div>
            <div className="mt-1 text-[28px] font-semibold text-black dark:text-white tabular-nums">{formatCredits(overview?.total_consumed)}</div>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#34c759]/10 flex items-center justify-center text-[#34c759]">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Übrige Credits</div>
            <div className="mt-1 text-[28px] font-semibold text-black dark:text-white tabular-nums">{formatCredits(overview?.total_outstanding)}</div>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 flex items-center justify-center text-[#ff9f0a]">
            <BadgeEuro className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ausgegeben</div>
            <div className="mt-1 text-[28px] font-semibold text-black dark:text-white tabular-nums">{formatCredits(overview?.total_purchased)}</div>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center text-black dark:text-white">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Nutzer</div>
            <div className="mt-1 text-[28px] font-semibold text-black dark:text-white tabular-nums">{overview?.user_count ?? 0}</div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('credits.users_section_title')}</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('credits.users_section_subtitle')}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setRefreshTick((value) => value + 1)} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Aktualisieren
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-2">{t('credits.table_user')}</th>
                  <th className="px-4 py-2">{t('credits.table_consumed')}</th>
                  <th className="px-4 py-2">{t('credits.table_balance')}</th>
                  <th className="px-4 py-2">{t('credits.table_last_activity')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4" className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{t('credits.loading')}</td>
                  </tr>
                ) : mergedUsers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">{t('credits.no_users')}</td>
                  </tr>
                ) : (
                  mergedUsers.map((user) => {
                    const isSelected = String(user.id) === String(selectedUserId)
                    return (
                      <tr
                        key={user.id}
                        onClick={() => setSelectedUserId(user.id)}
                        className={`cursor-pointer transition-colors ${isSelected ? 'bg-[#0071e3]/5 dark:bg-[#0a84ff]/10' : 'hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'}`}
                      >
                        <td className="px-4 py-4 rounded-l-2xl">
                          <div className="font-semibold text-black dark:text-white">{user.id} / {user.username || '—'}</div>
                          <div className="text-[13px] text-gray-500 dark:text-gray-400">{user.display_name || user.role || '—'}</div>
                        </td>
                        <td className="px-4 py-4 text-black dark:text-white tabular-nums">{formatCredits(user.total_credits_used)}</td>
                        <td className="px-4 py-4 text-black dark:text-white tabular-nums">{formatCredits(user.current_balance)}</td>
                        <td className="px-4 py-4 rounded-r-2xl text-gray-600 dark:text-gray-300">{formatDate(user.last_activity_at)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('credits.details_section_title')}</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('credits.details_section_subtitle')}</p>
            </div>
            {selectedUser && (
              <Button variant="dark" size="sm" onClick={openTopUp}>
                <Plus className="w-4 h-4" />
                {t('credits.top_up')}
              </Button>
            )}
          </div>

          {!selectedUser ? (
            <div className="rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e] px-5 py-10 text-center text-gray-500 dark:text-gray-400">
              {t('credits.select_user')}
            </div>
          ) : (
            <>
              <div className="rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e] p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[#0071e3]">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-black dark:text-white">{selectedUser.display_name || selectedUser.username || `User ${selectedUser.id}`}</div>
                    <div className="text-[13px] text-gray-500 dark:text-gray-400">{selectedUser.username || '—'} · ID {selectedUser.id}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[14px]">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Verbrauchte Credits</div>
                    <div className="font-semibold text-black dark:text-white tabular-nums">{formatCredits(selectedUser.total_credits_used)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400">Aktuelles Guthaben</div>
                    <div className="font-semibold text-black dark:text-white tabular-nums">{formatCredits(selectedUser.current_balance)}</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[16px] font-semibold text-black dark:text-white flex items-center gap-2"><Clock3 className="w-4 h-4" />{t('credits.transactions_title')}</h3>
                  {transactionsLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                </div>
                <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                  {transactions.length === 0 ? (
                    <div className="rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-6 text-center text-gray-500 dark:text-gray-400">{t('credits.no_transactions')}</div>
                  ) : (
                    transactions.map((transaction) => (
                      <div key={transaction.id} className="rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3 flex items-start justify-between gap-4">
                        <div>
                          <div className="font-semibold text-black dark:text-white">{transaction.action_type}</div>
                          <div className="text-[13px] text-gray-500 dark:text-gray-400">{transaction.note || '—'}</div>
                          <div className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">{formatDate(transaction.created_at)}</div>
                        </div>
                        <div className="text-right">
                          <div className={`font-semibold tabular-nums ${Number(transaction.amount || 0) < 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>
                            {Number(transaction.amount || 0) < 0 ? '' : '+'}{formatCredits(transaction.amount)}
                          </div>
                          <div className="text-[12px] text-gray-500 dark:text-gray-400">Saldo: {formatCredits(transaction.balance_after)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {selectedUser && topUpOpen && (
        <Modal
          open={topUpOpen}
          onClose={() => setTopUpOpen(false)}
          title={t('credits.top_up_title')}
          subtitle={`${selectedUser.display_name || selectedUser.username || `User ${selectedUser.id}`} · ID ${selectedUser.id}`}
          size="md"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setTopUpOpen(false)} disabled={topUpSaving}>Abbrechen</Button>
              <Button variant="dark" onClick={submitTopUp} disabled={topUpSaving}>
                {topUpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Speichern
              </Button>
            </>
          )}
        >
          <form className="space-y-5" onSubmit={submitTopUp}>
            <Input label="Betrag" type="number" step="0.1" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="z. B. 10.0" required />
            <Input label="Grund / Notiz" value={topUpReason} onChange={(e) => setTopUpReason(e.target.value)} placeholder="Warum werden Credits angepasst?" required />
            <Input label="Admin PIN" type="password" value={topUpPin} onChange={(e) => setTopUpPin(e.target.value)} placeholder="Admin PIN eingeben" required />
            <div className="rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3 text-[13px] text-gray-600 dark:text-gray-300">
              Positive Beträge erhöhen das Guthaben, negative Beträge korrigieren es. Die Änderung wird als <span className="font-semibold">ADMIN_TOPUP</span> im Ledger protokolliert.
            </div>
          </form>
        </Modal>
      )}
    </PageContainer>
  )
}