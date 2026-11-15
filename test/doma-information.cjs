'use strict'

const { MemeInputError } = require('../doma-commandes.cjs')

async function readJson(request, endpoint, params, missing) {
  const url = new URL(endpoint)
  url.search = new URLSearchParams(params)
  const response = await request(url.href, { signal: AbortSignal.timeout(12000), redirect: 'error' })
  if (response.status === 404 && missing) throw new MemeInputError(missing)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function weather(args, request) {
  if (!args || args.length > 90) throw new MemeInputError('Utilise .weather suivi d’une ville, par exemple .weather Kinshasa.')
  const { results } = await readJson(request, 'https://geocoding-api.open-meteo.com/v1/search', { name: args, count: 1, language: 'fr' })
  const city = results?.[0]
  if (!city) throw new MemeInputError('Ville introuvable. Vérifie son orthographe.')
  const { current, current_units: units } = await readJson(request, 'https://api.open-meteo.com/v1/forecast', {
    latitude: city.latitude, longitude: city.longitude, timezone: 'auto',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',
  })
  const place = [city.name, city.admin1, city.country].filter(Boolean)
  return [
    [...new Set(place)].join(', '),
    `Température · ${current.temperature_2m} ${units.temperature_2m}`,
    `Ressenti · ${current.apparent_temperature} ${units.apparent_temperature}`,
    `Humidité · ${current.relative_humidity_2m} ${units.relative_humidity_2m}`,
    `Vent · ${current.wind_speed_10m} ${units.wind_speed_10m}`,
  ].join('\n')
}

async function translate(args, request) {
  const match = /^([a-z]{2,3}(?:-[a-z]{2,4})?)\s*[|>]\s*([a-z]{2,3}(?:-[a-z]{2,4})?)\s+([\s\S]+)$/i.exec(args)
  if (!match || Buffer.byteLength(match[3]) > 500) {
    throw new MemeInputError('Utilise .translate fr>en suivi d’un texte de 500 octets maximum.')
  }
  const [, from, to, q] = match
  if (from.toLowerCase() === to.toLowerCase()) return q
  const result = await readJson(request, 'https://api.mymemory.translated.net/get', { q, langpair: `${from}|${to}` })
  if (Number(result.responseStatus) !== 200 || !result.responseData?.translatedText) {
    throw new MemeInputError('Traduction indisponible. Vérifie les codes de langue et réessaie.')
  }
  return result.responseData.translatedText
}

async function itunes(args, request) {
  if (!args || args.length > 120) throw new MemeInputError('Utilise .itunes suivi du titre ou de l’artiste.')
  const { results } = await readJson(request, 'https://itunes.apple.com/search', { term: args, entity: 'song', limit: 5 })
  return results.length ? results.map(track => `${track.trackName} — ${track.artistName}\n${track.trackViewUrl}`).join('\n\n')
    : 'Aucun morceau trouvé.'
}

async function define(args, request) {
  if (!/^[a-z][a-z' -]{0,59}$/i.test(args)) throw new MemeInputError('Utilise .define suivi d’un mot anglais.')
  const entries = await readJson(request, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(args)}`, {}, 'Mot anglais introuvable.')
  const meanings = entries[0]?.meanings ?? []
  return meanings.length ? [`Définitions de ${args}`, ...meanings.slice(0, 4).map(item => `${item.partOfSpeech} · ${item.definitions[0].definition}`)].join('\n')
    : 'Aucune définition trouvée.'
}

module.exports = { weather, translate, itunes, define }
