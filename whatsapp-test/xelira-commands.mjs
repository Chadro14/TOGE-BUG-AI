import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { MemeInputError } from '../doma-commandes.cjs'
import { handleDomaMessage, parseDomaCommand } from '../test/doma-message-handler.cjs'
import { accountTools } from './account-tools.mjs'
import { containsViewOnce, downloadCommandMedia, getMedia } from './messages.mjs'
import { extraCommands, runExtra, sharedCommands } from './xelira-tools.mjs'
import { settingsCommands, xeliraSettings } from './xelira-settings.mjs'

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
  ['spotify', 'Rechercher un titre et ouvrir Spotify'],
  ['instagram', 'Télécharger une vidéo Instagram publique'],
  ['facebook', 'Télécharger une vidéo Facebook publique'],
  ['twitter', 'Télécharger une vidéo publique sur X'],
  ['video', 'Télécharger une vidéo avec un lien compatible'],
  ...Array.from(sharedCommands, ([name, [, description]]) => [name, description]),
  ...extraCommands,
  ...settingsCommands,
])

const aliases = new Map([
  ['ai', 'ia'], ['ozyra', 'ia'], ['meteo', 'weather'], ['météo', 'weather'],
  ['mf', 'mediafire'], ['ig', 'instagram'], ['insta', 'instagram'], ['fb', 'facebook'],
  ['x', 'twitter'], ['dp', 'getpp'], ['setantilink', 'antilink'], ['pin', 'pinterest'],
])

export const xeliraCommandCount = commands.size

function publicVideoUrl(input) {
  const url = URL.parse(input)
  if (url?.protocol !== 'https:' || url.username || url.password || url.port) return
  let platform
  if ((url.host === 'www.tiktok.com' && /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname)) ||
      (['vm.tiktok.com', 'vt.tiktok.com'].includes(url.host) && /^\/\w+\/?$/.test(url.pathname))) platform = 'tiktok'
  if (['instagram.com', 'www.instagram.com'].includes(url.host) && /^\/(?:p|reel|tv)\/[\w-]+\/?$/.test(url.pathname)) platform = 'instagram'
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.host) && /^\/[\w]+\/status\/\d+\/?$/.test(url.pathname)) platform = 'twitter'
  if (['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.host)
      && (/^\/(?:reel|(?:[\w.-]+\/)?videos)\/\d+\/?$/.test(url.pathname)
        || (url.pathname === '/watch/' && /^\d+$/.test(url.searchParams.get('v') ?? '')))) platform = 'facebook'
  if (!platform) return
  const facebookId = platform === 'facebook' && url.pathname === '/watch/' ? url.searchParams.get('v') : null
  url.search = ''
  if (facebookId) url.searchParams.set('v', facebookId)
  url.hash = ''
  return { platform, url: url.href }
}

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

async function downloadPublicVideo(url) {
  if (videoJobs >= 2) return null
  videoJobs++
  let dir
  try {
    dir = await mkdtemp(join(tmpdir(), 'xelira-video-'))
    const output = join(dir, 'video.mp4')
    await run('yt-dlp', [
      '--ignore-config', '--no-playlist', '--socket-timeout', '8', '--retries', '0',
      '--restrict-filenames', '--no-progress',
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

export function bindXeliraCommands(socket, baileys, dir, log = () => {}, request = fetch, isActive = () => true) {
  const seen = new Set()
  const games = new Map()
  const toolsReady = accountTools(socket, baileys, dir, log)
  const settingsReady = xeliraSettings(socket, baileys, dir, log, isActive)
  const startedAt = Math.floor(Date.now() / 1000)
  return async function receive({ type, messages, requestId }) {
    if (!socket.user || !['notify', 'append'].includes(type)) return
    const [tools, settings] = await Promise.all([toolsReady, settingsReady])
    const ownJids = new Set([socket.user.id, socket.user.lid].filter(Boolean).map(baileys.jidNormalizedUser))
    for (const message of messages) {
      const key = message.key
      const jid = key?.remoteJid
      if (type === 'notify' && !requestId && message.message && key && !key.fromMe
          && Number(message.messageTimestamp) >= startedAt) {
        await tools.onIncoming(message)?.catch(() => log('Xelira MD : traitement automatique indisponible.'))
      }
      if (!key?.id || !jid || !(baileys.isPnUser(jid) || baileys.isLidUser(jid) || baileys.isJidGroup(jid))) continue
      if ((type === 'append' || requestId) && (!key.fromMe || !(Number(message.messageTimestamp) >= startedAt))) continue
      const content = baileys.normalizeMessageContent(message.message)
      const media = containsViewOnce(message.message) ? undefined : getMedia(content)
      const raw = content?.conversation ?? content?.extendedTextMessage?.text ?? media?.msg.caption
      const body = raw?.trim() ?? ''
      if (type === 'notify' && !requestId && Number(message.messageTimestamp) >= startedAt
          && await settings.moderateInvitation(key, body, ownJids).catch(() => false)) continue
      if (!body.startsWith(settings.state.prefix)) continue
      const [, name, args = ''] = /^(\S+)(?:\s+([\s\S]+))?$/u.exec(body.slice(1)) ?? []
      const normalized = name?.normalize('NFKC').toLowerCase()
      const command = aliases.get(normalized) ?? normalized
      if (!commands.has(command)) continue
      if (!key.fromMe && !settings.state.public && command !== 'ia') continue
      const messageId = `${jid}\0${key.participant ?? ''}\0${key.id}`
      if (seen.has(messageId)) continue
      if (seen.size >= 128) seen.delete(seen.values().next().value)
      seen.add(messageId)
      const reply = text => socket.sendMessage(jid, { text, linkPreview: null })
      const context = content?.extendedTextMessage?.contextInfo ?? media?.msg.contextInfo
      const canUseQuotedMessage = Boolean(context?.quotedMessage) && !containsViewOnce(context.quotedMessage)
      const quoted = canUseQuotedMessage ? getMedia(baileys.normalizeMessageContent(context.quotedMessage)) : undefined
      const senderIds = baileys.isJidGroup(jid) ? [key.participant, key.participantAlt] : [jid, key.remoteJidAlt]
      const quotedId = context?.participant && baileys.jidNormalizedUser(context.participant)
      const ownsQuote = Boolean(quotedId && (key.fromMe ? ownJids.has(quotedId) : senderIds.some(id => id && baileys.jidNormalizedUser(id) === quotedId)))
      const ownChat = [jid, key.remoteJidAlt].some(id => id && ownJids.has(baileys.jidNormalizedUser(id)))
      const downloadMedia = (source, max) => downloadCommandMedia(baileys.downloadContentFromMessage, source, max)
      try {
        if (command === 'menu') {
          await reply(['*Xelira MD · Bot Connect*', `${xeliraCommandCount} commandes`, '', ...Array.from(commands, ([name, description]) => `${settings.state.prefix}${name} · ${description}`)].join('\n'))
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
        } else if (['tiktok', 'instagram', 'facebook', 'twitter', 'video'].includes(command)) {
          const link = publicVideoUrl(args)
          if (!link || (command !== 'video' && command !== link.platform)) throw new MemeInputError(`Utilise .${command} avec un lien HTTPS vers une vidéo publique compatible.`)
          const video = await downloadPublicVideo(link.url)
          if (video) await socket.sendMessage(jid, { video, mimetype: 'video/mp4' })
          else await reply('Les téléchargements sont occupés. Réessaie dans un instant.')
        } else if (settingsCommands.has(command)) {
          await settings.run(command, args, { jid, ownChat, key, ownJids, reply })
        } else if (extraCommands.has(command)) {
          await runExtra(command, args, { socket, baileys, jid, key, reply, context, games, ownJids, ownsQuote, canUseQuotedMessage,
            source: media ?? quoted, ownSource: Boolean(media || ownsQuote), downloadMedia })
        } else {
          const mapped = command === 'spotify' ? 'spotify' : sharedCommands.get(command)[0]
          const parsed = parseDomaCommand(`.${mapped} ${args}`)
          if (parsed.command.selfOnly && !(key.fromMe && ownChat)) continue
          if (parsed.command.groupOnly && (!key.fromMe || !baileys.isJidGroup(jid))) continue
          await handleDomaMessage({ chat: jid, ...media, quoted: !parsed.command.requireOwnMedia || ownsQuote ? quoted : undefined }, {
            downloadMedia, request, send: (chat, payload) => socket.sendMessage(chat, payload),
            whatsapp: (name, args) => tools.run(name, args, {
              jid, ownJids, quotedJid: context?.participant, mentionedJids: context?.mentionedJid ?? [],
            }),
            onCommandError: name => log(`Xelira MD : échec de .${name}.`),
          }, parsed)
        }
      } catch (error) {
        log(`Xelira MD : échec de .${command}.`)
        const explanation = error instanceof MemeInputError ? error.message
          : command === 'ia' ? contact : 'Cette commande a échoué. Réessaie dans un instant.'
        await reply(explanation).catch(() => {})
      }
    }
  }
}
