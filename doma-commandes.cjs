'use strict'

const CHANNEL = 'https://whatsapp.com/channel/0029Vb6aMu46RGJOcGGe1H1O'
const MENU_VIDEO = 'https://files.catbox.moe/54auhj.mp4'
const MEMEGEN = 'https://api.memegen.link/images/custom'
const UGUU = 'https://uguu.se/upload.php'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const MEMEGEN_ESCAPES = {
  ' ': '_', '_': '__', '-': '--', '\n': '~n', '?': '~q', '&': '~a',
  '%': '~p', '#': '~h', '/': '~s', '\\': '~b', '<': '~l', '>': '~g', '"': "''",
}

class MemeInputError extends Error {}

function fancy(text) {
  return text.replace(/[A-Za-z]/g, letter => {
    const first = letter < 'a' ? 'A' : 'a'
    const offset = letter < 'a' ? 0x1d56c : 0x1d586
    return String.fromCodePoint(offset + letter.charCodeAt(0) - first.charCodeAt(0))
  })
}

function menu(commands) {
  const sections = new Map()
  for (const { section, name, usage = '' } of commands) {
    if (!sections.has(section)) sections.set(section, [])
    sections.get(section).push(`┆❏ .${fancy(name)}${usage ? ` ${usage}` : ''}`)
  }
  return {
    video: MENU_VIDEO,
    channel: CHANNEL,
    text: [
      `*${fancy('domma')}*`,
      `Par ${fancy('Son Altesse')}`,
      ...Array.from(sections, ([name, rows]) => ['', `╭──『 ${fancy(name)} 』`, ...rows, '╰──────────────']).flat(),
    ].join('\n'),
  }
}

function encodeCaption(caption) {
  if (!caption) return '_'
  const escaped = caption.replace(/[ _\-\n?&%#/\\<>"]/g, character => MEMEGEN_ESCAPES[character])
  // A segment consisting of dots can otherwise be normalized by URL parsers.
  return /^\.{1,2}$/.test(escaped) ? `${escaped}_` : encodeURIComponent(escaped)
}

async function uploadMedia(media, mime, filename, request = fetch) {
  if (!Buffer.isBuffer(media) || media.length === 0 || media.length > MAX_UPLOAD_BYTES) {
    throw new MemeInputError('La taille du fichier doit être comprise entre 1 octet et 20 Mo.')
  }
  const form = new FormData()
  form.append('files[]', new Blob([media], { type: mime }), filename)
  const response = await request(UGUU, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Uguu HTTP ${response.status}`)
  const data = await response.json()
  if (data.success !== true || !data.files?.[0]?.url) throw new Error('Uguu n’a renvoyé aucun lien')
  const url = new URL(data.files[0].url)
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.hostname !== 'uguu.se' && !url.hostname.endsWith('.uguu.se'))) {
    throw new Error('Lien Uguu invalide')
  }
  return url.href
}

async function createMeme({ image, mime, caption, request = fetch }) {
  if (!Buffer.isBuffer(image) || image.length === 0 || !MIME_EXTENSIONS.has(mime)) {
    throw new MemeInputError('Joins une image JPEG, PNG ou WebP avec la légende .smeme Haut|Bas.')
  }
  if (image.length > MAX_IMAGE_BYTES) throw new MemeInputError('Choisis une image de 5 Mo maximum.')
  const separator = caption.indexOf('|')
  const top = (separator === -1 ? caption : caption.slice(0, separator)).trim()
  const bottom = separator === -1 ? '' : caption.slice(separator + 1).trim()
  if (!top && !bottom) throw new MemeInputError('Ajoute une légende, par exemple .smeme En haut|En bas.')
  if ([top, bottom].some(line => Buffer.byteLength(line) > 120)) {
    throw new MemeInputError('Raccourcis le texte en haut ou en bas.')
  }

  const background = await uploadMedia(image, mime, `background.${MIME_EXTENSIONS.get(mime)}`, request)
  const url = new URL(`${MEMEGEN}/${encodeCaption(top)}/${encodeCaption(bottom)}.png`)
  url.searchParams.set('background', background)
  url.searchParams.set('width', '512')
  url.searchParams.set('height', '512')
  const result = await request(url.href, {
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  if (!result.ok || !/^image\/png(?:;|$)/i.test(result.headers.get('content-type') ?? '')) {
    throw new Error(`Memegen n’a pas renvoyé d’image PNG (HTTP ${result.status})`)
  }
  return Buffer.from(await result.arrayBuffer())
}

module.exports = { menu, createMeme, uploadMedia, MemeInputError, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES }
