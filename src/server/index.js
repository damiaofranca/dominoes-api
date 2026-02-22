import cors from "cors";
import express from "express";
import { createServer } from "http";
import { RoomGame } from "../game/RoomGame.js";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);

// using ws directly; the server already handles CORS via http layer
const wss = new WebSocketServer({ server });

// keep a mapping from generated socket ids to ws instances
const clients = new Map();

// simple id generator for new connections
function generateId() {
	return Math.random().toString(36).substring(2, 10);
}

// helper to send an event-style message over a ws
function send(ws, event, data) {
	if (ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify({ event, data }));
	}
}

// send to a specific client by id
function sendTo(id, event, data) {
	const ws = clients.get(id);
	if (ws && ws.readyState === ws.OPEN) {
		send(ws, event, data);
	}
}

app.use(cors());

// parsed rooms remain the same

/** @type {Record<string, RoomGame>} */
const rooms = {};

function getRoom(roomId) {
	return rooms[roomId] || null;
}

function createRoom(ws, { room, maxPlayers, drawRule, maxDrawsPerTurn }) {
	const validation = RoomGame.validateMaxPlayers(maxPlayers ?? 2);
	if (!validation.ok) {
		send(ws, "createFailed", {
			reason: validation.reason,
			min: validation.min,
			max: validation.max,
		});
		return;
	}
	// no socket.join with ws; membership is tracked by RoomGame
	rooms[room] = new RoomGame(room, validation.maxPlayers, {
		drawRule,
		maxDrawsPerTurn,
	});
	send(ws, "created", room);
}

function totalPiecesSummary(roomGame, excludeSocketId) {
	return roomGame.getPlayersSummary(excludeSocketId);
}

function enterRoom(ws, { room, name }) {
	const roomGame = getRoom(room);
	if (!roomGame) {
		send(ws, "DontExist");
		return;
	}
	if ((roomGame?.game?.players ?? []).length + 1 > roomGame.maxPlayers) {
		send(ws, "full");
		return;
	}
	const result = roomGame.addPlayer(ws.id, name);
	if (!result.ok) {
		if (result.reason === "full" || result.reason === "game_started") {
			send(ws, "full");
		}
		return;
	}
	// compute remaining slots
	const remaining = roomGame.isStarted()
		? 0
		: roomGame.maxPlayers - roomGame.players.length;
	// reply to requester
	send(ws, "enterResult", remaining);
	if (result.started) {
		const playerList = roomGame.players;
		playerList.forEach(({ id: playerSocketId }, idx) => {
			const isFirst = idx === 0;
			const hand = roomGame.getHand(playerSocketId) ?? [];
			const playerInfo = playerList.find((p) => p.id === playerSocketId);
			sendTo(playerSocketId, "ready", {
				id: playerSocketId,
				name: playerInfo?.name,
				pieces: hand,
				initial: isFirst,
				players: totalPiecesSummary(roomGame, playerSocketId),
			});
		});
	}
}

function makeMove(ws, roomID, playerID, move, direction) {
	const roomGame = getRoom(roomID);
	if (!roomGame) {
		send(ws, "playerNotFound", "Sala não encontrada.");
		return;
	}

	const result = roomGame.makeMove(playerID, move, direction);
	if (!result.ok) {
		if (result.reason === "invalid_move") send(ws, "invalidMove");
		return;
	}

	const boardTiles = roomGame.getBoardTiles();
	const whoPlayed = playerID;
	const nextId = roomGame.getCurrentPlayerId();

	const playerList = roomGame.players;
	playerList.forEach(({ id }) => {
		sendTo(id, "newMove", {
			players: totalPiecesSummary(roomGame, id),
			move,
			direction,
			whoPlayed,
			boardTiles,
		});
		if (nextId && id === nextId) {
			sendTo(id, "nextPlayer");
		}
	});

	if (roomGame.isOver()) {
		const winner = roomGame.getWinner();
		const playerList = roomGame.players;
		playerList.forEach(({ id }) => {
			const isWinner = winner && id === winner.id;
			const message = isWinner
				? "Parabéns, você ganhou."
				: winner
					? `O jogador ${winner.name} bateu.`
					: "Jogo fechado - decidido por pontos.";
			sendTo(id, "winner", message);
		});
	}
}

function isValidRoom(room, user) {
	const roomGame = getRoom(room);
	if (!roomGame) return false;
	// Se o usuário já está na sala, sempre permitimos (reconexão / refresh)
	if (user) {
		const idx = roomGame.players.findIndex((p) => p.id === user);
		if (idx !== -1) return true;
	}

	// Para novos jogadores:
	// - sala com jogo iniciado NÃO está disponível
	// - sala cheia (players >= maxPlayers) também NÃO está disponível
	if (roomGame.isStarted()) return false;
	if (roomGame.players.length >= roomGame.maxPlayers) return false;

	return true;
}

function handlePlayerDisconnect({ roomID, playerID }) {
	const roomGame = getRoom(roomID);
	if (!roomGame) return "DontExist";
	const idx = roomGame.players.findIndex((p) => p.id === playerID);
	if (idx === -1) return null;
	const playerList = roomGame.players;
	playerList.forEach(({ id }) => {
		sendTo(
			id,
			"gameCancelled",
			"O jogo foi cancelado pois um jogador saiu da partida.",
		);
	});
	delete rooms[roomID];
	return "DontExist";
}

function handlerAskForPiece(roomID, playerID) {
	const roomGame = getRoom(roomID);
	if (!roomID || !roomGame)
		return { ok: false, message: "Sala não encontrada." };
	if (!roomGame.isStarted())
		return { ok: false, message: "Jogo ainda não iniciou." };

	const result = roomGame.askForPiece(playerID);
	if (!result.ok) {
		if (result.reason === "has_playable")
			return { ok: false, message: "Você tem peça para jogar." };
		if (result.reason === "pile_empty")
			return { ok: false, message: "Monte vazio." };
		if (result.reason === "must_pass")
			return {
				ok: false,
				message: "Você já comprou neste turno; passe a vez.",
			};
		if (result.reason === "max_draws_reached")
			return {
				ok: false,
				message: "Limite de compras neste turno atingido; passe a vez.",
			};
		return { ok: false, message: result.reason };
	}

	const hand = roomGame.getHand(playerID);
	const nextId = result.nextPlayerId ?? roomGame.getCurrentPlayerId();
	const playerList = roomGame.players;
	playerList.forEach(({ id }) => {
		sendTo(id, "playerDrewPiece", {
			playerID,
			players: totalPiecesSummary(roomGame, id),
			passedTurn: result.passedTurn ?? false,
		});
		if (id === playerID) sendTo(id, "updateHand", hand);
		if (nextId && id === nextId) sendTo(id, "nextPlayer");
	});
	if (result.passedTurn && roomGame.isOver()) {
		const winner = roomGame.getWinner();
		playerList.forEach(({ id }) => {
			const isWinner = winner && id === winner.id;
			const message = isWinner
				? "Parabéns, você ganhou."
				: winner
					? `O jogador ${winner.name} bateu.`
					: "Jogo fechado - decidido por pontos.";
			sendTo(id, "winner", message);
		});
	}

	return { ok: true, piece: result.tile };
}

// convert socket.io-style events into a message dispatcher
wss.on("connection", (ws) => {
	// assign a simple id and keep track of the connection
	ws.id = generateId();
	clients.set(ws.id, ws);

	ws.on("close", () => {
		clients.delete(ws.id);
	});

	ws.on("message", (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch (e) {
			console.warn("received non-json message", raw);
			return;
		}
		const { event, data } = msg;

		const handlers = {
			create: (d) => createRoom(ws, d),
			enter: (d) => enterRoom(ws, d),
			verifyRoom: (d) => {
				const ok = isValidRoom(d.room, d.user);
				send(ws, "verifyRoomResult", ok);
			},
			"disconnect-user": (d) => {
				const result = handlePlayerDisconnect(d);
				if (result) send(ws, result);
			},
			makeMove: (d) => makeMove(ws, d.roomID, d.id, d.move, d.direction),
			askForPiece: (d) => {
				const result = handlerAskForPiece(d.roomID, d.id);
				if (result?.ok) send(ws, "askForPieceResult", result.piece ?? result);
				else
					send(
						ws,
						"askForPieceError",
						result?.message ?? "Erro ao pedir peça.",
					);
			},
		};

		const handler = handlers[event];
		if (handler) handler(data);
	});
});

server.listen(process.env.PORT || 5001, () =>
	console.log("Server has started."),
);

export default wss;
