'use strict'

const { menu, fancy, formatReply, createMeme, uploadMedia, MemeInputError, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } = require('../doma-commandes.cjs')
const { createStaticSticker } = require('./doma-sticker.cjs')
const { mixEmojis, telegramSticker, youtubeMedia, searchYouTube, convertAudio } = require('./doma-media.cjs')

const audioEffects = {
  bass: 'bass=g=9',
  blown: 'volume=2,alimiter=limit=0.8',
  deep: 'aresample=48000,asetrate=38000,aresample=48000',
  fast: 'atempo=1.5',
  fat: 'aresample=48000,asetrate=40000,aresample=48000,atempo=1.2',
  nightcore: 'aresample=48000,asetrate=60000,aresample=48000',
  reverse: 'areverse',
  robot: 'tremolo=f=40:d=0.85',
  slow: 'atempo=0.75',
  smooth: 'lowpass=f=4500',
  squirrel: 'aresample=48000,asetrate=72000,aresample=48000',
}

const commands = [
  { section: 'Principal', name: 'menu', aliases: ['allmenu'], run: showMenu },
  { section: 'Principal', name: 'alive', run: (_, { reply }) => reply('Domma est en ligne.') },
  { section: 'Principal', name: 'ping', run: (_, { reply, receivedAt }) => reply(`Temps de traitement · ${Math.round(performance.now() - receivedAt)} ms`) },
  { section: 'Principal', name: 'uptime', aliases: ['runtime'], run: showUptime },
  { section: 'Principal', name: 'owner', run: (_, { reply }) => reply('Créateur de Domma · Son Altesse') },
  { section: 'Principal', name: 'repo', run: (_, { reply }) => reply('https://github.com/Chadro14/TOGE-BUG-AI') },
  { section: 'Stickers', name: 'sticker', aliases: ['s'], run: makeSticker },
  { section: 'Stickers', name: 'smeme', usage: 'Haut|Bas', run: makeMeme },
  { section: 'Stickers', name: 'emojimix', usage: 'emoji + emoji', run: makeEmojiMix },
  { section: 'Stickers', name: 'telestick', usage: 'lien du pack', run: makeTelegramSticker },
  { section: 'YouTube', name: 'ytaudio', aliases: ['ytmp3'], usage: 'lien YouTube', run: sendYouTubeAudio },
  { section: 'YouTube', name: 'ytvideo', aliases: ['ytmp4'], usage: 'lien YouTube', run: sendYouTubeVideo },
  { section: 'YouTube', name: 'ytsearch', usage: 'titre à chercher', run: showYouTubeSearch },
  { section: 'Outils', name: 'tourl', run: shareMedia },
  { section: 'Texte', name: 'styletext', usage: 'texte', run: (args, { reply }) => reply(fancy(requireText(args, 'styletext'))) },
  { section: 'Texte', name: 'fliptext', usage: 'texte', run: flipText },
  { section: 'Texte', name: 'ebinary', usage: 'texte', run: encodeBinary },
  { section: 'Texte', name: 'dbinary', usage: 'groupes de 8 bits', run: decodeBinary },
  { section: 'Audio', name: 'toaudio', aliases: ['tomp3'], run: (_, context) => transformAudio(context) },
  { section: 'Audio', name: 'tovn', run: (_, context) => transformAudio(context, undefined, true) },
  ...Object.entries(audioEffects).map(([name, filter]) => ({
    section: 'Audio', name, run: (_, context) => transformAudio(context, filter),
  })),
]

const byName = new Map(commands.flatMap(command => [command.name, ...(command.aliases ?? [])].map(name => [name, command])))

function parseDomaCommand(body) {
  const [, name, args = ''] = /^\.(\S+)(?:\s+([\s\S]*))?$/u.exec(body?.trim() ?? '') ?? []
  const command = byName.get(name?.normalize('NFKC').toLowerCase())
  return command && { command, args }
}

async function showMenu(selected, { message, sendMenu }) {
  await sendMenu(message.chat, menu(commands, selected.toLowerCase()))
}

function requireText(args, name) {
  if (!args || Buffer.byteLength(args) > 360) {
    throw new MemeInputError(`Utilise .${name} suivi d’un texte court.`)
  }
  return args
}

async function flipText(args, { reply }) {
  const chars = new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(requireText(args, 'fliptext'))
  await reply(Array.from(chars, ({ segment }) => segment).reverse().join(''))
}

async function encodeBinary(args, { reply }) {
  const bytes = Buffer.from(requireText(args, 'ebinary'))
  await reply(Array.from(bytes, byte => byte.toString(2).padStart(8, '0')).join(' '))
}

async function decodeBinary(args, { reply }) {
  if (args.length > 3240 || !/^[01]{8}(?:\s+[01]{8})*$/.test(args)) {
    throw new MemeInputError('Utilise .dbinary suivi de groupes de 8 bits séparés par des espaces.')
  }
  const bytes = Buffer.from(args.split(/\s+/).map(byte => Number.parseInt(byte, 2)))
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new MemeInputError('Ces bits ne représentent pas un texte UTF-8 valide.')
  }
  await reply(decoded)
}

async function showYouTubeSearch(args, { reply }) {
  const results = await searchYouTube(requireText(args, 'ytsearch'))
  await reply(results.length ? results.map(({ title, url }) => `${title}\n${url}`).join('\n\n') : 'Aucun résultat trouvé.')
}

async function transformAudio({ message, downloadMedia, send }, filter, voiceNote = false) {
  const source = message.mtype ? message : message.quoted
  if (!['audioMessage', 'videoMessage'].includes(source?.mtype)) {
    throw new MemeInputError('Réponds à un audio ou à une vidéo avec cette commande.')
  }
  const input = await downloadMedia(source, MAX_UPLOAD_BYTES)
  const audio = await convertAudio(input, filter, voiceNote)
  await send({ audio, mimetype: voiceNote ? 'audio/ogg; codecs=opus' : 'audio/mpeg', ptt: voiceNote })
}

async function showUptime(_, { reply }) {
  const seconds = Math.floor(process.uptime())
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  await reply(`En ligne depuis ${hours} h ${minutes} min ${seconds % 60} s.`)
}

function imageSource(message, prompt) {
  const source = message.mtype ? message : message.quoted
  if (source?.mtype !== 'imageMessage') throw new MemeInputError(prompt)
  return source
}

async function makeSticker(_, { message, downloadMedia, sticker }) {
  const source = imageSource(message, 'Joins une image ou réponds à une image avec .sticker.')
  await sticker(await downloadMedia(source, MAX_IMAGE_BYTES))
}

async function makeMeme(caption, { message, downloadMedia, sticker, request }) {
  const source = imageSource(message, 'Joins une image ou réponds à une image avec .smeme Haut|Bas.')
  const image = await downloadMedia(source, MAX_IMAGE_BYTES)
  await sticker(await createMeme({ image, mime: source.msg.mimetype, caption, request }))
}

async function makeEmojiMix(args, { sticker, request }) {
  await sticker(await mixEmojis(args, request))
}

async function makeTelegramSticker(args, { sticker, request }) {
  await sticker(await telegramSticker(args, request))
}

async function shareMedia(_, { message, downloadMedia, reply, request }) {
  const source = message.mtype ? message : message.quoted
  if (!source) throw new MemeInputError('Joins un fichier ou réponds au média à partager avec .tourl.')
  const { mimetype, fileName } = source.msg
  const extension = /^[\w.+-]+\/([\w+-]+)/.exec(mimetype ?? '')?.[1] ?? 'bin'
  const filename = fileName || `media.${extension === 'jpeg' ? 'jpg' : extension}`
  const data = await downloadMedia(source, MAX_UPLOAD_BYTES)
  const url = await uploadMedia(data, mimetype || 'application/octet-stream', filename, request)
  await reply(`Lien temporaire\n${url}`)
}

async function sendYouTubeAudio(args, { send }) {
  await send({ audio: await youtubeMedia(args, true), mimetype: 'audio/mpeg' })
}

async function sendYouTubeVideo(args, { send }) {
  await send({ video: await youtubeMedia(args, false), mimetype: 'video/mp4', caption: 'Ta vidéo YouTube est prête.' })
}

async function handleDomaMessage(message, { downloadMedia, sendMenu, send, request = fetch, receivedAt = performance.now() }, parsed = parseDomaCommand(message.body)) {
  if (!parsed) return false
  const { command, args } = parsed
  const sendContent = async content => {
    if (content.caption) return send(message.chat, { ...content, caption: formatReply(command.name, content.caption) })
    await send(message.chat, content)
    const label = content.sticker ? 'Ton sticker est prêt.' : 'Ton audio est prêt.'
    await send(message.chat, { text: formatReply(command.name, label) }).catch(() => {})
  }
  const reply = (text, failed = false) => send(message.chat, { text: formatReply(command.name, text, failed) })
  const sticker = async image => sendContent({ sticker: await createStaticSticker(image) })

  if (command.name === 'menu') {
    await command.run(args, { message, sendMenu })
    return true
  }

  try {
    await command.run(args, { message, downloadMedia, send: sendContent, reply, sticker, request, receivedAt })
  } catch (error) {
    const fallback = command.name === 'smeme' ? 'La génération du sticker a échoué. Réessaie dans un instant.'
      : `La commande .${command.name} a échoué. Réessaie dans un instant.`
    await reply(error instanceof MemeInputError ? error.message : fallback, true)
  }
  return true
}

module.exports = { parseDomaCommand, handleDomaMessage }
