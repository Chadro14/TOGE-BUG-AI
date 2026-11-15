'use strict'

const { MemeInputError } = require('../doma-commandes.cjs')

const SPOTIFY = 'https://open.spotify.com'
const TRACK = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([a-z0-9]{22})\/?$/i

async function searchSpotify(input, request) {
  const query = input.trim()
  if (!query || /^\.{1,2}$/.test(query)) throw new MemeInputError('Utilise .spotify suivi du titre ou de l’artiste.')
  if (/^(?:https?:\/\/|spotify:)/i.test(query)) return openSpotify(query, request)
  if (query.length > 160) throw new MemeInputError('Utilise un titre ou un nom d’artiste de 160 caractères maximum.')
  const slug = encodeURIComponent(query.toWellFormed())
  return `Rechercher sur Spotify · ${query}\n\n${SPOTIFY}/search/${slug}`
}

async function openSpotify(input, request) {
  const url = URL.parse(input.trim())
  const uri = /^spotify:track:([a-z0-9]{22})$/i.exec(input.trim())
  const trackId = uri?.[1] ?? (url?.origin === SPOTIFY && !url.username && !url.password ? TRACK.exec(url.pathname)?.[1] : undefined)
  if (!trackId) throw new MemeInputError('Colle un lien de chanson open.spotify.com/track/… ou cherche son titre avec .spotify.')

  const link = `${SPOTIFY}/track/${trackId}`
  const endpoint = new URL('/oembed', SPOTIFY)
  endpoint.searchParams.set('url', link)
  let title
  try {
    const response = await request(endpoint, { signal: AbortSignal.timeout(4000), redirect: 'error' })
    if (response.status === 404) throw new MemeInputError('Ce titre est introuvable sur Spotify.')
    if (response.ok) {
      const result = await response.json()
      if (typeof result.title === 'string') title = result.title.trim().slice(0, 160)
    }
  } catch (error) {
    if (error instanceof MemeInputError) throw error
  }
  return [title, 'Écouter sur Spotify', link].filter(Boolean).join('\n\n')
}

module.exports = { searchSpotify, openSpotify }
