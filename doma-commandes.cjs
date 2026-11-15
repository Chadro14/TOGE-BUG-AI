'use strict'

const CHANNEL = 'https://www.whatsapp.com/channel/0029Vb6aMu46RGJOcGGe1H1O'
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

function royalFrame(title, text) {
  return [`╔════〔 *${fancy(title)}* 〕════╗`, '', text, '', '╚══════════════════╝'].join('\n')
}

function formatReply(name, text, failed = false) {
  const title = failed ? 'Commande indisponible' : name.toUpperCase()
  return royalFrame(title, text)
}

function menu(commands, selected) {
  const sections = new Map()
  for (const { section, name, usage = '' } of commands) {
    const id = section.toLowerCase()
    if (!sections.has(id)) sections.set(id, { id, title: section, commands: [] })
    sections.get(id).commands.push(`│ *.${name}*${usage ? ` — ${usage}` : ''}`)
  }
  const categories = [...sections.values()]
  const [section, page = '1'] = (selected ?? '').trim().split(/\s+/)
  const catalogue = section === 'catalogue' && { id: section, title: 'Catalogue', commands: categories.flatMap(entry => entry.commands) }
  const category = catalogue || (/^\d+$/.test(section) ? categories[Number(section) - 1] : sections.get(section))
  const count = commands.length
  const pageSize = 16
  const totalPages = category ? Math.ceil(category.commands.length / pageSize) : 1
  const current = /^\d+$/.test(page) ? Math.min(Math.max(Number(page), 1), totalPages) : 1
  const start = (current - 1) * pageSize
  const body = category
    ? [`*${category.title.toUpperCase()}*`, '', ...category.commands.slice(start, start + pageSize)].join('\n')
    : `*${count} commandes* · ${categories.length} catégories\nPar Son Altesse\n\nTape une commande ci-dessous pour ouvrir sa catégorie.`
  const fallback = category ? [
    totalPages > 1 && `Page ${current}/${totalPages}`,
    current > 1 && `Page précédente · .menu ${category.id} ${current - 1}`,
    current < totalPages && `Page suivante · .menu ${category.id} ${current + 1}`,
    'Retour au menu · .menu',
  ].filter(Boolean).join('\n') : categories.map(({ title }, index) => `*.menu ${index + 1}* — ${title}`).join('\n')
  return {
    video: category ? undefined : MENU_VIDEO,
    channel: CHANNEL,
    text: `╭── *D O M M A* ──╮\n\n${body}`,
    fallback,
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

module.exports = { menu, fancy, formatReply, createMeme, uploadMedia, MemeInputError, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES }
