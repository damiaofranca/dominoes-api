export const findBiggerPiece = (obj) => {
	let bigSomeEachPair = [];
	let bigAllWithSome = [];

	for (const player of obj.players) {
		let all = 0;
		let temporallyPlayer = {};
		player.pieces.reduce((acc, value) => {
			if (value[0] + value[1] > all) {
				all = value[0] + value[1];
				temporallyPlayer = { val: all, getPlayer: player };
				return value[0] + value[1];
			}
			return acc;
		}, 0);

		bigSomeEachPair.push(all);
		bigAllWithSome.push(temporallyPlayer);
		all = 0;
	}
	return bigAllWithSome
		.sort((player, _, idx) => player.val === bigSomeEachPair[idx])
		.reverse()
		.map((player) => player.getPlayer.id);
};

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
