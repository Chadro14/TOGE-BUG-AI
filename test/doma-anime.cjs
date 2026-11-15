'use strict'

const { MemeInputError } = require('../doma-commandes.cjs')

const characters = {
  akira: 'Akira Fudou', akiyama: 'Mio Akiyama', asuna: 'Asuna Yuuki', ayuzawa: 'Misaki Ayuzawa',
  boruto: 'Boruto Uzumaki', chiho: 'Chiho Sasaki', chitoge: 'Chitoge Kirisaki', deidara: 'Deidara',
  doraemon: 'Doraemon', elaina: 'Elaina', emilia: 'Emilia', erza: 'Erza Scarlet', gremory: 'Rias Gremory',
  hestia: 'Hestia', inori: 'Inori Yuzuriha', isuzu: 'Isuzu Sento', itachi: 'Itachi Uchiha',
  itori: 'Itori', kaga: 'Kouko Kaga', kagura: 'Kagura', kakasih: 'Kakashi Hatake',
  kaori: 'Kaori Miyazono', keneki: 'Ken Kaneki', kotori: 'Kotori Minami', kurumi: 'Kurumi Tokisaki',
  madara: 'Madara Uchiha', megumin: 'Megumin', mikasa: 'Mikasa Ackerman', mikey: 'Manjirou Sano',
  miku: 'Miku Nakano', minato: 'Minato Namikaze', naruto: 'Naruto Uzumaki', nezuko: 'Nezuko Kamado',
  rize: 'Rize Kamishiro', sagiri: 'Sagiri Izumi', sakura: 'Sakura Haruno', sasuke: 'Sasuke Uchiha',
  shina: 'Mashiro Shiina', shinka: 'Shinka Nibutani', shinobu: 'Shinobu Kochou', shinomiya: 'Kaguya Shinomiya',
  shizuka: 'Shizuka Minamoto', tejina: 'Tejina-senpai', toukachan: 'Touka Kirishima', tsunade: 'Tsunade',
  yotsuba: 'Yotsuba Nakano', yuki: 'Yuki Nagato', yumeko: 'Yumeko Jabami',
}

const series = { onepiece: 'One Piece', pokemon: 'Pokémon' }

async function searchKitsu(resource, params, request) {
  const url = new URL(`https://kitsu.io/api/edge/${resource}`)
  url.search = new URLSearchParams({ 'page[limit]': 5, ...params })
  const response = await request(url.href, { signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!response.ok) throw new MemeInputError('Le catalogue anime est momentanément indisponible.')
  const { data } = await response.json()
  return data ?? []
}

async function sendArtwork({ request, reply, send }, imageUrl, caption) {
  const url = URL.parse(imageUrl ?? '')
  if (!url || url.protocol !== 'https:' || url.hostname !== 'media.kitsu.app' || url.username || url.password || url.port) {
    await reply(caption)
    return
  }
  let image
  let mimetype
  try {
    const response = await request(url.href, { signal: AbortSignal.timeout(10000), redirect: 'error' })
    mimetype = response.headers.get('content-type')
    if (!response.ok || !response.body || !/^image\/(jpeg|png|webp)$/.test(mimetype ?? '')) throw new Error('Image indisponible')
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 2 * 1024 * 1024) throw new Error('Image trop grande')
      chunks.push(chunk)
    }
    image = Buffer.concat(chunks)
    if (!image.length) throw new Error('Image vide')
  } catch {
    await reply(caption)
    return
  }
  await send({ image, mimetype, caption })
}

async function showCharacter(name, context) {
  const matches = await searchKitsu('characters', { 'filter[name]': name }, context.request)
  const character = matches.find(({ attributes }) => [attributes.canonicalName, ...Object.values(attributes.names ?? {}), ...(attributes.otherNames ?? [])]
    .some(value => typeof value === 'string' && normalizeName(value) === normalizeName(name)))
  if (!character) throw new MemeInputError(`Aucune fiche trouvée pour ${name}.`)
  const { canonicalName, image } = character.attributes
  const url = `https://kitsu.app/characters/${encodeURIComponent(character.attributes.slug || character.id)}`
  await sendArtwork(context, image?.medium, `${canonicalName || name}\nFiche personnage\n${url}`)
}

function normalizeName(name) {
  return name.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

async function showAnime(args, context, wallpaper = false) {
  if (!args || args.length > 100) throw new MemeInputError(`Ajoute un titre, par exemple .${wallpaper ? 'animewall' : 'anime'} Naruto.`)
  const matches = await searchKitsu('anime', { 'filter[text]': args }, context.request)
  const available = matches.filter(({ attributes }) => attributes.nsfw === false && ['G', 'PG', 'R'].includes(attributes.ageRating))
  const match = available.find(({ attributes }) => [attributes.canonicalTitle, ...Object.values(attributes.titles ?? {})]
    .some(title => typeof title === 'string' && normalizeName(title) === normalizeName(args))) ?? available[0]
  if (!match) throw new MemeInputError('Aucun anime trouvé pour ce titre.')
  const { canonicalTitle, episodeCount, averageRating, coverImage, posterImage, slug } = match.attributes
  const lines = [canonicalTitle, episodeCount && `Épisodes · ${episodeCount}`, averageRating && `Note Kitsu · ${averageRating}/100`, `https://kitsu.app/anime/${encodeURIComponent(slug || match.id)}`]
  await sendArtwork(context, (wallpaper ? coverImage?.large : posterImage?.medium) ?? posterImage?.medium, lines.filter(Boolean).join('\n'))
}

module.exports = { characters, series, showCharacter, showAnime }
