import io from "../server/index.js";

export const makeMove = (roomID, playerID, move) => {
	rooms[roomID].moves.push({ playerID, move });

	io.to(roomID).emit("updateGameState", rooms[roomID]);
};
