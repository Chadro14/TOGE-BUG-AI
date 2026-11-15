'use strict'

const { Resvg } = require('@resvg/resvg-js')
const QRCode = require('qrcode')
const { MemeInputError } = require('../doma-commandes.cjs')

const styles = {
  royaltext: ['#090e26', '#243264', '#f1cb77', '#fff3d5', 'serif'],
  luxurygold: ['#1b1008', '#433013', '#e9a941', '#ffed9b', 'serif'],
  gradienttext: ['#241751', '#0f3560', '#f084e9', '#5ce8ff', 'sans-serif'],
  glowingtext: ['#0c1924', '#174858', '#8af9ea', '#e2fffd', 'sans-serif', true],
  advancedglow: ['#060916', '#311c66', '#ad8bff', '#86edff', 'sans-serif', true],
  makingneon: ['#121527', '#271b60', '#f464d3', '#ffd7ff', 'sans-serif', true],
  multicoloredneon: ['#110e20', '#22324e', '#d765ff', '#73ffe2', 'sans-serif', true],
  galaxystyle: ['#090b23', '#432564', '#ffa0dd', '#acd9ff', 'serif', true],
  narutobanner: ['#301c12', '#642a11', '#ff9437', '#ffeab0', 'sans-serif'],
  romantic: ['#351023', '#70394c', '#ffe4ea', '#fcb5d3', 'serif'],
  starstext: ['#1a142f', '#3b3869', '#f5e5aa', '#f9f4ff', 'serif', true],
  shinetext: ['#121d35', '#2f5073', '#85adcc', '#f5ffff', 'sans-serif', true],
  rainboweffect: ['#170e30', '#2d2058', '#fb736c', '#73dfea', 'sans-serif'],
  shadow: ['#14171b', '#303946', '#b5c6da', '#e8eef4', 'sans-serif'],
  typographytext: ['#f5eadd', '#e3cfb0', '#2d2116', '#6d4531', 'serif'],
  smokyneon: ['#101220', '#414358', '#c6bcff', '#86ffeb', 'sans-serif', true],
  flamingtext: ['#280a07', '#861e10', '#ff6728', '#fff196', 'sans-serif', true],
  underwatertext: ['#04162e', '#075767', '#4bbcff', '#b3ffe7', 'sans-serif', true],
  stonetext: ['#1b2026', '#55595e', '#abb3bd', '#eef0ed', 'serif'],
  metalliceffect: ['#12161d', '#3b4d58', '#9cb5c6', '#efffff', 'sans-serif'],
  balloontext: ['#391630', '#713750', '#ff9ed6', '#ffdef2', 'sans-serif', true],
  summerbeach: ['#00435c', '#008c92', '#ffce79', '#fff6c2', 'serif'],
  papercutstyle: ['#3e294a', '#86476b', '#ffd1a8', '#fff2d6', 'serif'],
}

const escapeXml = text => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])

function makeTextArtwork(args, style = 'royaltext', compact = false) {
  const value = args.replace(/\s+/g, ' ').trim()
  if (!value || [...value].length > 45) throw new MemeInputError('Écris entre 1 et 45 caractères après la commande.')
  const [background, accent, from, to, font, glow] = styles[style]
  const height = compact ? 420 : 300
  const size = Math.min(88, Math.floor(650 / [...value].length * 1.55))
  const label = escapeXml(value)
  const effect = glow ? 'filter="url(#glow)"' : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}">
    <defs>
      <radialGradient id="bg"><stop stop-color="${accent}"/><stop offset="1" stop-color="${background}"/></radialGradient>
      <linearGradient id="ink"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
      <filter id="glow" x="-50%" y="-70%" width="200%" height="240%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <rect width="760" height="${height}" rx="24" fill="url(#bg)"/>
    <rect x="18" y="18" width="724" height="${height - 36}" rx="14" stroke="${from}" stroke-opacity=".65" fill="none"/>
    <g text-anchor="middle" font-family="${font}" font-weight="bold" font-size="${size}">
      <text x="380" y="${height / 2 + size * 0.32 + 3}" fill="${glow ? from : background}" ${effect}>${label}</text>
      <text x="380" y="${height / 2 + size * 0.32}" fill="url(#ink)">${label}</text>
    </g>
  </svg>`
  return new Resvg(svg).render().asPng()
}

async function makeQr(args) {
  if (!args || Buffer.byteLength(args) > 700) throw new MemeInputError('Utilise .toqr suivi d’un lien ou d’un texte court.')
  return QRCode.toBuffer(args, { type: 'png', width: 480, margin: 3, errorCorrectionLevel: 'M' })
}

module.exports = { styles, makeTextArtwork, makeQr }
