'use strict'

const { randomInt } = require('node:crypto')
const { MemeInputError } = require('../doma-commandes.cjs')
const { convertMedia } = require('./doma-media.cjs')

const userAgent = 'Domma (https://github.com/Chadro14/TOGE-BUG-AI)'
const reactions = {
  cry: 'Pleurs', hug: 'Câlin', pat: 'Petite tape affectueuse', kiss: 'Baiser', bite: 'Morsure',
  yeet: 'Envol', bonk: 'Coup de dessin animé', wink: 'Clin d’œil', poke: 'Petite piqûre',
  nom: 'Miam', slap: 'Gifle de dessin animé', smile: 'Sourire', wave: 'Salut de la main',
  blush: 'Rougissement', smug: 'Sourire en coin', happy: 'Joie', dance: 'Danse', cuddle: 'Tendresse',
  highfive: 'Tape dans la main', handhold: 'Main dans la main', tickle: 'Chatouilles', feed: 'Une bouchée',
  facepalm: 'Main sur le visage', neko: 'Neko', waifu: 'Portrait anime',
  clap: 'Applaudissements', shrug: 'Haussement d’épaules', stare: 'Regard fixe',
  yawn: 'Bâillement', laugh: 'Rire', salute: 'Salut', thumbsup: 'Pouce levé',
  bored: 'Ennui', confused: 'Perplexité', shocked: 'Surprise', pout: 'Bouderie',
}

const reactionAliases = {
  cry: ['animecry'], hug: ['animehug'], pat: ['animepat'], kiss: ['animekiss'], bite: ['animebite'],
  yeet: ['animeyeet'], bonk: ['animebonk'], wink: ['animewink'], poke: ['animepoke'], nom: ['animenom'],
  slap: ['animeslap'], smile: ['animesmille'], wave: ['animewave'], blush: ['animeblush'], smug: ['animesmug'],
  happy: ['animehappy'], dance: ['animedance'], cuddle: ['animecuddle'], highfive: ['animehighfive'],
  handhold: ['animehandhold'], tickle: ['animetickle'], feed: ['animefeed'], neko: ['animeneko', 'nekonime'],
  waifu: ['animewaifu', 'waifu2'],
}

const photoTopics = {
  aesthetic: 'minimalist landscape photography', coffee: 'cup of coffee', art: 'fine art painting public domain',
  dogwoof: 'domestic dog portrait', catmeow: 'domestic cat close up', lizardpic: 'lizard wildlife',
  goosebird: 'goose bird wildlife', '8ballpool': 'eight ball pool billiards', space: 'NASA galaxy space telescope',
  car: 'classic car automobile', technology: 'computer microprocessor', bike: 'bicycle close up',
  mountain: 'mountain landscape', cat: 'domestic cat', goose: 'geese wildlife bird',
  programming: 'computer programming code', islamic: 'Islamic architecture mosque geometric pattern',
  cosplay: 'cosplay convention costume', hijab: 'hijab fashion',
  kpop: 'K-pop concert', bts: 'BTS music group', exo: 'EXO music group',
  blackpink: 'Blackpink music group', rose: 'Rosé Blackpink singer',
  lisa: 'Lisa Blackpink singer', jennie: 'Jennie Blackpink singer', jiso: 'Jisoo Blackpink singer',
}

async function readRemote(request, url, hosts, limit, mediaTypes) {
  const target = URL.parse(url ?? '')
  if (!target || target.protocol !== 'https:' || !hosts.includes(target.hostname) || target.username || target.password || target.port) {
    throw new MemeInputError('Le service a renvoyé un lien de média invalide.')
  }
  const response = await request(target.href, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { 'User-Agent': userAgent } })
  const mimetype = response.headers.get('content-type')?.split(';', 1)[0]
  if (!response.ok || !response.body || !mediaTypes.includes(mimetype)) throw new MemeInputError('Le média est momentanément indisponible.')
  if (Number(response.headers.get('content-length')) > limit) throw new MemeInputError('Le média dépasse la taille autorisée.')
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) throw new MemeInputError('Le média dépasse la taille autorisée.')
    chunks.push(chunk)
  }
  if (!total) throw new MemeInputError('Le média reçu est vide.')
  return { data: Buffer.concat(chunks, total), mimetype }
}

async function showReaction(name, { request, send }) {
  const response = await request(`https://nekos.best/api/v2/${name}`, {
    headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000), redirect: 'error',
  })
  if (!response.ok) throw new MemeInputError('Le service de réactions anime est momentanément indisponible.')
  const reaction = (await response.json()).results?.[0]
  if (!reaction) throw new MemeInputError('Aucune réaction trouvée.')
  const { data, mimetype } = await readRemote(request, reaction.url, ['nekos.best'], 5 * 1024 * 1024, ['image/gif', 'image/png', 'image/jpeg'])
  const caption = [reactions[name], reaction.anime_name && `Anime · ${reaction.anime_name}`,
    reaction.artist_name && `Artiste · ${reaction.artist_name}`, reaction.source_url].filter(Boolean).join('\n')
  if (mimetype !== 'image/gif') return send({ image: data, mimetype, caption })

  const video = await convertMedia(data, 'mp4', [
    '-map', '0:v:0', '-t', '10', '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ])
  await send({ video, mimetype: 'video/mp4', gifPlayback: true, caption })
}

async function showPhoto(query, { request, send }) {
  if (!query || query.length > 100) throw new MemeInputError('Indique un sujet de recherche de 100 caractères maximum.')
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 8,
    prop: 'imageinfo', iiprop: 'url', iiurlwidth: 640, format: 'json', formatversion: 2,
  })
  const response = await request(url.href, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) throw new MemeInputError('Wikimedia Commons est momentanément indisponible.')
  const photos = (await response.json()).query?.pages?.filter(page => page.imageinfo?.[0]?.thumburl) ?? []
  if (!photos.length) throw new MemeInputError('Aucune photo trouvée avec ce sujet.')
  const photo = photos[randomInt(photos.length)]
  const { thumburl } = photo.imageinfo[0]
  const { data, mimetype } = await readRemote(request, thumburl, ['upload.wikimedia.org', 'thumb.wikimedia.org'], 3 * 1024 * 1024, ['image/jpeg', 'image/png', 'image/webp'])
  const source = `https://commons.wikimedia.org/wiki/${encodeURIComponent(photo.title.replaceAll(' ', '_'))}`
  await send({ image: data, mimetype, caption: `${photo.title.replace(/^File:/, '')}\nWikimedia Commons\n${source}` })
}

module.exports = { reactions, reactionAliases, photoTopics, showReaction, showPhoto }
