/**
 * Engine baseada na biblioteca "dominoes" (posva).
 * Expõe as classes da lib em ESM para uso no servidor.
 */

const DominoTileBoardPosition = Object.freeze({
  none: 0,
  start: 1,
  end: 2,
  both: 3,
});

class DominoTile {
  start;
  end;
  direction = 1; // vertical

  constructor(start, end) {
    if (start < 0 || start > 6 || end < 0 || end > 6) {
      throw new Error(`Invalid values ${start} / ${end}.`);
    }
    this.start = start;
    this.end = end;
  }

  get value() {
    return `${this.start}:${this.end}`;
  }

  get points() {
    return this.start + this.end;
  }

  is(tileOrStart, tileEnd) {
    const start = typeof tileOrStart === "number" ? tileOrStart : tileOrStart.start;
    const end = typeof tileOrStart === "number" ? tileEnd : tileOrStart.end;
    return (this.start === start && this.end === end) || (this.end === start && this.start === end);
  }

  isDouble() {
    return this.start === this.end;
  }

  turn() {
    const start = this.start;
    this.start = this.end;
    this.end = start;
    return this;
  }

  toArray() {
    return [this.start, this.end];
  }

  static fromArray([start, end]) {
    return new DominoTile(start, end);
  }
}

class Player {
  name;
  hand = [];
  id = null; // socket id ou identificador da sala

  constructor(name, id = null) {
    this.name = name;
    this.id = id;
  }

  addToHand(tiles) {
    if (Array.isArray(tiles)) {
      this.hand.push(...tiles);
    } else {
      this.hand.push(tiles);
    }
  }

  getHandPoints() {
    return this.hand.reduce((total, tile) => total + tile.points, 0);
  }

  hasTile(tileOrStart, tileEnd) {
    return this.hand.some((tile) => tile.is(tileOrStart, tileEnd));
  }

  useTile(tile) {
    const index = this.hand.findIndex((t) => t.is(tile));
    if (index < 0) {
      throw new Error(`Player ${this.name} doesn't have ${tile}.`);
    }
    return this.hand.splice(index, 1)[0];
  }
}

function shuffle(array) {
  let i = array.length;
  let temp;
  while (i > 0) {
    const j = Math.floor(Math.random() * i);
    i--;
    temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

class DominoTileBoard {
  tiles = [];
  center = 0;

  placeTile(tile, position) {
    if (!this.tiles.length) {
      this.tiles.push(tile);
      return;
    }
    const possiblePosition = this.canPlaceTile(tile);
    if (position ? !(possiblePosition & position) : !possiblePosition) {
      throw new Error(`Tile ${tile} cannot be placed in that position.`);
    }
    position = position || possiblePosition;
    const targetTile = position === DominoTileBoardPosition.end ? this.tiles[this.tiles.length - 1] : this.tiles[0];
    const targetValue = position === DominoTileBoardPosition.end ? targetTile.end : targetTile.start;
    if (position === DominoTileBoardPosition.end) {
      if (tile.value.endsWith(`${targetValue}`)) {
        tile.turn();
      }
      this.tiles.push(tile);
    } else {
      if (tile.value.startsWith(`${targetValue}`)) {
        tile.turn();
      }
      this.center++;
      this.tiles.unshift(tile);
    }
  }

  canPlaceTile(tile) {
    if (!this.tiles.length) {
      return DominoTileBoardPosition.both;
    }
    const startTile = this.tiles[0];
    const endTile = this.tiles[this.tiles.length - 1];
    const canOnStart = tile.value.includes(`${startTile.start}`);
    const canOnEnd = tile.value.includes(`${endTile.end}`);
    if (canOnStart) {
      return canOnEnd ? DominoTileBoardPosition.both : DominoTileBoardPosition.start;
    }
    return canOnEnd ? DominoTileBoardPosition.end : DominoTileBoardPosition.none;
  }
}

class DominoTilePile {
  tiles = [];

  constructor() {
    for (let i = 0; i <= 6; i++) {
      for (let j = i; j <= 6; j++) {
        this.tiles.push(new DominoTile(i, j));
      }
    }
  }

  shuffle() {
    shuffle(this.tiles);
  }

  size() {
    return this.tiles.length;
  }

  pull(n = 1) {
    if (this.size() < n) {
      throw new Error(`Tile Stack only has ${this.size()} tiles left.`);
    }
    return n < 2 ? this.tiles.shift() : this.tiles.splice(0, n);
  }
}

class EventEmitter {
  constructor(all = new Map()) {
    this.all = all;
  }

  on(type, handler) {
    if (!this.all.has(type)) {
      this.all.set(type, []);
    }
    this.all.get(type).push(handler);
    return () => {
      const handlers = this.all.get(type);
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  emit(type, evt) {
    const handlers = this.all.get(type);
    if (handlers) {
      handlers.slice().forEach((handler) => handler(evt));
    }
    const star = this.all.get("*");
    if (star) {
      star.slice().forEach((handler) => handler(type, evt));
    }
  }
}

class DominoGame extends EventEmitter {
  nextPlayerIndex = 0;
  players = [];
  tilesPile = new DominoTilePile();
  board = new DominoTileBoard();

  constructor(playersConfig) {
    super();
    // playersConfig: [{ name, id }, ...]
    if (playersConfig.length > 4 || playersConfig.length < 2) {
      throw new Error("Can only have between 2 and 4 players.");
    }
    this.players = playersConfig.map((p) => new Player(p.name, p.id));
    this.tilesPile.shuffle();
    this.players.forEach((player, i) => {
      player.addToHand(this.tilesPile.pull(7));
      this.emit("playerUpdate", player);
      if (player.hasTile(6, 6)) {
        this.nextPlayerIndex = i;
      }
    });
    this.emit("boardUpdate", this.board);
  }

  get currentPlayer() {
    return this.players[this.nextPlayerIndex];
  }

  getPlayerIndexById(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    return idx >= 0 ? idx : null;
  }

  play(tile, position) {
    if (!this.currentPlayer.hasTile(tile)) return false;
    if (!this.board.canPlaceTile(tile)) return false;
    const targetTile = this.currentPlayer.useTile(tile);
    this.board.placeTile(targetTile, position);
    this.emit("playerPlay", [this.currentPlayer, targetTile]);
    this.emit("boardUpdate", this.board);

    if (this.isOver()) {
      const winner = this.getWinner();
      this.emit("gameEnd", winner ? [winner, this.getWinnerPoints()] : []);
      return true;
    }

    this.nextPlayerIndex = (this.nextPlayerIndex + 1) % this.players.length;
    while (!this.getPossibleTiles().length && !this.isOver()) {
      this.emit("playerSkip", this.currentPlayer);
      this.nextPlayerIndex = (this.nextPlayerIndex + 1) % this.players.length;
    }
    return true;
  }

  isLocked() {
    return this.players.every((p) => p.hand.every((t) => !this.board.canPlaceTile(t)));
  }

  isOver() {
    return this.isLocked() || this.players.some((player) => !player.hand.length);
  }

  getWinner() {
    const emptyHandPlayer = this.players.find((p) => !p.hand.length);
    if (emptyHandPlayer) return emptyHandPlayer;
    if (!this.isLocked()) return null;
    // Jogo fechado: quem tem menos pontos ganha
    if (this.players.length === 2) {
      const [a, b] = this.players;
      return a.getHandPoints() <= b.getHandPoints() ? a : b;
    }
    if (this.players.length === 4) {
      const pair1 = this.players[0].getHandPoints() + this.players[2].getHandPoints();
      const pair2 = this.players[1].getHandPoints() + this.players[3].getHandPoints();
      return pair1 <= pair2 ? this.players[0] : this.players[1];
    }
    const sorted = [...this.players].sort((a, b) => a.getHandPoints() - b.getHandPoints());
    return sorted[0];
  }

  getWinnerPoints() {
    return Math.floor(this.players.reduce((total, p) => total + p.getHandPoints(), 0) / 10);
  }

  getPossibleTiles() {
    return this.currentPlayer.hand.filter((tile) => this.board.canPlaceTile(tile));
  }

  drawTileForCurrentPlayer() {
    if (this.tilesPile.size() === 0) return null;
    const tile = this.tilesPile.pull(1);
    this.currentPlayer.addToHand(tile);
    this.emit("playerUpdate", this.currentPlayer);
    return tile;
  }

  /**
   * Avança o turno até um jogador que possa jogar ou até o jogo terminar.
   * Emite "playerSkip" para cada jogador pulado.
   * @returns {{ advanced: boolean, nextPlayerId: string | null }} nextPlayerId = id do novo currentPlayer, ou null se jogo acabou
   */
  advanceTurnToNextPlayable() {
    if (this.isOver()) return { advanced: false, nextPlayerId: null };
    while (!this.getPossibleTiles().length && !this.isOver()) {
      this.emit("playerSkip", this.currentPlayer);
      this.nextPlayerIndex = (this.nextPlayerIndex + 1) % this.players.length;
    }
    const nextId = this.isOver() ? null : this.currentPlayer?.id ?? null;
    return { advanced: true, nextPlayerId: nextId };
  }
}

export {
  DominoTile,
  DominoTileBoard,
  DominoTileBoardPosition,
  DominoTilePile,
  DominoGame,
  Player,
};
