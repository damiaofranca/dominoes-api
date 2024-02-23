import { totalPieces } from "./totalPieces.js";


export const shuffleArray = (array) => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
};

export const getPiecesToUser = (usersPieces) => {
	const remainingPieces = removePiecesOnRoot(usersPieces);
	shuffleArray(remainingPieces);

	return {
		pieces: remainingPieces.slice(0, 7),
		remaining: remainingPieces.length - 7,
		rest: remainingPieces,
	};
};

const removePiecesOnRoot = (players) => {
	let arrP = [...totalPieces];

	if (players.length > 0) {
		players.forEach((player) => {
			player.pieces.forEach((piece) => {
				const idx = arrP.findIndex((val) => val === piece);
				if (idx !== -1) {
					arrP.splice(idx, 1);
				}
			});
		});
	}

	shuffleArray(arrP);
	return arrP;
};



export const isGameBlocked = (e) => {
	const total = {
		6: 0,
		5: 0,
		4: 0,
		3: 0,
		2: 0,
		1: 0,
		0: 0,
	}

	let tempIdx = 0

	for (let i = 0; i < e.length; i++) {
		if (e[i][0] !== e[i][1]) {
			total[e[i][0]] = total[e[i][0]] + 1;
			total[e[i][1]] = total[e[i][1]] + 1;
		} else {
			total[e[i][0]] = total[e[i][0]] + 1;
		}
		if (tempIdx === 6) {
			tempIdx = 0
		} else {
			tempIdx++
		}
	}

	let idx = 0
	while (idx <= 6) {
		if (total[idx] === 7 && idx === e[0][0] && idx === e[e.length - 1][1]) {
			return true
		}
		idx++
	}

	return false
}


export const whoIsTheWinner = (e) => {
	return e.map((user) => {
		user.pieces = user.pieces.reduce((acc, val) => acc + (val[0] + val[1]), 0)
		return user
	}).sort((a, b) => a.pieces - b.pieces)[0]
}


export const askForPiece = (room) => {
	let tempArr = totalPieces;
	const piecesPlayers = room.players.map((e) => e.pieces).flat()

	for (let i = 0; i < piecesPlayers.length; i++) {
		tempArr = tempArr.filter((e) =>
			!(e[0] === piecesPlayers[i][0] && e[1] === piecesPlayers[i][1]) &&
			!(e[0] === piecesPlayers[i][1] && e[1] === piecesPlayers[i][0]))
	}
	return tempArr[(Math.random() * tempArr.length) | 0];
}