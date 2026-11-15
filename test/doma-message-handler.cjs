'use strict'

const { menu, createMeme, uploadMedia, MemeInputError, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } = require('../doma-commandes.cjs')
const { createStaticSticker } = require('./doma-sticker.cjs')
const { mixEmojis, telegramSticker, youtubeMedia } = require('./doma-media.cjs')

const commands = [
  { section: 'Principal', name: 'menu', aliases: ['allmenu'], run: showMenu },
  { section: 'Principal', name: 'alive', run: (_, { reply }) => reply('Domma est en ligne.') },
  { section: 'Principal', name: 'ping', run: (_, { reply, receivedAt }) => reply(`Pong · ${Math.round(performance.now() - receivedAt)} ms`) },
  { section: 'Principal', name: 'uptime', aliases: ['runtime'], run: showUptime },
  { section: 'Principal', name: 'owner', run: (_, { reply }) => reply('Créateur de Domma · Son Altesse') },
  { section: 'Principal', name: 'repo', run: (_, { reply }) => reply('https://github.com/Chadro14/TOGE-BUG-AI') },
  { section: 'Stickers', name: 'sticker', aliases: ['s'], run: makeSticker },
  { section: 'Stickers', name: 'smeme', usage: 'Haut|Bas', run: makeMeme },
  { section: 'Stickers', name: 'emojimix', usage: 'emoji + emoji', run: makeEmojiMix },
  { section: 'Stickers', name: 'telestick', usage: 'lien du pack', run: makeTelegramSticker },
  { section: 'YouTube', name: 'ytaudio', aliases: ['ytmp3'], usage: 'lien YouTube', run: sendYouTubeAudio },
  { section: 'YouTube', name: 'ytvideo', aliases: ['ytmp4'], usage: 'lien YouTube', run: sendYouTubeVideo },
  { section: 'Outils', name: 'tourl', run: shareMedia },
]

const byName = new Map(commands.flatMap(command => [command.name, ...(command.aliases ?? [])].map(name => [name, command])))

function parseDomaCommand(body) {
  const [, name, args = ''] = /^\.(\S+)(?:\s+([\s\S]*))?$/u.exec(body?.trim() ?? '') ?? []
  const command = byName.get(name?.normalize('NFKC').toLowerCase())
  return command && { command, args }
}

async function showMenu(_, { message, sendMenu }) {
  await sendMenu(message.chat, menu(commands))
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
  await send({ video: await youtubeMedia(args, false), mimetype: 'video/mp4' })
}

async function handleDomaMessage(message, { downloadMedia, sendMenu, send, request = fetch, receivedAt = performance.now() }, parsed = parseDomaCommand(message.body)) {
  if (!parsed) return false
  const sendContent = content => send(message.chat, content)
  const reply = text => sendContent({ text })
  const sticker = async image => sendContent({ sticker: await createStaticSticker(image) })
  const { command, args } = parsed

  if (command.name === 'menu') {
    await command.run(args, { message, sendMenu })
    return true
  }

  try {
    await command.run(args, { message, downloadMedia, send: sendContent, reply, sticker, request, receivedAt })
  } catch (error) {
    const fallback = command.name === 'smeme' ? 'La génération du sticker a échoué. Réessaie dans un instant.'
      : `La commande .${command.name} a échoué. Réessaie dans un instant.`
    await reply(error instanceof MemeInputError ? error.message : fallback)
  }
  return true
}

module.exports = { parseDomaCommand, handleDomaMessage }
