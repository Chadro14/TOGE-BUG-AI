import { handleDomaMessage, parseDomaCommand } from '../test/doma-message-handler.cjs'
import { MemeInputError } from '../doma-commandes.cjs'

const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
}

function getMedia(content) {
  const mtype = Object.keys(MEDIA_TYPES).find(type => content?.[type])
  return mtype && { mtype, msg: content[mtype] }
}

export function bindCommands(socket, baileys, logMenu = () => {}) {
  const {
    downloadContentFromMessage, jidNormalizedUser, normalizeMessageContent, proto,
    prepareWAMessageMedia, generateWAMessageFromContent, generateMessageIDV2,
  } = baileys
  const connectedSince = Math.floor(Date.now() / 1000)
  const handledCommands = new Set()

  async function downloadMedia({ mtype, msg }, maxBytes) {
    const tooLarge = () => new MemeInputError(`Le fichier dépasse ${maxBytes / (1024 * 1024)} Mo.`)
    if (Number(msg.fileLength) > maxBytes) throw tooLarge()
    const stream = await downloadContentFromMessage(msg, MEDIA_TYPES[mtype])
    const chunks = []
    let bytes = 0
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > maxBytes) throw tooLarge()
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, bytes)
  }

  async function sendMenu(jid, { text, video, channel }) {
    const media = { video: { url: video }, mimetype: 'video/mp4' }
    const caption = `${text}\n\nVoir la chaîne\n${channel}`
    try {
      const { videoMessage } = await prepareWAMessageMedia(media, {
        upload: socket.waUploadToServer,
        options: { timeout: 15000 },
        mediaUploadTimeoutMs: 20000,
      })
      const message = proto.Message.fromObject({
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
            interactiveMessage: {
              header: { hasMediaAttachment: true, videoMessage },
              body: { text: caption },
              nativeFlowMessage: {
                buttons: [{
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({ display_text: 'Voir la chaîne', url: channel, merchant_url: channel }),
                }],
              },
            },
          },
        },
      })
      const outgoing = generateWAMessageFromContent(jid, message, {
        userJid: socket.user.id,
        messageId: generateMessageIDV2(socket.user.id),
      })
      await socket.relayMessage(jid, outgoing.message, {
        messageId: outgoing.key.id,
        additionalNodes: [{
          tag: 'biz', attrs: {}, content: [{
            tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{
              tag: 'native_flow', attrs: { name: 'mixed', v: '9' },
            }],
          }],
        }],
      })
    } catch {
      logMenu('Menu interactif indisponible, envoi du menu vidéo standard.')
      try {
        await socket.sendMessage(jid, { ...media, caption }, { options: { timeout: 15000 }, mediaUploadTimeoutMs: 20000 })
      } catch {
        logMenu('Vidéo du menu indisponible, envoi du menu texte.')
        await socket.sendMessage(jid, { text: caption })
      }
    }
    logMenu('Réponse .menu envoyée.')
  }

  return async function onMessages({ type, messages, requestId }) {
    if (requestId || !socket.user || (type !== 'notify' && type !== 'append')) return
    const ownJids = new Set([socket.user.id, socket.user.lid].filter(Boolean).map(jidNormalizedUser))
    for (const entry of messages) {
      const { key } = entry
      const ownChat = key.remoteJid && ownJids.has(jidNormalizedUser(key.remoteJid))
      const timestamp = Number(entry.messageTimestamp)
      const recent = Number.isFinite(timestamp) && timestamp >= connectedSince
      if (!entry.message && entry.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
        if (ownChat && (type === 'notify' || recent)) {
          logMenu('Message chiffré non lisible dans la conversation personnelle. Réception en attente du renvoi WhatsApp.')
        }
        continue
      }

      const content = normalizeMessageContent(entry.message)
      const media = getMedia(content)
      const body = content?.conversation ?? content?.extendedTextMessage?.text ?? media?.msg.caption
      const parsed = parseDomaCommand(body)
      if (!parsed || (type === 'append' && (!key.id || !recent))) continue
      const isMenu = parsed.command.name === 'menu'
      if (!key.fromMe || !ownChat) {
        if (isMenu && key.fromMe) logMenu('Commande .menu ignorée : conversation personnelle non reconnue.')
        continue
      }

      if (key.id && handledCommands.has(key.id)) continue
      if (key.id) {
        if (handledCommands.size >= 128) handledCommands.delete(handledCommands.values().next().value)
        handledCommands.add(key.id)
      }
      if (isMenu) logMenu(`Commande .menu reçue (${type}).`)

      const context = content?.extendedTextMessage?.contextInfo ?? media?.msg.contextInfo
      const quoted = getMedia(normalizeMessageContent(context?.quotedMessage))
      try {
        await handleDomaMessage({ chat: key.remoteJid, ...media, quoted }, {
          downloadMedia,
          sendMenu,
          send: (jid, reply) => socket.sendMessage(jid, reply),
        }, parsed)
      } catch {
        if (key.id) handledCommands.delete(key.id)
        logMenu(`Échec de la réponse .${parsed.command.name}.`)
      }
    }
  }
}
