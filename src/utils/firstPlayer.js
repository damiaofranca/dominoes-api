export const orderPlayers = (obj) => {
	let playersWithMaxPiece = [];

	for (const player of obj.players) {
		const maxPiece = player.pieces.reduce((max, value) => {
			const sum = value[0] + value[1];
			return sum > max ? sum : max;
		}, 0);

		playersWithMaxPiece.push({ player, maxPiece });
	}

	const sortedPlayers = playersWithMaxPiece
		.sort((a, b) => b.maxPiece - a.maxPiece)
		.map((item) => item.player.id);

	return sortedPlayers;
};


export const getPlayer = (room, playerID) => {
	return room.players.find((player) => player.id === playerID)
}

export const findBigSomeWithAllpieces = (obj) => {
	let playerWithBiggerSome = null;
	let biggerSome = 0;

	for (const player of obj.players) {
		const soma = player.pieces.reduce(
			(acc, value) => (acc ? acc : 0) + (value[0] + value[1]),
			0,
		);
		console.log(soma);
		if (soma > biggerSome) {
			biggerSome = soma;
			playerWithBiggerSome = player;
		}
	}
	return obj.findIndex(
		(el) => el.players.findIndex((x) => x === playerWithBiggerSome) !== -1,
	);
};
