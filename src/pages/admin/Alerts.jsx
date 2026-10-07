import { useEffect, useState } from 'react'
import { Bell, CheckCircle, AlertTriangle, Send, Search } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import AdminLayout from '../../components/admin/AdminLayout'
import Checkbox from '../../components/ui/Checkbox'
import { useAlertSettings, useUpdateAlertSettings, telegramAction } from '../../hooks/useAlertSettings'

const KINDS = [
  { key: 'orders', label: 'New orders (with low stock)' },
  { key: 'eft', label: 'EFT proof of payment uploaded' },
  { key: 'deliveries', label: 'Driver set off / delivered' },
  { key: 'reviews', label: 'Review waiting for approval' },
  { key: 'memberships', label: 'Membership applications' },
  { key: 'daily', label: 'Daily summary at 07:00' },
]

function Step({ n, done, title, children }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-4 sm:p-6">
      <h2 className="flex items-center gap-3 font-semibold text-white uppercase tracking-widest text-sm mb-4">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${done ? 'bg-green-500/10 text-green-400' : 'bg-gold/10 text-gold'}`} aria-hidden="true">
          {done ? <CheckCircle size={16} /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function Alerts() {
  const { data: s, isLoading, isError, refetch } = useAlertSettings()
  const update = useUpdateAlertSettings()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(null)
  const [bot, setBot] = useState(null)
  const [chats, setChats] = useState(null)

  useEffect(() => {
    document.title = 'Alerts | 224 Admin'
  }, [])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alert-settings'] })

  const run = async (label, fn) => {
    setBusy(label)
    try { await fn() } catch (err) { toast.error(err.message || 'Something went wrong') } finally { setBusy(null) }
  }

  const saveToken = (e) => {
    e.preventDefault()
    run('token', async () => {
      const res = await telegramAction({ action: 'save_token', token: token.trim() })
      setToken('')
      setBot(res.botUsername)
      setChats(null)
      toast.success(`Bot @${res.botUsername} connected`)
      refresh()
    })
  }

  const findChats = () => run('find', async () => {
    const res = await telegramAction({ action: 'find_chats' })
    setBot(res.botUsername)
    setChats(res.chats)
    if (res.chats.length === 0) toast('No groups found yet — add the bot to your group and send /start there, then try again.', { icon: 'ℹ️' })
  })

  const pick = (chat) => run(`pick-${chat.id}`, async () => {
    await telegramAction({ action: 'select_chat', chatId: chat.id })
    toast.success(`Alerts will go to "${chat.title}". Check the group for the test message.`)
    setChats(null)
    refresh()
  })

  const test = () => run('test', async () => {
    await telegramAction({ action: 'test' })
    toast.success('Test message sent')
  })

  const setKind = (key, on) => update.mutate({ kinds: { ...(s?.kinds ?? {}), [key]: on } })

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-2">
        <Bell size={22} className="text-gold" />
        <h1 className="font-heading text-3xl font-bold text-white">Alerts</h1>
      </div>
      <p className="text-muted text-sm mb-6 max-w-2xl">
        Get the club's alerts in a Telegram group as well as by email — free, instant, and everyone on the team sees them.
      </p>

      {isLoading ? (
        <div className="space-y-4">{[0, 1, 2].map(i => <div key={i} className="h-32 skeleton rounded-xl" />)}</div>
      ) : isError ? (
        <div className="bg-surface border border-red-500/20 rounded-2xl p-8 text-center max-w-md">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-white text-sm mb-5">Couldn't load alert settings.</p>
          <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
        </div>
      ) : (
        <div className="space-y-4 max-w-2xl">
          <Step n={1} done={s.has_token} title="Create the bot">
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted mb-4">
              <li>In Telegram, open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-2">@BotFather</a> and send <span className="font-mono text-white">/newbot</span>.</li>
              <li>Give it a name (e.g. <span className="text-white">224 Clubhouse Alerts</span>) and a username ending in <span className="font-mono text-white">bot</span>.</li>
              <li>BotFather replies with a token like <span className="font-mono text-white">123456:ABC…</span>. Paste it below.</li>
            </ol>
            <form onSubmit={saveToken} className="flex flex-col sm:flex-row gap-2">
              <label htmlFor="tg-token" className="sr-only">Bot token</label>
              <input id="tg-token" type="password" autoComplete="off" spellCheck={false} value={token}
                onChange={e => setToken(e.target.value)} placeholder={s.has_token ? 'Token saved — paste a new one to replace it' : 'Paste the bot token'}
                className="input-base text-sm flex-1" />
              <button type="submit" disabled={!token.trim() || busy === 'token'} className="btn-outline h-11 px-5 text-sm disabled:opacity-50">
                {busy === 'token' ? 'Checking…' : 'Save token'}
              </button>
            </form>
            <p className="text-muted text-xs mt-2">Stored encrypted on the server. It's never shown again.</p>
          </Step>

          <Step n={2} done={Boolean(s.chat_id)} title="Connect your group">
            {s.chat_id ? (
              <p className="text-sm text-white mb-3">Sending to <span className="font-semibold">{s.chat_title}</span>.</p>
            ) : null}
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted mb-4">
              <li>Open your staff group in Telegram → group name → <span className="text-white">Add members</span> → search for your bot{bot ? <> (<span className="font-mono text-white">@{bot}</span>)</> : ''} and add it.</li>
              <li>In the group, send <span className="font-mono text-white">/start</span>.</li>
              <li>Tap <span className="text-white">Find my group</span> and pick it. A test message will appear in the group.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={findChats} disabled={!s.has_token || busy === 'find'}
                className="btn-outline h-11 px-5 text-sm inline-flex items-center gap-2 disabled:opacity-50">
                <Search size={15} /> {busy === 'find' ? 'Looking…' : 'Find my group'}
              </button>
              {s.chat_id && (
                <button type="button" onClick={test} disabled={busy === 'test'}
                  className="btn-outline h-11 px-5 text-sm inline-flex items-center gap-2 disabled:opacity-50">
                  <Send size={15} /> {busy === 'test' ? 'Sending…' : 'Send test'}
                </button>
              )}
            </div>
            {chats && chats.length > 0 && (
              <ul className="mt-4 space-y-2">
                {chats.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-3 border border-border rounded-xl p-3">
                    <span className="text-white text-sm truncate">{c.title}</span>
                    <button type="button" onClick={() => pick(c)} disabled={busy === `pick-${c.id}`}
                      className="btn-gold h-11 px-4 text-sm shrink-0">Use this group</button>
                  </li>
                ))}
              </ul>
            )}
          </Step>

          <Step n={3} done={s.enabled} title="Choose what to send">
            <div className="mb-4">
              <Checkbox id="tg-enabled" checked={s.enabled} onChange={v => update.mutate({ enabled: v })}>
                <span className="text-white">Send alerts to Telegram</span>
              </Checkbox>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {KINDS.map(k => (
                <Checkbox key={k.key} id={`tg-kind-${k.key}`} checked={s.kinds?.[k.key] !== false} onChange={v => setKind(k.key, v)}>
                  <span className="text-muted">{k.label}</span>
                </Checkbox>
              ))}
            </div>
            <p className="text-muted text-xs mt-4">
              Group messages never include ID numbers or dates of birth. Email alerts to 224clubhous@gmail.com carry on as before.
            </p>
          </Step>
        </div>
      )}
    </AdminLayout>
  )
}
