import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemeInputError } from '../doma-commandes.cjs'

export const settingsCommands = new Map([
  ['setprefix', 'Configurer le préfixe des commandes'],
  ['public', 'Régler l’accès aux commandes'],
  ['anticall', 'Activer ou couper le refus automatique des appels'],
  ['welcome', 'Activer un message de bienvenue dans le groupe'],
  ['antilink', 'Modérer les liens d’invitation WhatsApp dans le groupe'],
  ['antistatus', 'Modérer les statuts partagés dans le groupe'],
])

export async function xeliraSettings(socket, baileys, dir, log, isActive) {
  const path = join(dir, 'xelira-settings.json')
  const state = { prefix: '.', public: true, anticall: false, welcome: [], antilink: [], antistatus: [] }
  const saved = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') log('Xelira MD : réglages illisibles.')
    return null
  })
  if (typeof saved?.prefix === 'string' && /^[.!#?%+~&-]$/.test(saved.prefix)) state.prefix = saved.prefix
  for (const name of ['public', 'anticall']) if (typeof saved?.[name] === 'boolean') state[name] = saved[name]
  for (const name of ['welcome', 'antilink', 'antistatus']) {
    if (Array.isArray(saved?.[name])) state[name] = saved[name].filter(id => typeof id === 'string' && baileys.isJidGroup(id)).slice(0, 150)
  }
  let saving = Promise.resolve()

  function save(change) {
    const next = saving.then(async () => {
      const updated = { ...state, ...change(state) }
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, JSON.stringify(updated), { flag: 'wx', mode: 0o600 })
        await rename(temp, path)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
      Object.assign(state, updated)
    })
    saving = next.catch(() => {})
    return next
  }

  socket.ev?.on('call', offers => {
    if (!state.anticall || !isActive()) return
    for (const { id, from, status, isGroup } of offers) {
      if (status === 'offer' && !isGroup && id && from) {
        void socket.rejectCall(id, from).catch(() => log('Xelira MD : appel non refusé.'))
      }
    }
  })

  socket.ev?.on('group-participants.update', async ({ id, participants, action }) => {
    if (!isActive() || action !== 'add' || !state.welcome.includes(id) || !participants.length) return
    await socket.sendMessage(id, { text: participants.length === 1 ? 'Bienvenue dans le groupe !' : 'Bienvenue aux nouveaux membres !' })
      .catch(() => log('Xelira MD : bienvenue non envoyée.'))
  })

  return {
    state,
    async moderateGroup(key, text, ownJids, isGroupStatus) {
      const jid = key.remoteJid
      const matchesRule = (isGroupStatus && state.antistatus.includes(jid))
        || (state.antilink.includes(jid) && /\bhttps?:\/\/chat\.whatsapp\.com\/[a-z\d]{15,32}\b/i.test(text))
      if (!key.id || !key.participant || key.fromMe || !matchesRule) return false
      const group = await socket.groupMetadata(jid)
      const ids = person => [person.id, person.lid, person.phoneNumber].filter(Boolean).map(baileys.jidNormalizedUser)
      const senderIds = new Set([key.participant, key.participantAlt].filter(Boolean).map(baileys.jidNormalizedUser))
      const self = group.participants.find(person => ids(person).some(id => ownJids.has(id)))
      const sender = group.participants.find(person => ids(person).some(id => senderIds.has(id)))
      if (!sender || sender === self || isAdmin(sender) || !isAdmin(self) || !isActive()) return false
      await socket.sendMessage(jid, { delete: key })
      return true
    },
    async run(name, args, { jid, ownChat, key, ownJids, reply }) {
      if (!key.fromMe) return
      const groupSetting = Array.isArray(state[name])
      if (!groupSetting && !ownChat) throw new MemeInputError('Utilise ce réglage dans ta conversation personnelle.')
      if (name === 'setprefix') {
        if (!args) return reply(`Préfixe actuel · ${state.prefix}`)
        if (!/^[.!#?%+~&-]$/.test(args)) throw new MemeInputError('Choisis un caractère parmi . ! # ? % + ~ & -')
        await save(() => ({ prefix: args }))
        return reply(`Préfixe enregistré · ${args}menu`)
      }
      const mode = args.toLowerCase()
      if (mode && !['on', 'off'].includes(mode)) throw new MemeInputError(`Utilise ${state.prefix}${name} on ou off.`)
      if (groupSetting) {
        if (!baileys.isJidGroup(jid)) throw new MemeInputError('Utilise ce réglage dans le groupe concerné.')
        const group = await socket.groupMetadata(jid)
        const self = group.participants.find(person => [person.id, person.lid, person.phoneNumber].some(id =>
          id && ownJids.has(baileys.jidNormalizedUser(id))))
        if (!isAdmin(self)) throw new MemeInputError('Tu dois être administrateur du groupe.')
        if (mode) await save(current => {
          const groups = current[name].filter(id => id !== jid)
          if (mode === 'on') {
            if (groups.length >= 150) throw new MemeInputError('Tu as atteint le nombre maximal de groupes configurés.')
            groups.push(jid)
          }
          return { [name]: groups }
        })
        const label = { welcome: 'Bienvenue', antilink: 'Modération des liens d’invitation', antistatus: 'Modération des statuts de groupe' }[name]
        return reply(`${label} ${state[name].includes(jid) ? 'activée' : 'désactivée'} pour ce groupe.`)
      }
      if (mode) await save(() => ({ [name]: mode === 'on' }))
      return reply(name === 'public' ? `Commandes publiques ${state.public ? 'activées' : 'désactivées'}.`
        : `Refus automatique des appels ${state.anticall ? 'activé' : 'désactivé'}.`)
    },
  }
}

function isAdmin(person) {
  return Boolean(person?.admin || person?.isAdmin || person?.isSuperAdmin)
}
