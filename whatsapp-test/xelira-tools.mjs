import { MemeInputError, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } from '../doma-commandes.cjs'

export const sharedCommands = new Map([
  ['uptime', ['uptime', 'Temps de fonctionnement']],
  ['weather', ['weather', 'Météo d’une ville']],
  ['play', ['play', 'Chercher un titre sur YouTube et envoyer l’audio']],
  ['ytmp3', ['ytaudio', 'Audio d’une vidéo YouTube']],
  ['ytmp4', ['ytvideo', 'Télécharger une vidéo YouTube']],
  ['sticker', ['sticker', 'Créer un sticker à partir d’une image']],
  ['simage', ['toimg', 'Convertir un sticker en image']],
  ['url', ['tourl', 'Créer un lien temporaire pour ton média']],
  ['meme', ['smeme', 'Créer un mème à partir de ton image']],
  ['emojimix', ['emojimix', 'Combiner deux emojis']],
  ['anime', ['anime', 'Rechercher un anime']],
  ['character', ['animeavatar', 'Rechercher un personnage d’anime']],
  ['img', ['wikimedia', 'Chercher une image sur Wikimedia']],
  ['truth', ['truth', 'Piocher une question']],
  ['groupinfo', ['groupinfo', 'Voir les informations d’un groupe']],
  ['kick', ['kick', 'Retirer un membre du groupe']],
  ['promote', ['promote', 'Nommer un administrateur']],
  ['demote', ['demote', 'Retirer le rôle administrateur']],
  ['mute', ['groupclose', 'Réserver les messages aux administrateurs']],
  ['unmute', ['groupopen', 'Rouvrir le groupe à tous les membres']],
  ['antidelete', ['antidelete', 'Activer ou couper l’anti-suppression des textes privés']],
  ['autoreadstatus', ['autoview', 'Activer ou couper la lecture des statuts']],
])

export const extraCommands = new Map([
  ['quote', 'Piocher une citation'],
  ['lyrics', 'Ouvrir une recherche de paroles'],
  ['gdrive', 'Ouvrir un fichier Google Drive partagé'],
  ['getpp', 'Afficher une photo de profil accessible'],
  ['setpp', 'Changer la photo de profil du compte connecté'],
  ['save', 'Renvoyer ton média ordinaire dans ta conversation personnelle'],
  ['dlt', 'Supprimer un de tes messages en y répondant'],
  ['hangman', 'Jouer au pendu'],
  ['shayari', 'Afficher un court poème'],
  ['roseday', 'Afficher un message pour la fête des roses'],
  ['tag', 'Mentionner un membre du groupe'],
  ['accept', 'Accepter une demande d’adhésion précise'],
  ['tagadmin', 'Mentionner les administrateurs du groupe'],
  ['tagall', 'Mentionner les membres du groupe'],
  ['status', 'Afficher la disponibilité et les commandes du bot'],
  ['pinterest', 'Rechercher des images sur Pinterest'],
])

const quotes = [
  'On peut ralentir sans renoncer.',
  'La patience laisse au travail le temps de porter ses fruits.',
  'Un premier pas suffit pour quitter le point de départ.',
]
const poems = [
  'La nuit efface les chemins,\nmais garde une étoile pour demain.',
  'Dans le bruit du monde,\nj’ai gardé le calme de ta voix.',
]
const hangmanWords = ['soleil', 'mangue', 'riviere', 'nuage', 'jardin', 'cascade', 'musique', 'couleur']

function pick(values) {
  return values[Math.floor(Math.random() * values.length)]
}

export async function runExtra(name, args, ctx) {
  const { socket, baileys, jid, key, reply, source, ownSource, downloadMedia, context, games, ownsQuote } = ctx
  switch (name) {
    case 'quote': return reply(pick(quotes))
    case 'shayari': return reply(pick(poems))
    case 'roseday': return reply('Une rose pour te souhaiter une belle journée.')
    case 'status': return reply('Xelira MD est en ligne. Utilise .menu pour afficher les commandes.')
    case 'pinterest': {
      if (!args || args.length > 160) throw new MemeInputError('Utilise .pinterest suivi du sujet à rechercher.')
      return reply(`Pinterest\nhttps://www.pinterest.com/search/pins/?${new URLSearchParams({ q: args })}`)
    }
    case 'lyrics': {
      const [artist, title, ...rest] = args.split('|').map(part => part.trim())
      if (!artist || !title || rest.length || args.length > 200) throw new MemeInputError('Utilise .lyrics Artiste | Titre.')
      const search = new URL('https://www.musixmatch.com/search')
      search.pathname += '/' + encodeURIComponent(`${artist} ${title}`)
      return reply(`${artist} · ${title}\n${search.href}`)
    }
    case 'gdrive': {
      const url = URL.parse(args)
      const id = url?.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] ?? url?.searchParams.get('id')
      if (url?.origin !== 'https://drive.google.com' || !/^[\w-]{10,100}$/.test(id ?? '')) {
        throw new MemeInputError('Colle un lien vers un fichier partagé sur Google Drive.')
      }
      const link = new URL(`https://drive.google.com/file/d/${id}/view`)
      const resourceKey = url.searchParams.get('resourcekey')
      if (/^[\w-]{1,100}$/.test(resourceKey ?? '')) link.searchParams.set('resourcekey', resourceKey)
      return reply(link.href)
    }
    case 'getpp': {
      const target = context?.mentionedJid?.[0] ?? context?.participant ?? (key.fromMe ? socket.user.id : key.participant ?? jid)
      const url = await socket.profilePictureUrl(target, 'image', 8000)
      const image = URL.parse(url ?? '')
      if (image?.protocol !== 'https:' || !/(^|\.)whatsapp\.net$/.test(image.hostname)) {
        throw new MemeInputError('Cette photo de profil est indisponible.')
      }
      return socket.sendMessage(jid, { image: { url: image.href } })
    }
    case 'setpp': {
      if (!key.fromMe) return
      if (!ownSource || source?.mtype !== 'imageMessage') throw new MemeInputError('Envoie ton image avec la légende .setpp.')
      await socket.updateProfilePicture(socket.user.id, await downloadMedia(source, MAX_IMAGE_BYTES))
      return reply('Photo de profil mise à jour.')
    }
    case 'save': {
      if (!key.fromMe) return
      const kind = {imageMessage:'image', videoMessage:'video', audioMessage:'audio', documentMessage:'document', stickerMessage:'sticker'}[source?.mtype]
      if (!ownSource || !kind) throw new MemeInputError('Utilise .save avec un média que tu as envoyé.')
      const payload = { [kind]: await downloadMedia(source, MAX_UPLOAD_BYTES) }
      if (['audio', 'document'].includes(kind)) payload.mimetype = source.msg.mimetype || 'application/octet-stream'
      if (kind === 'document') payload.fileName = source.msg.fileName || 'fichier'
      await socket.sendMessage(baileys.jidNormalizedUser(socket.user.id), payload)
      return
    }
    case 'dlt': {
      if (!key.fromMe) return
      if (!ownsQuote || !context?.stanzaId || !ctx.canUseQuotedMessage) {
        throw new MemeInputError('Réponds à un de tes messages ordinaires avec .dlt.')
      }
      return socket.sendMessage(jid, {
        delete: { remoteJid: jid, id: context.stanzaId, fromMe: true, participant: context.participant },
      })
    }
    case 'hangman': {
      if (!args || args.toLowerCase() === 'start') {
        if (games.size >= 100 && !games.has(jid)) games.delete(games.keys().next().value)
        games.set(jid, { word: pick(hangmanWords), guesses: new Set() })
      } else if (!/^[a-z]$/i.test(args)) throw new MemeInputError('Écris .hangman start ou .hangman suivi d’une lettre.')
      const game = games.get(jid)
      if (!game) throw new MemeInputError('Écris .hangman start pour commencer.')
      if (/^[a-z]$/i.test(args)) game.guesses.add(args.toLowerCase())
      const wrong = [...game.guesses].filter(letter => !game.word.includes(letter)).length
      const letters = [...game.word].map(letter => game.guesses.has(letter) ? letter : '_')
      if (wrong >= 6 || !letters.includes('_')) {
        games.delete(jid)
        return reply(`${wrong >= 6 ? 'Partie terminée' : 'Mot trouvé'} · ${game.word}`)
      }
      return reply(`${letters.join(' ')}\n${6 - wrong} essais restants. Propose une lettre avec .hangman.`)
    }
    case 'tag':
    case 'accept':
    case 'tagadmin':
    case 'tagall':
      return groupAction(name, ctx, args)
  }
}

async function groupAction(name, { socket, baileys, jid, key, context, ownJids, reply }, args) {
  if (!key.fromMe) return
  if (!baileys.isJidGroup(jid)) throw new MemeInputError('Utilise cette commande dans un groupe.')
  const group = await socket.groupMetadata(jid)
  const ids = person => [person.id, person.lid, person.phoneNumber].filter(Boolean).map(baileys.jidNormalizedUser)
  const self = group.participants.find(person => ids(person).some(id => ownJids.has(id)))
  if (!self || !(self.admin || self.isAdmin || self.isSuperAdmin)) throw new MemeInputError('Tu dois être administrateur du groupe.')
  if (name === 'accept') {
    if (!/^\+?[1-9]\d{6,14}$/.test(args)) throw new MemeInputError('Utilise .accept suivi du numéro international du demandeur.')
    const target = args.replace(/^\+/, '') + '@s.whatsapp.net'
    const pending = await socket.groupRequestParticipantsList(jid)
    const matched = pending.find(entry => [entry.jid, entry.phone_number].some(id =>
      id && baileys.jidNormalizedUser(id.includes('@') ? id : id + '@s.whatsapp.net') === target))
    if (!matched) throw new MemeInputError('Aucune demande d’adhésion trouvée pour ce numéro.')
    const [result] = await socket.groupRequestParticipantsUpdate(jid, [matched.jid], 'approve')
    if (String(result?.status) !== '200') throw new MemeInputError('WhatsApp a refusé cette demande.')
    return reply('Demande d’adhésion acceptée.')
  }
  if (name === 'tagadmin' || name === 'tagall') {
    const recipients = group.participants.filter(person => person !== self &&
      (name === 'tagall' || person.admin || person.isAdmin || person.isSuperAdmin))
    if (!recipients.length) throw new MemeInputError('Aucun destinataire à mentionner.')
    if (recipients.length > 50) throw new MemeInputError('Ce groupe dépasse 50 mentions pour une seule commande.')
    const mentions = recipients.map(person => person.id)
    const text = [args.slice(0, 500), mentions.map(id => '@' + id.split('@')[0]).join(' ')].filter(Boolean).join('\n')
    return socket.sendMessage(jid, { text, mentions })
  }
  const refs = context?.mentionedJid?.length ? context.mentionedJid : [context?.participant].filter(Boolean)
  const target = refs.length === 1 && group.participants.find(person => ids(person).includes(baileys.jidNormalizedUser(refs[0])))
  if (!target) throw new MemeInputError('Réponds à un membre du groupe ou mentionne un seul membre.')
  const text = args.replace(/@\d+\b/g,'').trim().slice(0,500)
  return socket.sendMessage(jid, { text: `@${target.id.split('@')[0]}${text ? ` ${text}` : ''}`, mentions: [target.id] })
}
