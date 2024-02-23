import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createServer } from "http";

import { orderPlayers, getPlayer } from "../utils/firstPlayer.js";
import { getPiecesToUser, shuffleArray, whoIsTheWinner, isGameBlocked, askForPiece } from "../utils/getPieces.js";


const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(cors());

const rooms = {}

const createRoom = (socket, { room, maxPlayers }) => {
	socket.join(room);

	rooms[room] = {
		room,
		moves: [],
		maxPlayers,
		players: [],
		order: null,
		remaining: 28,
	};

	socket.emit("created", room);
};

const makeMove = (socket, roomID, playerID, move, direction) => {
	const playerIndex = rooms[roomID].players.findIndex(player => player.id === playerID);

	if (playerIndex !== -1) {

		if (rooms[roomID].moves.length === 0) {
			const filter = filterPiece(rooms[roomID].players[playerIndex].pieces, move)
			rooms[roomID].players[playerIndex].pieces = filter
			rooms[roomID].moves.push(move)
			rooms[roomID].players.forEach((_player, idx) => {
				if (playerID === _player.id) {
					io.to(_player.id).emit("updateHand", move);

				} else if (nextPlayer(rooms[roomID].players, playerIndex) === idx) {
					io.to(_player.id).emit("nextPlayer");
				}
				io.to(_player.id).emit("newMove", { players: totalPieces(rooms[roomID].players, playerID), move, direction, whoPlayed: playerID });

			});
			return () => { }
		} else {
			if (isValidMove(rooms[roomID].moves, move, direction)) {
				if (!isGameBlocked(rooms[roomID].moves)) {
					if (direction === "top") {
						rooms[roomID].moves = ordernationFn([move, ...rooms[roomID].moves])
					} else {
						rooms[roomID].moves = ordernationFn([...rooms[roomID].moves, move])
					}
					const filter = filterPiece(rooms[roomID].players[playerIndex].pieces, move)
					if (filter.length === 0) {
						const winner = whoIsTheWinner(rooms[roomID].players)
						rooms[roomID].players.forEach((_player) => {
							io.to(_player.id).emit("winner", playerID === _player.id ? "Parabéns, você ganhou." : `O jogador: ${winner.name} bateu.`);
						})
					}
					rooms[roomID].players[playerIndex].pieces = filter
					rooms[roomID].players.forEach((_player, idx) => {
						if (nextPlayer(rooms[roomID].players, playerIndex) === idx) {
							io.to(_player.id).emit("nextPlayer");
						}
						io.to(_player.id).emit("newMove", { players: totalPieces(rooms[roomID].players, playerID), move, direction, whoPlayed: playerID });
					});
				} else {
					const winner = whoIsTheWinner(rooms[roomID].players)
					rooms[roomID].players.forEach((_player) => {
						io.to(_player.id).emit("winner", winner.id === _player.id ? "Parabéns, você ganhou por menos pontos em mãos." : `O jogo fechou e foi decidido por pontos, o ganhador foi: ${winner.name}`);
					})
				}
			} else {
				socket.emit("invalidMove");
			}
		}

	} else {
		socket.emit("playerNotFound", "Jogador não encontrado.");
	}
};

function filterPiece(pieces, target) {
	return pieces.filter(
		(e) =>
			!(e[0] === target[0] && e[1] === target[1]) &&
			!(e[0] === target[1] && e[1] === target[0]),
	);
}

const totalPieces = (players, current) => {
	return players.map((player) => ({ id: player.id, total: player.pieces.length })).filter((player) => player.id !== current)
}

const nextPlayer = (players, currentIdx) => {
	return (players.length - 1) === currentIdx ? 0 : currentIdx + 1;
}

const ordernationFn = (t) => {
	for (let index = 0; index < t.length; index++) {
		if (index !== (t.length - 1)) {
			const element = t[index];
			const next = t[index + 1];
			if ((element[1] !== next[0])) {
				t[index] = element.reverse()
			}
		} else {
			if (t[index - 1][1] !== t[index][0]) {
				t[index] = t[index].reverse()
			}
		}

	}
	return t
}


const isValidMove = (arr, move, direction) => {
	return (move[0] === arr[direction === "top" ? 0 : (arr.length - 1)][direction === "top" ? 0 : 1]) || (move[1] === arr[direction === "top" ? 0 : (arr.length - 1)][direction === "top" ? 0 : 1]) ? true : false
}

const isValidRoom = (room, user) => {

	if (user && rooms[room]) {
		const isValidUser = rooms[room].players.findIndex((e) => e.id === user)


		if (isValidUser !== -1) {
			return true;
		}
		return {}
	}

	return !!rooms[room]
}

const enterRoom = (socket, { room, name }, cb) => {

	if (!rooms[room]) {
		socket.emit("DontExist");
		return;
	}

	if (rooms[room].players.length < rooms[room].maxPlayers) {
		socket.join(room);

		const { pieces, remaining } = getPiecesToUser(rooms[room].players);

		shuffleArray(pieces);

		rooms[room].remaining = remaining;
		rooms[room].players.push({ id: socket.id, name, pieces });

		cb(remaining)

		if (!rooms[room].whoStarts && rooms[room].maxPlayers === rooms[room].players.length) {
			const order = orderPlayers(rooms[room]);
			rooms[room].order = order;

			order.forEach((_player, idx) => {
				io.to(_player).emit("ready", { ...getPlayer(rooms[room], _player), initial: idx === 0, players: totalPieces(rooms[room].players, order[0]) });
			});
		}
	} else {
		socket.emit("full");
	}
};



const handlePlayerDisconnect = ({ roomID, playerID }) => {

	if (!rooms[roomID]) {
		return "DontExist";
	}

	const idxPlayer = rooms[roomID].players.findIndex((val) => val.id === playerID);

	if (idxPlayer !== -1) {
		rooms[roomID].players.forEach((_player) => {
			io.to(_player.id).emit("gameCancelled", `O jogo foi cancelado pois um saiu da partida.`);
		})
		delete rooms[roomID]
	}
};


const handleraskForPiece = (roomID, playerID) => {
	const playerIndex = rooms[roomID].players.findIndex(player => player.id === playerID);


	if (roomID && playerIndex !== -1) {
		console.log(rooms[roomID])
		if (rooms[roomID].moves.length > 0) {
			const piece = askForPiece(rooms[roomID])

			rooms[roomID].players[playerIndex].pieces.push(piece);
			return piece
		} else {
			return "É necessário ao menos uma peça na mesa para pedir peça."
		}

	}
	return "Sala não encontrada."
}


io.sockets.on("connection", (socket) => {

	socket.on("create", ({ room, maxPlayers }) => createRoom(socket, { room, maxPlayers }));

	socket.on("enter", ({ room, name }, cb) => enterRoom(socket, { room, name }, cb));

	socket.on("verifyRoom", ({ room, user }, cb) => {
		cb(isValidRoom(room, user))
	});

	socket.on("disconnect-user", ({ roomID, playerID }) => {
		socket.emit(handlePlayerDisconnect({ roomID, playerID }));
	});

	socket.on("makeMove", ({ roomID, id, move, direction }) => {
		makeMove(socket, roomID, id, move, direction);

	});

	socket.on("ashForPiece", ({ roomID, id }, cb) => {
		cb(handleraskForPiece(roomID, id));

	});
});

export default io;