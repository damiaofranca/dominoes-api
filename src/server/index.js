import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createServer } from "http";
import { RoomGame } from "../game/RoomGame.js";

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: { origin: "*" },
});

app.use(cors());

/** @type {Record<string, RoomGame>} */
const rooms = {};

function getRoom(roomId) {
	return rooms[roomId] || null;
}

function createRoom(socket, { room, maxPlayers, drawRule, maxDrawsPerTurn }) {
	const validation = RoomGame.validateMaxPlayers(maxPlayers ?? 2);
	if (!validation.ok) {
		socket.emit("createFailed", {
			reason: validation.reason,
			min: validation.min,
			max: validation.max,
		});
		return;
	}
	socket.join(room);
	rooms[room] = new RoomGame(room, validation.maxPlayers, {
		drawRule,
		maxDrawsPerTurn,
	});
	socket.emit("created", room);
}

function totalPiecesSummary(roomGame, excludeSocketId) {
	return roomGame.getPlayersSummary(excludeSocketId);
}

function emitToRoom(roomId, event, ...args) {
	io.to(roomId).emit(event, ...args);
}

function emitToRoomExcept(roomId, excludeSocketId, event, ...args) {
	io.to(roomId)
		.except(excludeSocketId)
		.emit(event, ...args);
}

function enterRoom(socket, { room, name }, cb) {
	const roomGame = getRoom(room);
	if (!roomGame) {
		socket.emit("DontExist");
		return;
	}
	if ((roomGame?.game?.players ?? []).length + 1 > roomGame.maxPlayers) {
		socket.emit("full");
		return;
	}
	const result = roomGame.addPlayer(socket.id, name);
	if (!result.ok) {
		if (result.reason === "full" || result.reason === "game_started") {
			socket.emit("full");
		}
		return;
	}
	socket.join(room);
	// remaining: 0 = sala cheia / jogo iniciado; >0 = vagas restantes (mostrar "aguardando jogadores")
	const remaining = roomGame.isStarted()
		? 0
		: roomGame.maxPlayers - roomGame.players.length;
	cb(remaining);
	if (result.started) {
		const playerList = roomGame.players;
		playerList.forEach(({ id: playerSocketId }, idx) => {
			const isFirst = idx === 0;
			const hand = roomGame.getHand(playerSocketId) ?? [];
			const playerInfo = playerList.find((p) => p.id === playerSocketId);
			io.to(playerSocketId).emit("ready", {
				id: playerSocketId,
				name: playerInfo?.name,
				pieces: hand,
				initial: isFirst,
				players: totalPiecesSummary(roomGame, playerSocketId),
			});
		});
	}
}

function makeMove(socket, roomID, playerID, move, direction) {
	const roomGame = getRoom(roomID);
	if (!roomGame) {
		socket.emit("playerNotFound", "Sala não encontrada.");
		return;
	}

	const result = roomGame.makeMove(playerID, move, direction);
	if (!result.ok) {
		if (result.reason === "invalid_move") socket.emit("invalidMove");
		return;
	}

	const boardTiles = roomGame.getBoardTiles();
	const whoPlayed = playerID;
	const nextId = roomGame.getCurrentPlayerId();

	const playerList = roomGame.players;
	playerList.forEach(({ id }) => {
		io.to(id).emit("newMove", {
			players: totalPiecesSummary(roomGame, id),
			move,
			direction,
			whoPlayed,
			boardTiles,
		});
		if (nextId && id === nextId) {
			io.to(id).emit("nextPlayer");
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
			io.to(id).emit("winner", message);
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
		io.to(id).emit(
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
		io.to(id).emit("playerDrewPiece", {
			playerID,
			players: totalPiecesSummary(roomGame, id),
			passedTurn: result.passedTurn ?? false,
		});
		if (id === playerID) io.to(id).emit("updateHand", hand);
		if (nextId && id === nextId) io.to(id).emit("nextPlayer");
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
			io.to(id).emit("winner", message);
		});
	}

	return { ok: true, piece: result.tile };
}

io.sockets.on("connection", (socket) => {
	socket.on("create", ({ room, maxPlayers }) =>
		createRoom(socket, { room, maxPlayers }),
	);

	socket.on("enter", ({ room, name }, cb) =>
		enterRoom(socket, { room, name }, cb),
	);

	socket.on("verifyRoom", ({ room, user }, cb) => {
		cb(isValidRoom(room, user, socket));
	});

	socket.on("disconnect-user", ({ roomID, playerID }) => {
		const result = handlePlayerDisconnect({ roomID, playerID });
		if (result) socket.emit(result);
	});

	socket.on("makeMove", ({ roomID, id, move, direction }) => {
		makeMove(socket, roomID, id, move, direction);
	});

	socket.on("askForPiece", ({ roomID, id }, cb) => {
		const result = handlerAskForPiece(roomID, id);
		if (result?.ok) cb(result.piece ?? result);
		else cb(result?.message ?? "Erro ao pedir peça.");
	});
});

server.listen(process.env.PORT || 5001, () =>
	console.log("Server has started."),
);

export default io;
