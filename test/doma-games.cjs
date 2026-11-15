'use strict'

const { randomInt } = require('node:crypto')
const { MemeInputError } = require('../doma-commandes.cjs')

const truths = [
  'Quelle habitude aimerais-tu changer cette année ?',
  'Quel talent as-tu que tes amis connaissent peu ?',
  'Quel est le meilleur conseil qu’on t’ait donné ?',
  'Quel rêve avais-tu quand tu étais enfant ?',
]
const dares = [
  'Décris ta journée en trois mots.',
  'Dessine un animal en trente secondes.',
  'Invente un titre pour le film de ta semaine.',
  'Écris une phrase qui rime avec « matin ».',
]
const facts = [
  'Les pieuvres ont trois cœurs.',
  'La lumière du Soleil met environ huit minutes à atteindre la Terre.',
  'Sur Vénus, un tour sur elle-même dure plus longtemps qu’un tour autour du Soleil.',
  'Le bambou appartient à la famille des graminées.',
]
const quotes = [
  'Connais-toi toi-même. — Maxime delphique',
  'Le cœur a ses raisons que la raison ne connaît point. — Blaise Pascal',
  'L’essentiel est invisible pour les yeux. — Antoine de Saint-Exupéry',
]
const randomItem = items => items[randomInt(items.length)]
const games = new Map()
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]

function math(args) {
  if (!args) {
    const a = randomInt(2, 13)
    const b = randomInt(2, 13)
    return `Combien font ${a} × ${b} ?\nVérifie ta réponse avec .math ${a} * ${b}.`
  }
  const match = /^(-?\d{1,7}(?:\.\d{1,8})?)\s*([+*/×÷-])\s*(-?\d{1,7}(?:\.\d{1,8})?)$/u.exec(args)
  if (!match) throw new MemeInputError('Entre un calcul simple, par exemple .math 12 * 7.')
  const [, left, operator, right] = match
  const a = Number(left)
  const b = Number(right)
  const operations = { '+': a + b, '-': a - b, '*': a * b, '×': a * b, '/': a / b, '÷': a / b }
  const result = operations[operator]
  if (!Number.isFinite(result)) throw new MemeInputError('La division par zéro est impossible.')
  return `${left} ${operator} ${right} = ${Number(result.toPrecision(14))}`
}

function suit(args) {
  const moves = ['pierre', 'papier', 'ciseaux']
  const player = moves.indexOf(args.toLowerCase())
  if (player === -1) throw new MemeInputError('Joue avec .suit pierre, .suit papier ou .suit ciseaux.')
  const bot = randomInt(moves.length)
  const result = player === bot ? 'Match nul.' : (player - bot + moves.length) % moves.length === 1 ? 'Tu as gagné.' : 'Domma a gagné.'
  return `Ton choix · ${moves[player]}\nDomma · ${moves[bot]}\n\n${result}`
}

function pick(args) {
  const choices = args.split('|').map(choice => choice.trim()).filter(Boolean)
  if (choices.length < 2 || args.length > 500) throw new MemeInputError('Sépare au moins deux choix avec |, par exemple .pick bleu|blanc.')
  return `Je choisis · ${randomItem(choices)}`
}

function tictactoe(args, chat) {
  const action = args.toLowerCase()
  if (action === 'stop') {
    games.delete(chat)
    return 'Partie terminée.'
  }
  const board = games.get(chat) ?? Array.from({ length: 9 }, (_, i) => String(i + 1))
  if (action === 'start') {
    games.delete(chat)
    return tictactoe('', chat)
  }
  const free = () => board.map((value, index) => ({ value, index })).filter(({ value }) => value !== 'X' && value !== 'O')
  const won = player => lines.some(line => line.every(index => board[index] === player))
  let status = 'Joue avec .tictactoe suivi du numéro d’une case.'
  if (action) {
    const square = free().find(entry => entry.value === action)
    if (!square) throw new MemeInputError('Choisis le numéro d’une case libre, ou utilise .tictactoe start.')
    board[square.index] = 'X'
    if (!won('X') && free().length) board[randomItem(free()).index] = 'O'
    if (won('X')) status = 'Tu as gagné.'
    else if (won('O')) status = 'Domma a gagné.'
    else if (!free().length) status = 'Match nul.'
  }
  if (won('X') || won('O') || !free().length) games.delete(chat)
  else games.set(chat, board)
  const grid = [0, 3, 6].map(start => board.slice(start, start + 3).join(' │ ')).join('\n──┼───┼──\n')
  return `${grid}\n\n${status}`
}

module.exports = {
  math, suit, pick, tictactoe,
  truth: () => randomItem(truths),
  dare: () => randomItem(dares),
  fact: () => randomItem(facts),
  quotes: () => randomItem(quotes),
}
