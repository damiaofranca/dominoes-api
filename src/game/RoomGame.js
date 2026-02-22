/**
 * Adapta DominoGame (lib dominoes) ao modelo de salas e sockets.
 * Uma sala tem N jogadores (por socketId + nome); quando está cheia, inicia o jogo.
 *
 * Regras de compra (draw):
 * - drawRule: 'draw_until_play' = comprar até poder jogar (ou monte acabar); 'draw_once_pass' = comprar uma vez e passar.
 * - maxDrawsPerTurn: limite de compras por turno (ex.: 1 para "uma compra e passa"; null = sem limite quando draw_until_play).
 */

import { DominoGame, DominoTile, DominoTileBoardPosition } from "./engine.js";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

export const DRAW_RULE_UNTIL_PLAY = "draw_until_play";
export const DRAW_RULE_ONCE_PASS = "draw_once_pass";

const DIRECTION_TO_POSITION = {
  top: DominoTileBoardPosition.start,
  bottom: DominoTileBoardPosition.end,
};

function clampMaxPlayers(n) {
  const num = Number(n);
  if (Number.isNaN(num) || num < MIN_PLAYERS) return MIN_PLAYERS;
  if (num > MAX_PLAYERS) return MAX_PLAYERS;
  return Math.floor(num);
}

export class RoomGame {
  constructor(roomId, maxPlayers, options = {}) {
    const clamped = clampMaxPlayers(maxPlayers);
    this.roomId = roomId;
    this.maxPlayers = clamped;
    this.drawRule = options.drawRule === DRAW_RULE_ONCE_PASS ? DRAW_RULE_ONCE_PASS : DRAW_RULE_UNTIL_PLAY;
    this.maxDrawsPerTurn =
      options.maxDrawsPerTurn != null ? Math.max(0, Math.floor(Number(options.maxDrawsPerTurn) || 0)) : null;
    if (this.drawRule === DRAW_RULE_ONCE_PASS && this.maxDrawsPerTurn === null) {
      this.maxDrawsPerTurn = 1;
    }
    this.players = [];
    this.game = null;
    this.drawsThisTurn = 0;
  }

  /** Retorna erro se maxPlayers inválido para criação de sala (uso no servidor). */
  static validateMaxPlayers(maxPlayers) {
    const n = Number(maxPlayers);
    if (Number.isNaN(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
      return { ok: false, reason: "invalid_max_players", min: MIN_PLAYERS, max: MAX_PLAYERS };
    }
    return { ok: true, maxPlayers: Math.floor(n) };
  }

  addPlayer(socketId, name) {
    if (this.game) return { ok: false, reason: "game_started" };
    if (this.players.length >= this.maxPlayers) return { ok: false, reason: "full" };
    if (this.players.some((p) => p.id === socketId)) return { ok: false, reason: "already_in" };
    this.players.push({ id: socketId, name: name || "Jogador" });
    if (this.players.length === this.maxPlayers) {
      this._startGame();
      return { ok: true, started: true };
    }
    return { ok: true, started: false };
  }

  _startGame() {
    this.game = new DominoGame(
      this.players.map((p) => ({ name: p.name, id: p.id }))
    );
  }

  isStarted() {
    return this.game !== null;
  }

  getPlayerIndex(socketId) {
    if (!this.game) return this.players.findIndex((p) => p.id === socketId);
    return this.game.getPlayerIndexById(socketId);
  }

  isCurrentPlayer(socketId) {
    return this.game && this.game.currentPlayer && this.game.currentPlayer.id === socketId;
  }

  makeMove(socketId, move, direction) {
    if (!this.game) return { ok: false, reason: "game_not_started" };
    if (!this.isCurrentPlayer(socketId)) return { ok: false, reason: "not_your_turn" };

    const tile = Array.isArray(move) ? DominoTile.fromArray(move) : move;
    const position = DIRECTION_TO_POSITION[direction] ?? null;

    try {
      const played = this.game.play(tile, position);
      if (!played) return { ok: false, reason: "invalid_move" };
      this.drawsThisTurn = 0;
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "invalid_move", message: err.message };
    }
  }

  askForPiece(socketId) {
    if (!this.game) return { ok: false, reason: "game_not_started" };
    if (!this.isCurrentPlayer(socketId)) return { ok: false, reason: "not_your_turn" };
    if (this.game.getPossibleTiles().length > 0) {
      return { ok: false, reason: "has_playable" };
    }

    const limit = this.maxDrawsPerTurn;
    if (limit !== null && this.drawsThisTurn >= limit) {
      const reason = this.drawRule === DRAW_RULE_ONCE_PASS ? "must_pass" : "max_draws_reached";
      return { ok: false, reason };
    }

    try {
      const tile = this.game.drawTileForCurrentPlayer();
      if (!tile) return { ok: false, reason: "pile_empty" };
      this.drawsThisTurn += 1;

      const canPlay = this.game.getPossibleTiles().length > 0;
      const pileEmpty = this.game.tilesPile.size() === 0;

      let passedTurn = false;
      if (!canPlay) {
        const shouldPass =
          this.drawRule === DRAW_RULE_ONCE_PASS ||
          (this.drawRule === DRAW_RULE_UNTIL_PLAY && pileEmpty) ||
          (limit !== null && this.drawsThisTurn >= limit);
        if (shouldPass) {
          const { nextPlayerId } = this.game.advanceTurnToNextPlayable();
          this.drawsThisTurn = 0;
          passedTurn = true;
          return { ok: true, tile: tile.toArray(), passedTurn: true, nextPlayerId };
        }
      }
      return { ok: true, tile: tile.toArray(), passedTurn: false, nextPlayerId: this.game.currentPlayer?.id ?? null };
    } catch (err) {
      return { ok: false, reason: "pile_empty" };
    }
  }

  getBoardTiles() {
    if (!this.game || !this.game.board.tiles.length) return [];
    return this.game.board.tiles.map((t) => t.toArray());
  }

  getHand(socketId) {
    if (!this.game) return null;
    const idx = this.game.getPlayerIndexById(socketId);
    if (idx === null) return null;
    return this.game.players[idx].hand.map((t) => t.toArray());
  }

  getPlayersSummary(excludeSocketId = null) {
    if (!this.game) {
      return this.players.map((p) => ({ id: p.id, name: p.name, total: 0 }));
    }
    return this.game.players
      .filter((p) => p.id !== excludeSocketId)
      .map((p) => ({ id: p.id, name: p.name, total: p.hand.length }));
  }

  getCurrentPlayerId() {
    return this.game?.currentPlayer?.id ?? null;
  }

  getPossibleTiles(socketId) {
    if (!this.game || !this.isCurrentPlayer(socketId)) return [];
    return this.game.getPossibleTiles().map((t) => t.toArray());
  }

  isOver() {
    return this.game ? this.game.isOver() : false;
  }

  getWinner() {
    if (!this.game || !this.isOver()) return null;
    const winner = this.game.getWinner();
    return winner ? { id: winner.id, name: winner.name, points: this.game.getWinnerPoints() } : null;
  }

  getRemainingPileCount() {
    return this.game ? this.game.tilesPile.size() : 0;
  }
}
