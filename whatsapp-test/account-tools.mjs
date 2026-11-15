import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemeInputError, formatReply } from '../doma-commandes.cjs'

const STATUS = 'status@broadcast'
const CACHE_TTL = 60 * 60 * 1000
const DEFAULT_REACTION = '❤️'
const EMOJI = /^(?:\p{RGI_Emoji})$/v
const DEFAULTS = { antidelete: false, autoview: false, autoreact: false, reaction: DEFAULT_REACTION }
const GROUP_SETTINGS = { groupopen: 'not_announcement', groupclose: 'announcement' }
const MEMBER_ACTIONS = { kick: 'remove', promote: 'promote', demote: 'demote' }

export async function accountTools(socket, baileys, dir, reportError = () => {}) {
  const {
    isLidUser, isPnUser, jidNormalizedUser, normalizeMessageContent, proto,
  } = baileys
  const path = join(dir, 'domma-settings.json')
  const settings = { ...DEFAULTS }
  const stored = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') reportError('Réglages WhatsApp illisibles.')
    return null
  })
  for (const name of ['antidelete', 'autoview', 'autoreact']) settings[name] = stored?.[name] === true
  if (typeof stored?.reaction === 'string' && EMOJI.test(stored.reaction)) settings.reaction = stored.reaction

  const inbox = new Map()
  const processedStatuses = new Set()
  let expiration
  let saving = Promise.resolve()

  function expireMessages() {
    clearTimeout(expiration)
    const now = Date.now()
    for (const [key, value] of inbox) {
      if (value.expiresAt > now) {
        expiration = setTimeout(expireMessages, value.expiresAt - now).unref()
        return
      }
      inbox.delete(key)
    }
    expiration = undefined
  }

  function changeSetting(name, args) {
    const [state, emoji, extra] = args.trim().split(/\s+/)
    const mode = state.toLowerCase()
    if (!mode) return Promise.resolve(settingStatus(name))
    if (!['on', 'off'].includes(mode) || extra || (emoji && (name !== 'autoreact' || mode !== 'on' || !EMOJI.test(emoji)))) {
      throw new MemeInputError(name === 'autoreact' ? 'Utilise .autoreact on [emoji] ou .autoreact off.' : `Utilise .${name} on ou .${name} off.`)
    }
    const save = saving.then(async () => {
      const next = { ...settings, [name]: mode === 'on' }
      if (emoji) next.reaction = emoji
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
        await rename(temp, path)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
      Object.assign(settings, next)
      if (name === 'antidelete' && !settings.antidelete) {
        inbox.clear()
        expireMessages()
      }
      return settingStatus(name)
    })
    saving = save.catch(() => {})
    return save
  }

  function settingStatus(name) {
    const state = settings[name] ? 'activé' : 'désactivé'
    if (name === 'antidelete') return `Anti-delete ${state}. Textes privés ordinaires conservés en mémoire jusqu’à une heure.`
    if (name === 'autoview') return `Lecture automatique des nouveaux statuts ${state}.`
    return `Réaction automatique aux nouveaux statuts ${state}.${settings[name] ? ` Emoji : ${settings.reaction}` : ''}`
  }

  function isPrivate(jid) {
    return isLidUser(jid) || isPnUser(jid)
  }

  function handlePrivate(entry) {
    if (!settings.antidelete || !isPrivate(entry.key.remoteJid) || entry.key.fromMe || !entry.key.id) return
    const content = entry.message
    const now = Date.now()
    const protocol = content?.protocolMessage
    if (protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
      const key = `${entry.key.remoteJid}\0${protocol.key?.id}`
      const original = inbox.get(key)
      if (!original || original.expiresAt <= now) return
      inbox.delete(key)
      const me = jidNormalizedUser(socket.user.id)
      return socket.sendMessage(me, {
        text: formatReply('Anti-delete', `Message supprimé · ${original.sender}\n\n${original.text}`),
        linkPreview: null,
      })
    }
    const extended = content?.extendedTextMessage
    if (extended?.contextInfo?.expiration || content?.ephemeralMessage) return
    const text = content?.conversation ?? extended?.text
    const key = `${entry.key.remoteJid}\0${entry.key.id}`
    if (typeof text !== 'string' || !text.trim() || inbox.has(key)) return
    if (inbox.size >= 300) inbox.delete(inbox.keys().next().value)
    inbox.set(key, {
      sender: entry.pushName || entry.key.remoteJid,
      text: text.length > 4000 ? `${text.slice(0, 3999)}…` : text,
      expiresAt: now + CACHE_TTL,
    })
    if (!expiration) expireMessages()
  }

  async function handleStatus(entry) {
    if (!settings.autoview && !settings.autoreact) return
    const { key } = entry
    const sender = jidNormalizedUser(key.participant)
    if (!key.id || key.fromMe || !isPrivate(sender)) return
    const content = normalizeMessageContent(entry.message)
    if (!content || !(content.conversation || content.extendedTextMessage || content.imageMessage || content.videoMessage || content.audioMessage || content.stickerMessage)) return
    const statusId = `${sender}\0${key.id}`
    if (processedStatuses.has(statusId)) return
    if (processedStatuses.size >= 500) processedStatuses.delete(processedStatuses.values().next().value)
    processedStatuses.add(statusId)
    if (settings.autoview) await socket.readMessages([key]).catch(() => reportError('Lecture automatique du statut indisponible.'))
    if (settings.autoreact) {
      const ownId = isLidUser(sender) && socket.user.lid ? socket.user.lid : socket.user.id
      await socket.sendMessage(STATUS, { react: { text: settings.reaction, key } }, {
        statusJidList: [sender, jidNormalizedUser(ownId)],
      }).catch(() => reportError('Réaction automatique au statut indisponible.'))
    }
  }

  return {
    run: (name, args, context) => Object.hasOwn(DEFAULTS, name) ? changeSetting(name, args) : runGroupCommand(socket, jidNormalizedUser, name, args, context),
    onIncoming: entry => entry.key.remoteJid === STATUS ? handleStatus(entry) : handlePrivate(entry),
  }
}

async function runGroupCommand(socket, normalize, name, args, { jid, ownJids, quotedJid, mentionedJids }) {
  const group = await socket.groupMetadata(jid)
  if (name === 'groupinfo') {
    return [group.subject, `${group.participants.length} membres`, group.announce ? 'Messages réservés aux admins.' : 'Tous les membres peuvent écrire.', group.desc].filter(Boolean).join('\n')
  }

  const ids = participant => [participant.id, participant.lid, participant.phoneNumber].filter(Boolean).map(normalize)
  const me = group.participants.find(participant => ids(participant).some(id => ownJids.has(id)))
  if (!me?.admin && !me?.isAdmin && !me?.isSuperAdmin) {
    throw new MemeInputError('Ton compte WhatsApp doit être administrateur de ce groupe.')
  }

  if (Object.hasOwn(GROUP_SETTINGS, name)) {
    await socket.groupSettingUpdate(jid, GROUP_SETTINGS[name])
    return name === 'groupopen' ? 'Le groupe est ouvert à tous les membres.' : 'Seuls les admins peuvent envoyer des messages.'
  }

  if (name === 'groupname' || name === 'groupdesc') {
    if (!args || args.length > (name === 'groupname' ? 100 : 2048)) {
      throw new MemeInputError(`Utilise .${name} suivi du nouveau texte.`)
    }
    if (name === 'groupname') {
      await socket.groupUpdateSubject(jid, args)
      return 'Nom du groupe modifié.'
    }
    await socket.groupUpdateDescription(jid, args)
    return 'Description du groupe modifiée.'
  }

  const references = mentionedJids.length ? mentionedJids : quotedJid ? [quotedJid] : []
  const mentions = new Set(references.map(normalize))
  const targets = group.participants.filter(participant => ids(participant).some(id => mentions.has(id)))
  if (targets.length !== 1 || references.length !== 1) throw new MemeInputError('Réponds à un seul membre du groupe ou mentionne-le.')
  const target = targets[0]
  if (target === me || target.admin === 'superadmin' || target.isSuperAdmin || ids(target).some(id => id === normalize(group.owner))) {
    throw new MemeInputError('Choisis un membre différent de ton compte et du créateur du groupe.')
  }
  const result = await socket.groupParticipantsUpdate(jid, [target.id], MEMBER_ACTIONS[name])
  if (result.length !== 1 || String(result[0].status) !== '200') throw new MemeInputError('WhatsApp a refusé cette modification.')
  return { kick: 'Membre retiré du groupe.', promote: 'Membre promu administrateur.', demote: 'Droits d’administration retirés.' }[name]
}
