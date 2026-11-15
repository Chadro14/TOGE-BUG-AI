'use strict'

const { execFile } = require('node:child_process')
const { mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { delimiter, join } = require('node:path')
const { promisify } = require('node:util')
const { MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, MemeInputError } = require('../doma-commandes.cjs')

const run = promisify(execFile)
const TELEGRAM = 'https://api.telegram.org'
const YT_DLP_ENV = {
  ...process.env,
  PATH: [join(__dirname, '..', 'bin'), process.env.PATH].filter(Boolean).join(delimiter),
}
const YOUTUBE_AUDIO_FORMAT = [
  'ba[ext=m4a][acodec^=mp4a][audio_channels<=2][filesize_approx<=20M]',
  'ba[audio_channels<=2][filesize_approx<=20M]',
  'ba[audio_channels<=?2][filesize_approx=none]',
  'b[filesize_approx<=?20M]',
].join('/')
const YOUTUBE_VIDEO_FORMAT = [
  'b[ext=mp4][vcodec^=avc1][acodec^=mp4a][height<=720][filesize_approx<=20M]',
  'bv[ext=mp4][vcodec^=avc1][height<=720][filesize_approx<=15M]+ba[ext=m4a][acodec^=mp4a][audio_channels<=2][filesize_approx<=4M]',
  'b[ext=mp4][vcodec^=avc1][acodec^=mp4a][height<=720][filesize_approx=none]',
].join('/')

async function downloadImage(url, request) {
  const response = await request(url, { signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok || !response.body) throw new Error(`Image HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_IMAGE_BYTES) throw new MemeInputError('L’image dépasse 5 Mo.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function mixEmojis(args, request) {
  const [left, right, ...rest] = args.split('+').map(part => part.trim())
  if (!left || !right || rest.length) throw new MemeInputError('Utilise .emojimix suivi de deux emojis séparés par +.')
  const { default: getEmojiMixUrl } = await import('emoji-mixer')
  const url = getEmojiMixUrl(left, right)
  if (!url) throw new MemeInputError('Emoji Kitchen ne propose pas cette combinaison.')
  return downloadImage(url, request)
}

async function telegramSticker(args, request) {
  const [pack = '', index = '1', ...rest] = args.split(/\s+/)
  const match = /^(?:https:\/\/t\.me\/addstickers\/)?([a-z][a-z0-9_]{0,63})\/?$/i.exec(pack)
  if (!match || !/^[1-9]\d{0,2}$/.test(index) || rest.length) {
    throw new MemeInputError('Utilise .telestick suivi du lien du pack Telegram et, au choix, du numéro du sticker.')
  }
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token || !/^\d+:[\w-]+$/.test(token)) {
    throw new MemeInputError('Configure TELEGRAM_BOT_TOKEN sur le serveur pour activer .telestick.')
  }
  const options = () => ({ signal: AbortSignal.timeout(15000), redirect: 'error' })
  const set = await request(`${TELEGRAM}/bot${token}/getStickerSet?name=${match[1]}`, options())
  const packData = await set.json()
  if (!set.ok || !packData.ok) throw new MemeInputError('Telegram n’a pas pu ouvrir ce pack de stickers.')
  const sticker = packData.result.stickers[Number(index) - 1]
  if (!sticker) throw new MemeInputError(`Le pack contient ${packData.result.stickers.length} stickers.`)
  if (sticker.is_animated || sticker.is_video) throw new MemeInputError('Choisis un sticker Telegram statique.')

  const file = await request(`${TELEGRAM}/bot${token}/getFile?${new URLSearchParams({ file_id: sticker.file_id })}`, options())
  const fileData = await file.json()
  const path = fileData.result?.file_path
  if (!file.ok || !fileData.ok || !/^stickers\/[\w-]+\.webp$/.test(path ?? '')) {
    throw new MemeInputError('Telegram n’a pas renvoyé de fichier WebP pour ce sticker.')
  }
  return downloadImage(`${TELEGRAM}/file/bot${token}/${path}`, request)
}

function youtubeUrl(input) {
  const url = URL.parse(input)
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']
  if (url?.protocol !== 'https:' || url.username || url.password || url.port) return null
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
    : hosts.includes(url.hostname) && (url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1])
  return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

async function youtubeMedia(args, audio) {
  const url = youtubeUrl(args)
  if (!url) throw new MemeInputError('Ajoute le lien HTTPS d’une vidéo YouTube.')
  const directory = await mkdtemp(join(tmpdir(), 'doma-youtube-'))
  const extension = audio ? 'mp3' : 'mp4'
  try {
    await run('yt-dlp', [
      '--ignore-config', '--js-runtimes', 'node', '--no-playlist', '--no-warnings', '--no-progress',
      '--socket-timeout', '15', '--retries', '1', '--max-filesize', String(MAX_UPLOAD_BYTES),
      '-o', join(directory, 'media.%(ext)s'),
      ...(audio ? ['-f', YOUTUBE_AUDIO_FORMAT, '-x', '--audio-format', 'mp3', '--audio-quality', '128K']
        : ['-f', YOUTUBE_VIDEO_FORMAT, '--merge-output-format', 'mp4']),
      '--', url,
    ], {
      env: YT_DLP_ENV,
      timeout: 90000,
      maxBuffer: 256 * 1024,
    })
    const filename = `media.${extension}`
    if (!(await readdir(directory)).includes(filename)) throw new MemeInputError('Le média est indisponible dans ce format ou dépasse 20 Mo.')
    const file = join(directory, filename)
    if ((await stat(file)).size > MAX_UPLOAD_BYTES) throw new MemeInputError('Le média dépasse 20 Mo.')
    return await readFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') throw new MemeInputError('Installe yt-dlp sur le serveur pour activer cette commande.')
    throw error
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

async function searchYouTube(query) {
  let output
  try {
    ({ stdout: output } = await run('yt-dlp', [
      '--ignore-config', '--js-runtimes', 'node', '--flat-playlist', '--no-warnings',
      '--socket-timeout', '10', '--retries', '1', '--dump-single-json', '--', `ytsearch5:${query}`,
    ], { env: YT_DLP_ENV, timeout: 30000, maxBuffer: 512 * 1024 }))
  } catch (error) {
    if (error.code === 'ENOENT') throw new MemeInputError('Installe yt-dlp sur le serveur pour activer cette commande.')
    throw error
  }
  return (JSON.parse(output).entries ?? []).filter(entry => /^[\w-]{11}$/.test(entry?.id ?? ''))
    .map(entry => ({ title: entry.title || 'Vidéo YouTube', url: `https://www.youtube.com/watch?v=${entry.id}` }))
}

async function convertAudio(input, effect, voiceNote) {
  const directory = await mkdtemp(join(tmpdir(), 'doma-audio-'))
  try {
    const inputPath = join(directory, 'input')
    const outputPath = join(directory, voiceNote ? 'audio.ogg' : 'audio.mp3')
    await writeFile(inputPath, input)
    await run('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-map', '0:a:0',
      ...(effect ? ['-af', effect] : []),
      ...(voiceNote ? ['-c:a', 'libopus', '-ar', '48000', '-ac', '1'] : ['-c:a', 'libmp3lame', '-b:a', '128k']),
      '-fs', String(MAX_UPLOAD_BYTES), outputPath,
    ], { timeout: 30000, maxBuffer: 64 * 1024 })
    const { size } = await stat(outputPath)
    if (!size || size >= MAX_UPLOAD_BYTES) throw new MemeInputError('La piste audio produite dépasse la taille autorisée ou est vide.')
    return await readFile(outputPath)
  } catch (error) {
    if (error.code === 'ENOENT') throw new MemeInputError('Installe FFmpeg sur le serveur pour utiliser cette commande.')
    throw error
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

module.exports = { mixEmojis, telegramSticker, youtubeMedia, searchYouTube, convertAudio }
