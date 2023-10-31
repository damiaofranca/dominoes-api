import { createServer } from "http";
import { Server } from "socket.io";

import { makeMove } from "../utils/makeMove.js";
import { getPiecesToUser } from "../utils/getPieces.js";
import { findBiggerPiece } from "../utils/firstPlayer.js";

const httpServer = createServer();
const io = new Server(httpServer, {
	cors: {
		origin: "http://localhost:5173",
	},
});

const rooms = {};

io.sockets.on("connection", (socket) => {
	socket.emit("hello");

	socket.on("createRoom", (maxPlayers) => {
		const roomID = Math.random().toString(36).substring(7);
		rooms[roomID] = {
			moves: [],
			players: [],
			remaining: 27,
			maxPlayers: maxPlayers,
		};
		socket.join(`test`);

		setTimeout(() => {
			socket.to("test").emit("ready", "asdqwqwdq");
		}, 4000);
		socket.emit("roomCreated", { roomID });
	});

	socket.on("enterRoom", ({ roomID, name }) => {
		if (rooms[roomID]) {
			const sala = rooms[roomID];

			if (sala.players.length < sala.maxPlayers) {
				const { pieces, remaining } = getPiecesToUser(sala.players);
				sala.players.push({ id: socket.id, name: name, pieces: pieces });

				rooms[roomID].remaining = remaining;
				rooms[roomID].players = sala.players;

				socket.emit("enteredRoom", { name });
				console.log(`Player ${socket.id} enter in room: ${roomID}`);
				if (
					!rooms[roomID].whoStarts &&
					rooms[roomID].maxPlayers === rooms[roomID].players.length
				) {
					const whoStarts = findBiggerPiece(rooms[roomID]);
					socket.to("test").emit("ready", { whoStarts });
				}
			} else {
				socket.emit("roomFull");
			}
		} else {
			socket.emit("DontExist");
		}
	});
	socket.on("disconnect", ({ roomID, id }) => {
		if (rooms[roomID]) {
			const idxPlayer = rooms[roomID].players.findIndex((val) => val.id === id);

			if (idxPlayer !== -1) {
				rooms[roomID].players.splice(idxPlayer, 1);
				socket.emit("PlayerExited");
			} else {
				socket.emit("PlayerNotFound");
			}
		} else {
			socket.emit("DontExist");
		}
	});

	socket.on("makeMove", ({ roomID, move }) => {
		if (rooms[roomID] && rooms[roomID].players.includes(socket.id)) {
			makeMove(roomID, socket.id, move);
		}
	});
});

httpServer.listen(3001, () => {
	console.log("Running in 3001 port");
});

export default io;
