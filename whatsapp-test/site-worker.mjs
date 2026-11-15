import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import * as baileys from 'baileys'
import pino from 'pino'
import { bindCommands } from './messages.mjs'
import { createPairingHandler } from './pairing.mjs'

try { loadEnvFile(new URL('../.env', import.meta.url)) } catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const { BOT_CONNECT_URL, BOT_CONNECT_PUBLISHABLE_KEY, BOT_CONNECT_WORKER_KEY } = process.env
const url = URL.parse(BOT_CONNECT_URL ?? '')
if (url?.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || !BOT_CONNECT_PUBLISHABLE_KEY || !/^[a-f0-9]{64}$/.test(BOT_CONNECT_WORKER_KEY ?? '')) {
  throw new Error('Configuration Bot Connect manquante.')
}

const worker = randomUUID()
const sessions = new Map()
const logger = pino({ level: 'silent' })
const rootPath = fileURLToPath(new URL('./sessions/site/domma/', import.meta.url))
const stop = new AbortController()
const halt = () => stop.abort()
process.once('SIGINT', halt)
process.once('SIGTERM', halt)

async function rpc(method, payload) {
  const response = await fetch(new URL(`/rest/v1/rpc/bot_connect_worker_${method}`, url), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
    headers: { apikey: BOT_CONNECT_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_bot: 'domma', p_key: BOT_CONNECT_WORKER_KEY, p_worker: worker, ...payload }),
  })
  if (!response.ok) throw new Error(`Bot Connect HTTP ${response.status}`)
  return response.json()
}

function report(session, status, code) {
  session.update = { p_id: session.id, p_status: status, p_code: code ?? null }
}

async function closeSession(session) {
  sessions.delete(session.id)
  session.socket?.end(undefined)
  session.socket = null
  await session.saving
}

async function openSession(session) {
  const dir = join(rootPath, session.id)
  const marker = join(dir, '.requested-at')
  const previous = await readFile(marker, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })
  if (previous !== session.requestedAt && session.status !== 'connected') {
    await rm(dir, { recursive: true, force: true })
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(marker, session.requestedAt, { mode: 0o600 })
  const { state, saveCreds } = await baileys.useMultiFileAuthState(dir)
  if (stop.signal.aborted) return
  const socket = baileys.makeWASocket({ auth: state, logger, connectTimeoutMs: 15000, markOnlineOnConnect: false, shouldSyncHistoryMessage: () => false })
  session.socket = socket
  const isCurrent = () => !stop.signal.aborted && sessions.get(session.id) === session && session.socket === socket
  socket.ev.on('creds.update', () => {
    session.saving = session.saving.then(saveCreds).catch(() => console.error('Bot Connect : sauvegarde de session indisponible.'))
  })
  const onMessages = bindCommands(socket, baileys, undefined, session.phone)
  socket.ev.on('messages.upsert', event => { if (isCurrent() && session.active) void onMessages(event).catch(() => {}) })
  const pairing = createPairingHandler(socket, session.phone, {
    isCurrent,
    onCode: code => report(session, 'pairing', code.replaceAll('-', '').toUpperCase()),
    onError: () => console.error('Bot Connect : demande de code indisponible, nouvel essai à la prochaine mise à jour WhatsApp.'),
  })
  socket.ev.on('connection.update', event => {
    if (!isCurrent()) return
    void pairing(event)
    if (event.connection === 'open') {
      session.active = true
      session.delay = 1000
      report(session, 'connected')
    } else if (event.connection === 'close') {
      session.socket = null
      session.active = false
      const reason = event.lastDisconnect?.error?.output?.statusCode
      if ([401, 403, 411, 440, 500].includes(reason)) report(session, 'disconnected')
      else {
        session.nextAttempt = Date.now() + (reason === baileys.DisconnectReason.restartRequired ? 0 : session.delay)
        session.delay = Math.min(session.delay * 2, 15000)
      }
    }
  })
}

let lastPoll = 0
console.log('Bot Connect : service Domma démarré.')

try {
  while (!stop.signal.aborted) {
    try {
      const rows = await rpc('poll', { p_ids: [...sessions.keys()] })
      if (!lastPoll) console.log('Bot Connect : catalogue Domma disponible.')
      lastPoll = Date.now()
      const ids = new Set(rows.map(row => row.id))
      for (const session of sessions.values()) {
        if (!ids.has(session.id)) await closeSession(session)
      }

      for (const row of rows) {
        let session = sessions.get(row.id)
        if (session && session.requestedAt !== row.requestedAt) {
          await closeSession(session)
          session = undefined
        }
        if (!session) {
          session = { ...row, saving: Promise.resolve(), nextAttempt: 0, delay: 1000 }
          sessions.set(row.id, session)
        }
        if (session.update) {
          const update = session.update
          const accepted = await rpc('update', update)
          if (session.update === update) session.update = null
          if (!accepted || update.p_status === 'disconnected') { await closeSession(session); continue }
        }
        if (!session.socket && Date.now() >= session.nextAttempt) {
          await session.saving
          await openSession(session)
        }
      }
    } catch {
      if (lastPoll && Date.now() - lastPoll > 25000) {
        await Promise.all([...sessions.values()].map(closeSession))
        lastPoll = 0
      }
    }
    await sleep(2500, undefined, { signal: stop.signal }).catch(() => {})
  }
} finally {
  await Promise.all([...sessions.values()].map(closeSession))
}
