import { totalPieces } from "./totalPieces.js";

export const getPiecesToUser = (usersPieces) => {
	const remainingPieces = removePiecesOnRoot(usersPieces).sort();

	return {
		pieces: remainingPieces.slice(0, 7),
		remaining: remainingPieces.length - 7,
	};
};

const removePiecesOnRoot = (players) => {
	let arrP = [...totalPieces];

	if (players.length > 0) {
		for (let index = 0; index < players.length; index++) {
			for (
				let indexPieces = 0;
				indexPieces < players[index].pieces.length;
				indexPieces++
			) {
				const idx = totalPieces.findIndex(
					(val) => val === players[index].pieces[indexPieces],
				);
				if (idx) {
					arrP.splice(index, 1);
				}
			}
		}
	}

	return arrP;
};
