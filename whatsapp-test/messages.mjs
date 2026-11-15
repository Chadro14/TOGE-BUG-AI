import { handleDomaMessage, parseDomaCommand } from '../test/doma-message-handler.cjs'
import { MemeInputError } from '../doma-commandes.cjs'
import { accountTools } from './account-tools.mjs'

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

function containsViewOnce(content) {
  for (let depth = 0; content && depth < 6; depth++) {
    if (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension || getMedia(content)?.msg.viewOnce) return true
    content = (content.ephemeralMessage || content.documentWithCaptionMessage || content.editedMessage
      || content.associatedChildMessage || content.groupStatusMessage || content.groupStatusMessageV2)?.message
  }
  return Boolean(content)
}

function getMenuSelection(content) {
  const response = content?.interactiveResponseMessage?.nativeFlowResponseMessage
  let id = content?.listResponseMessage?.singleSelectReply?.selectedRowId
  if (response?.paramsJson) {
    try {
      const params = JSON.parse(response.paramsJson)
      id ??= params?.id ?? params?.selected_row_id ?? params?.selectedRowId
    } catch {
      // A malformed native-flow reply can still contain a classic list reply.
    }
  }
  const selection = typeof id === 'string' && /^domma-menu:([a-z]+)$/.exec(id)
  return selection ? `.menu ${selection[1]}` : undefined
}

export function bindCommands(socket, baileys, dir, logMenu = () => {}) {
  const {
    downloadContentFromMessage, isJidGroup, jidNormalizedUser, normalizeMessageContent, proto,
    prepareWAMessageMedia, generateWAMessageFromContent, generateMessageIDV2,
  } = baileys
  const connectedSince = Math.floor(Date.now() / 1000)
  const handledCommands = new Set()
  const toolsReady = accountTools(socket, baileys, dir, logMenu)

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
    const videoOptions = { options: { timeout: 15000 }, mediaUploadTimeoutMs: 20000 }
    const contextInfo = { forwardingScore: 1, isForwarded: true }
    if (!video) {
      await socket.sendMessage(jid, { text, contextInfo, linkPreview: null })
      return
    }

    const media = { video: { url: video }, mimetype: 'video/mp4' }

    try {
      const { videoMessage } = await prepareWAMessageMedia(media, { ...videoOptions, upload: socket.waUploadToServer })
      const message = proto.Message.fromObject({
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
            interactiveMessage: {
              header: { hasMediaAttachment: true, videoMessage },
              body: { text },
              contextInfo,
              nativeFlowMessage: {
                messageVersion: 1,
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
        additionalNodes: [
          {
            tag: 'biz', attrs: {}, content: [
              { tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [
                { tag: 'native_flow', attrs: { name: 'mixed', v: '9' } },
              ] },
              { tag: 'quality_control', attrs: { source_type: 'third_party' } },
            ],
          },
          { tag: 'bot', attrs: { biz_bot: '1' } },
        ],
      })
    } catch {
      try {
        await socket.sendMessage(jid, { ...media, caption: text, contextInfo }, videoOptions)
      } catch {
        await socket.sendMessage(jid, { text, contextInfo, linkPreview: null })
      }
      logMenu('Bouton du menu indisponible pour cet envoi.')
    }
  }

  return async function onMessages({ type, messages, requestId }) {
    if (!socket.user || (type !== 'notify' && type !== 'append')) return
    const tools = await toolsReady
    const ownJids = new Set([socket.user.id, socket.user.lid].filter(Boolean).map(jidNormalizedUser))
    for (const entry of messages) {
      const { key } = entry
      if (!key?.remoteJid) continue
      const ownChat = [key.remoteJid, key.remoteJidAlt].some(jid => jid && ownJids.has(jidNormalizedUser(jid)))
      const groupChat = isJidGroup(key.remoteJid)
      const timestamp = Number(entry.messageTimestamp)
      const recent = Number.isFinite(timestamp) && timestamp >= connectedSince
      if (type === 'notify' && !requestId && recent && !ownChat && !key.fromMe && entry.message) {
        try {
          await tools.onIncoming(entry)
        } catch {
          logMenu('Traitement automatique WhatsApp indisponible.')
        }
      }
      if (!entry.message && entry.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
        if (ownChat && (type === 'notify' || recent)) {
          logMenu('Message chiffré non lisible dans la conversation personnelle. Réception en attente du renvoi WhatsApp.')
        }
        continue
      }

      const content = normalizeMessageContent(entry.message)
      const selection = getMenuSelection(content)
      const media = containsViewOnce(entry.message) ? undefined : getMedia(content)
      const body = selection ?? content?.conversation ?? content?.extendedTextMessage?.text ?? media?.msg.caption
      const parsed = parseDomaCommand(body)
      if (!parsed || ((type === 'append' || requestId) && (!key.id || !recent))) continue
      const isMenu = parsed.command.name === 'menu'
      if (!key.fromMe || (!ownChat && !(groupChat && parsed.command.groupOnly))) {
        if (isMenu && key.fromMe) logMenu('Commande .menu ignorée : conversation personnelle non reconnue.')
        continue
      }

      if (key.id && handledCommands.has(key.id)) continue
      if (key.id) {
        if (handledCommands.size >= 128) handledCommands.delete(handledCommands.values().next().value)
        handledCommands.add(key.id)
      }
      if (isMenu || parsed.command.name === 'ping') logMenu(`Commande .${parsed.command.name} reçue (${selection ? 'sélecteur' : type}).`)

      const context = content?.extendedTextMessage?.contextInfo ?? media?.msg.contextInfo
      const quoted = containsViewOnce(context?.quotedMessage) ? undefined : getMedia(normalizeMessageContent(context?.quotedMessage))
      try {
        await handleDomaMessage({ chat: key.remoteJid, ...media, quoted }, {
          downloadMedia,
          sendMenu,
          send: (jid, reply) => socket.sendMessage(jid, reply),
          whatsapp: (name, args) => {
            if (parsed.command.groupOnly && !groupChat) throw new MemeInputError('Utilise cette commande dans le groupe WhatsApp concerné.')
            return tools.run(name, args, {
              jid: key.remoteJid,
              ownJids,
              quotedJid: context?.participant,
              mentionedJids: context?.mentionedJid ?? [],
            })
          },
        }, parsed)
        if (isMenu || parsed.command.name === 'ping') logMenu(`Réponse .${parsed.command.name} envoyée.`)
      } catch {
        if (key.id) handledCommands.delete(key.id)
        logMenu(`Échec de la réponse .${parsed.command.name}.`)
      }
    }
  }
}
