import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const OZYRA_PHONE = '243861009310'
const allowedAI = new Set([OZYRA_PHONE, '243834978922'])
const contact = 'Contacte Ozyra au +243 861 009 310\nhttps://wa.me/243861009310'
const maxVideoBytes = 20 * 1024 * 1024
const run = promisify(execFile)
const binPath = fileURLToPath(new URL('../bin', import.meta.url))
let videoJobs = 0

const commands = new Map([
  ['menu', 'Afficher les commandes'],
  ['ping', 'Vérifier que Xelira MD répond'],
  ['ia', 'Écrire à Ozyra'],
  ['tiktok', 'Télécharger une vidéo TikTok publique'],
  ['apk', 'Chercher une application sur Google Play'],
  ['mediafire', 'Ouvrir la page de téléchargement d’un fichier MediaFire'],
])

async function senderPhone(socket, baileys, key) {
  const jids = key.fromMe ? [socket.user.id, socket.user.lid]
    : baileys.isJidGroup(key.remoteJid) ? [key.participant, key.participantAlt] : [key.remoteJid, key.remoteJidAlt]
  for (const jid of jids) {
    const normalized = baileys.jidNormalizedUser(jid)
    if (baileys.isPnUser(normalized)) return normalized.split('@')[0]
  }
  const lid = jids.find(jid => baileys.isLidUser(jid))
  if (!lid) return null
  const pn = baileys.jidNormalizedUser(await socket.signalRepository?.lidMapping?.getPNForLID(lid))
  return baileys.isPnUser(pn) ? pn.split('@')[0] : null
}

async function askOzyra(question, request) {
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) return `L’IA de cette instance est momentanément indisponible.\n\n${contact}`
  if (!question || question.length > 2000) return 'Écris .ia suivi d’une question de 2 000 caractères maximum.'
  const response = await request('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'Tu es Ozyra, l’assistant de Xelira Studio. Réponds dans la langue du message.' },
        { role: 'user', content: question },
      ],
      max_completion_tokens: 480,
    }),
  })
  if (!response.ok) throw Error('Service Ozyra indisponible')
  const answer = (await response.json()).choices?.[0]?.message?.content?.trim()
  if (!answer) throw Error('Réponse Ozyra vide')
  return answer
}

async function downloadTikTok(url) {
  if (videoJobs >= 2) return null
  videoJobs++
  let dir
  try {
    dir = await mkdtemp(join(tmpdir(), 'xelira-tiktok-'))
    const output = join(dir, 'video.mp4')
    await run('yt-dlp', [
      '--ignore-config', '--no-playlist', '--socket-timeout', '8', '--retries', '0',
      '--max-filesize', String(maxVideoBytes), '-f', 'b[ext=mp4][height<=720]/b[ext=mp4]',
      '-o', output, '--', url,
    ], {
      env: { PATH: [binPath, process.env.PATH].filter(Boolean).join(delimiter) },
      timeout: 30000, maxBuffer: 128 * 1024,
    })
    const size = (await stat(output)).size
    if (size === 0 || size > maxVideoBytes) throw Error('Vidéo trop grande')
    return await readFile(output)
  } finally {
    videoJobs--
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}

export function bindXeliraCommands(socket, baileys, _dir, log = () => {}, request = fetch) {
  const seen = new Set()
  const startedAt = Math.floor(Date.now() / 1000)
  return async function receive({ type, messages, requestId }) {
    if (!socket.user || !['notify', 'append'].includes(type)) return
    for (const message of messages) {
      const key = message.key
      const jid = key?.remoteJid
      if (!key?.id || !jid || !(baileys.isPnUser(jid) || baileys.isLidUser(jid) || baileys.isJidGroup(jid))) continue
      if ((type === 'append' || requestId) && (!key.fromMe || !(Number(message.messageTimestamp) >= startedAt))) continue
      const content = baileys.normalizeMessageContent(message.message)
      const raw = content?.conversation ?? content?.extendedTextMessage?.text
      const [, name, args = ''] = /^\.(\w+)(?:\s+([\s\S]+))?$/u.exec(raw?.trim() ?? '') ?? []
      const normalized = name?.toLowerCase()
      const command = ['ai', 'ozyra'].includes(normalized) ? 'ia' : normalized
      if (!commands.has(command)) continue
      const messageId = `${jid}\0${key.participant ?? ''}\0${key.id}`
      if (seen.has(messageId)) continue
      if (seen.size >= 128) seen.delete(seen.values().next().value)
      seen.add(messageId)
      const reply = text => socket.sendMessage(jid, { text, linkPreview: null })
      try {
        if (command === 'menu') {
          await reply(['*Xelira MD · Bot Connect*', ...Array.from(commands, ([name, description]) => `.${name} · ${description}`)].join('\n'))
        } else if (command === 'ping') {
          await reply('Xelira MD est en ligne.')
        } else if (command === 'ia') {
          const phone = await senderPhone(socket, baileys, key)
          await reply(allowedAI.has(phone) ? await askOzyra(args, request) : contact)
        } else if (command === 'apk') {
          if (!args || args.length > 160) await reply('Écris .apk suivi du nom de l’application.')
          else await reply(`Google Play\nhttps://play.google.com/store/search?${new URLSearchParams({ q: args, c: 'apps' })}`)
        } else if (command === 'mediafire') {
          const url = URL.parse(args)
          const file = url?.pathname.match(/^\/file\/([a-z0-9]+)(?:\/|$)/i)
          if (url?.protocol !== 'https:' || !['mediafire.com', 'www.mediafire.com'].includes(url.host) || !file) {
            await reply('Écris .mediafire suivi d’un lien HTTPS vers un fichier MediaFire.')
          } else {
            await reply(`Télécharger sur MediaFire\nhttps://www.mediafire.com/file/${file[1]}/file`)
          }
        } else if (command === 'tiktok') {
          const url = URL.parse(args)
          const valid = url?.protocol === 'https:' && !url.username && !url.password && (
            (url.host === 'www.tiktok.com' && /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname)) ||
            (['vm.tiktok.com', 'vt.tiktok.com'].includes(url.host) && /^\/[\w]+\/?$/.test(url.pathname))
          )
          if (!valid) {
            await reply('Écris .tiktok suivi du lien HTTPS d’une vidéo TikTok publique.')
            continue
          }
          url.search = ''
          url.hash = ''
          const video = await downloadTikTok(url.href)
          if (video) await socket.sendMessage(jid, { video, mimetype: 'video/mp4' })
          else await reply('Les téléchargements sont occupés. Réessaie dans un instant.')
        }
      } catch {
        log(`Xelira MD : échec de .${command}.`)
        await reply(command === 'ia' ? contact : 'Cette commande a échoué. Réessaie dans un instant.').catch(() => {})
      }
    }
  }
}
