// Blood on the Clocktower characters shared by the Storyteller and Player apps.
// The names belong to The Pandemonium Institute; the symbols are our own.
/* ---------- Characters ---------- */
// [name, symbol, ability]. A * after "night" means not the first night.
const SCRIPTS = {
  tb: { name: "Trouble Brewing", roles: {
    townsfolk: [
      ["Washerwoman", "🧺", "You start knowing that 1 of 2 players is a particular Townsfolk."],
      ["Librarian", "📚", "You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)"],
      ["Investigator", "🔍", "You start knowing that 1 of 2 players is a particular Minion."],
      ["Chef", "🍳", "You start knowing how many pairs of evil players there are."],
      ["Empath", "💞", "Each night, you learn how many of your 2 alive neighbours are evil."],
      ["Fortune Teller", "🔮", "Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you."],
      ["Undertaker", "⚰️", "Each night*, you learn which character died by execution today."],
      ["Monk", "🙏", "Each night*, choose a player (not yourself): they are safe from the Demon tonight."],
      ["Ravenkeeper", "🪶", "If you die at night, you are woken to choose a player: you learn their character."],
      ["Virgin", "🕊️", "The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately."],
      ["Slayer", "🏹", "Once per game, during the day, publicly choose a player: if they are the Demon, they die."],
      ["Soldier", "🛡️", "You are safe from the Demon."],
      ["Mayor", "🎩", "If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead."]
    ],
    outsider: [
      ["Butler", "🛎️", "Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too."],
      ["Drunk", "🍺", "You do not know you are the Drunk. You think you are a Townsfolk character, but you are not."],
      ["Recluse", "🕸️", "You might register as evil & as a Minion or Demon, even if dead."],
      ["Saint", "😇", "If you die by execution, your team loses."]
    ],
    minion: [
      ["Poisoner", "🧪", "Each night, choose a player: they are poisoned tonight and tomorrow day."],
      ["Spy", "🕵️", "Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead."],
      ["Scarlet Woman", "💋", "If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don't count.)"],
      ["Baron", "🏰", "There are extra Outsiders in play. [+2 Outsiders]"]
    ],
    demon: [
      ["Imp", "😈", "Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp."]
    ]
  } },
  bmr: { name: "Bad Moon Rising", roles: {
    townsfolk: [
      ["Grandmother", "👵", "You start knowing a good player & their character. If the Demon kills them, you die too."],
      ["Sailor", "⚓", "Each night, choose an alive player: either you or they are drunk until dusk. You can't die."],
      ["Chambermaid", "🧹", "Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability."],
      ["Exorcist", "✝️", "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are then doesn't wake tonight."],
      ["Innkeeper", "🛏️", "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until dusk."],
      ["Gambler", "🎲", "Each night*, choose a player & guess their character: if you guess wrong, you die."],
      ["Gossip", "🗣️", "Each day, you may make a public statement. Tonight, if it was true, a player dies."],
      ["Courtier", "🍷", "Once per game, at night, choose a character: they are drunk for 3 nights & 3 days."],
      ["Professor", "🎓", "Once per game, at night*, choose a dead player: if they are a Townsfolk, they are resurrected."],
      ["Minstrel", "🎻", "When a Minion dies by execution, all other players (except Travellers) are drunk until dusk tomorrow."],
      ["Tea Lady", "🫖", "If both your alive neighbours are good, they can't die."],
      ["Pacifist", "☮️", "Executed good players might not die."],
      ["Fool", "🃏", "The first time you die, you don't."]
    ],
    outsider: [
      ["Goon", "🥊", "Each night, the 1st player to choose you with their ability is drunk until dusk. You become their alignment."],
      ["Lunatic", "🤪", "You think you are a Demon, but you are not. The Demon knows who you are & who you choose at night."],
      ["Tinker", "🔧", "You might die at any time."],
      ["Moonchild", "🌙", "When you learn that you died, publicly choose 1 alive player. Tonight, if it was a good player, they die."]
    ],
    minion: [
      ["Godfather", "🌹", "You start knowing which Outsiders are in play. If 1 died today, choose a player tonight: they die. [−1 or +1 Outsider]"],
      ["Devil's Advocate", "⚖️", "Each night, choose a living player (different to last night): if executed tomorrow, they don't die."],
      ["Assassin", "🗡️", "Once per game, at night*, choose a player: they die, even if for some reason they could not."],
      ["Mastermind", "♟️", "If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses."]
    ],
    demon: [
      ["Zombuul", "🧟", "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead."],
      ["Pukka", "🦟", "Each night, choose a player: they are poisoned. The previously poisoned player dies then becomes healthy."],
      ["Shabaloth", "👹", "Each night*, choose 2 players: they die. A dead player you chose last night might be regurgitated."],
      ["Po", "🔥", "Each night*, you may choose a player: they die. If your last choice was no-one, choose 3 players tonight."]
    ]
  } },
  snv: { name: "Sects & Violets", roles: {
    townsfolk: [
      ["Clockmaker", "🕰️", "You start knowing how many steps from the Demon to its nearest Minion."],
      ["Dreamer", "💤", "Each night, choose a player (not yourself or Travellers): you learn 1 good & 1 evil character, 1 of which is correct."],
      ["Snake Charmer", "🐍", "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned."],
      ["Mathematician", "🧮", "Each night, you learn how many players' abilities worked abnormally (since dawn) due to another character's ability."],
      ["Flowergirl", "💐", "Each night*, you learn if a Demon voted today."],
      ["Town Crier", "📣", "Each night*, you learn if a Minion nominated today."],
      ["Oracle", "👁️", "Each night*, you learn how many dead players are evil."],
      ["Savant", "🧠", "Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false."],
      ["Seamstress", "🧵", "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment."],
      ["Philosopher", "🏛️", "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk."],
      ["Artist", "🎨", "Once per game, during the day, privately ask the Storyteller any yes/no question."],
      ["Juggler", "🤹", "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct."],
      ["Sage", "🦉", "If the Demon kills you, you learn that it is 1 of 2 players."]
    ],
    outsider: [
      ["Mutant", "🧬", "If you are \"mad\" about being an Outsider, you might be executed."],
      ["Sweetheart", "💘", "When you die, 1 player is drunk from now on."],
      ["Barber", "💈", "If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters."],
      ["Klutz", "🍌", "When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses."]
    ],
    minion: [
      ["Evil Twin", "👯", "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live."],
      ["Witch", "🧙", "Each night, choose a player: if they nominate tomorrow, they die. If just 3 players live, you lose this ability."],
      ["Cerenovus", "🌀", "Each night, choose a player & a good character: they are \"mad\" they are this character tomorrow, or might be executed."],
      ["Pit-Hag", "🐸", "Each night*, choose a player & a character they become (if not in play). If a Demon is made, deaths tonight are arbitrary."]
    ],
    demon: [
      ["Fang Gu", "🐉", "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]"],
      ["Vigormortis", "🦴", "Each night*, choose a player: they die. Minions you kill keep their ability & poison 1 Townsfolk neighbour. [−1 Outsider]"],
      ["No Dashii", "🦑", "Each night*, choose a player: they die. Your 2 Townsfolk neighbours are poisoned."],
      ["Vortox", "🌪️", "Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins."]
    ]
  } }
};
const TEAMS = ["townsfolk", "outsider", "minion", "demon"];
const TEAM_LABEL = { townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demon" };
const TEAM_ONE = { townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon" };
const CHAR = {};
for (const sc of Object.values(SCRIPTS)) for (const t of TEAMS) for (const [name, icon, text] of sc.roles[t]) CHAR[name] = { name, icon, text, team: t };
const teamOf = r => (CHAR[r] || {}).team || "townsfolk";
const alignOf = r => ["minion", "demon"].includes(teamOf(r)) ? "evil" : "good";
// Townsfolk / Outsiders / Minions / Demon by player count
const COMP = { 5: [3,0,1,1], 6: [3,1,1,1], 7: [5,0,1,1], 8: [5,1,1,1], 9: [5,2,1,1], 10: [7,0,2,1], 11: [7,1,2,1], 12: [7,2,2,1], 13: [9,0,3,1], 14: [9,1,3,1], 15: [9,2,3,1] };
// Characters who are shown something else when they draw
const SHOWN = { Drunk: "townsfolk", Lunatic: "demon" };
