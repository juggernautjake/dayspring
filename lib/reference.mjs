// A small offline reference, so everyday questions get an answer with no AI and no internet:
// US states and capitals, world capitals, the planets, the multiplication table, leap years and weekdays for dates,
// plus the little games (trivia, rock paper scissors, the magic 8-ball, would you rather).

export const US_CAPITALS = {
  alabama: "Montgomery", alaska: "Juneau", arizona: "Phoenix", arkansas: "Little Rock", california: "Sacramento", colorado: "Denver", connecticut: "Hartford", delaware: "Dover",
  florida: "Tallahassee", georgia: "Atlanta", hawaii: "Honolulu", idaho: "Boise", illinois: "Springfield", indiana: "Indianapolis", iowa: "Des Moines", kansas: "Topeka",
  kentucky: "Frankfort", louisiana: "Baton Rouge", maine: "Augusta", maryland: "Annapolis", massachusetts: "Boston", michigan: "Lansing", minnesota: "Saint Paul",
  mississippi: "Jackson", missouri: "Jefferson City", montana: "Helena", nebraska: "Lincoln", nevada: "Carson City", "new hampshire": "Concord", "new jersey": "Trenton",
  "new mexico": "Santa Fe", "new york": "Albany", "north carolina": "Raleigh", "north dakota": "Bismarck", ohio: "Columbus", oklahoma: "Oklahoma City", oregon: "Salem",
  pennsylvania: "Harrisburg", "rhode island": "Providence", "south carolina": "Columbia", "south dakota": "Pierre", tennessee: "Nashville", texas: "Austin", utah: "Salt Lake City",
  vermont: "Montpelier", virginia: "Richmond", washington: "Olympia", "west virginia": "Charleston", wisconsin: "Madison", wyoming: "Cheyenne",
};
export const WORLD_CAPITALS = {
  afghanistan: "Kabul", albania: "Tirana", algeria: "Algiers", argentina: "Buenos Aires", armenia: "Yerevan", australia: "Canberra", austria: "Vienna", bahamas: "Nassau",
  bangladesh: "Dhaka", belarus: "Minsk", belgium: "Brussels", bolivia: "Sucre (with La Paz as the seat of government)", brazil: "Brasília", bulgaria: "Sofia", cambodia: "Phnom Penh",
  cameroon: "Yaoundé", canada: "Ottawa", chile: "Santiago", china: "Beijing", colombia: "Bogotá", "costa rica": "San José", croatia: "Zagreb", cuba: "Havana", cyprus: "Nicosia",
  "czech republic": "Prague", czechia: "Prague", denmark: "Copenhagen", "dominican republic": "Santo Domingo", ecuador: "Quito", egypt: "Cairo", "el salvador": "San Salvador",
  england: "London", estonia: "Tallinn", ethiopia: "Addis Ababa", fiji: "Suva", finland: "Helsinki", france: "Paris", germany: "Berlin", ghana: "Accra", greece: "Athens",
  guatemala: "Guatemala City", haiti: "Port-au-Prince", honduras: "Tegucigalpa", hungary: "Budapest", iceland: "Reykjavík", india: "New Delhi", indonesia: "Jakarta", iran: "Tehran",
  iraq: "Baghdad", ireland: "Dublin", israel: "Jerusalem", italy: "Rome", jamaica: "Kingston", japan: "Tokyo", jordan: "Amman", kazakhstan: "Astana", kenya: "Nairobi",
  kuwait: "Kuwait City", laos: "Vientiane", latvia: "Riga", lebanon: "Beirut", liberia: "Monrovia", libya: "Tripoli", lithuania: "Vilnius", luxembourg: "Luxembourg",
  madagascar: "Antananarivo", malaysia: "Kuala Lumpur", mali: "Bamako", malta: "Valletta", mexico: "Mexico City", monaco: "Monaco", mongolia: "Ulaanbaatar", morocco: "Rabat",
  mozambique: "Maputo", myanmar: "Naypyidaw", nepal: "Kathmandu", netherlands: "Amsterdam", holland: "Amsterdam", "new zealand": "Wellington", nicaragua: "Managua", nigeria: "Abuja",
  "north korea": "Pyongyang", norway: "Oslo", oman: "Muscat", pakistan: "Islamabad", panama: "Panama City", paraguay: "Asunción", peru: "Lima", philippines: "Manila",
  poland: "Warsaw", portugal: "Lisbon", qatar: "Doha", romania: "Bucharest", russia: "Moscow", rwanda: "Kigali", "saudi arabia": "Riyadh", scotland: "Edinburgh", senegal: "Dakar",
  serbia: "Belgrade", singapore: "Singapore", slovakia: "Bratislava", slovenia: "Ljubljana", somalia: "Mogadishu", "south africa": "Pretoria (executive), Cape Town (legislative) and Bloemfontein (judicial)",
  "south korea": "Seoul", korea: "Seoul", spain: "Madrid", "sri lanka": "Sri Jayawardenepura Kotte", sudan: "Khartoum", sweden: "Stockholm", switzerland: "Bern", syria: "Damascus",
  taiwan: "Taipei", tanzania: "Dodoma", thailand: "Bangkok", tunisia: "Tunis", turkey: "Ankara", türkiye: "Ankara", uganda: "Kampala", ukraine: "Kyiv", "united arab emirates": "Abu Dhabi",
  uae: "Abu Dhabi", "united kingdom": "London", uk: "London", "united states": "Washington, D.C.", usa: "Washington, D.C.", america: "Washington, D.C.", uruguay: "Montevideo",
  uzbekistan: "Tashkent", venezuela: "Caracas", vietnam: "Hanoi", wales: "Cardiff", yemen: "Sanaa", zambia: "Lusaka", zimbabwe: "Harare",
};
export function capitalOf(text) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z ü]/g, " ").replace(/\s+/g, " ")} `;
  const hit = (map) => Object.keys(map).filter((k) => t.includes(` ${k} `)).sort((a, b) => b.length - a.length)[0];
  // "washington" and "georgia" are states and more: "the state of …" or a state list wins for US names
  const us = hit(US_CAPITALS), world = hit(WORLD_CAPITALS);
  const pick = us && (!world || us.length >= world.length || /\bstate\b/.test(t)) ? { place: us, capital: US_CAPITALS[us], kind: "state" } : world ? { place: world, capital: WORLD_CAPITALS[world], kind: "country" } : null;
  return pick;
}
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUk\b/, "the UK").replace(/\bUsa\b/, "the USA").replace(/\bUae\b/, "the UAE");
export function capitalAnswer(text) {
  const c = capitalOf(text);
  if (!c) return null;
  return `The capital of ${title(c.place)} is ${c.capital}.`;
}

export const PLANETS = [
  { name: "Mercury", order: 1, moons: 0, fact: "It's the smallest planet and the closest to the Sun. A year there is just 88 Earth days." },
  { name: "Venus", order: 2, moons: 0, fact: "It's the hottest planet, hotter than Mercury, because its thick clouds trap the heat. It spins backwards compared to most planets." },
  { name: "Earth", order: 3, moons: 1, fact: "It's the only planet we know of with life, and about 71 percent of it is covered in water." },
  { name: "Mars", order: 4, moons: 2, fact: "It's called the Red Planet because of the rusty iron in its dust, and it has the tallest volcano in the solar system, Olympus Mons." },
  { name: "Jupiter", order: 5, moons: 95, fact: "It's the biggest planet: more than 1,300 Earths could fit inside it. Its Great Red Spot is a storm bigger than Earth." },
  { name: "Saturn", order: 6, moons: 146, fact: "It's famous for its rings, made of ice and rock, and it's so light it would float in a big enough bathtub." },
  { name: "Uranus", order: 7, moons: 28, fact: "It spins on its side, so its poles take turns facing the Sun." },
  { name: "Neptune", order: 8, moons: 16, fact: "It's the farthest planet from the Sun and has the fastest winds in the solar system." },
];
export function planetAnswer(text) {
  const q = String(text).toLowerCase();
  if (/\bhow many planets\b/.test(q)) return "There are eight planets in our solar system: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune. Pluto was reclassified as a dwarf planet in 2006.";
  if (/\b(biggest|largest)\b/.test(q)) return "Jupiter is the biggest planet. More than 1,300 Earths could fit inside it.";
  if (/\bsmallest\b/.test(q)) return "Mercury is the smallest planet, only a little bigger than our Moon.";
  if (/\bhottest\b/.test(q)) return "Venus is the hottest planet, around 870 degrees Fahrenheit, because its thick clouds trap heat.";
  if (/\b(farthest|furthest)\b/.test(q)) return "Neptune is the farthest planet from the Sun.";
  if (/\b(closest|nearest)\b.*\bsun\b/.test(q)) return "Mercury is the closest planet to the Sun.";
  if (/\bpluto\b/.test(q)) return "Pluto is a dwarf planet now. It was reclassified in 2006, but it's still out there past Neptune.";
  if (/\bmost moons\b/.test(q)) return "Saturn has the most known moons, well over a hundred.";
  const p = PLANETS.find((x) => q.includes(x.name.toLowerCase()));
  if (p && /\bmoons?\b/.test(q)) return `${p.name} has ${p.moons === 0 ? "no moons" : p.moons === 1 ? "one moon" : `${p.moons} known moons`}.`;
  if (p) return `${p.name} is planet number ${p.order} from the Sun. ${p.fact}`;
  if (/\bplanets?\b/.test(q)) return "In order from the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune.";
  return null;
}
export function timesTable(n) {
  const k = Math.max(1, Math.min(20, Math.round(Number(n) || 0)));
  return `The ${k} times table: ${Array.from({ length: 12 }, (_, i) => `${k} times ${i + 1} is ${k * (i + 1)}`).join(", ")}.`;
}

// ---- dates ------------------------------------------------------------------------------------------------------------
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function leapAnswer(year, now = new Date()) {
  const y = Number(year) || now.getFullYear();
  const next = (() => { let x = y + 1; while (!isLeap(x)) x++; return x; })();
  return isLeap(y) ? `Yes, ${y} is a leap year, so February has 29 days.` : `No, ${y} isn't a leap year. The next one is ${next}.`;
}

// ---- games ------------------------------------------------------------------------------------------------------------
export const TRIVIA = [
  ["What is the largest ocean on Earth?", ["pacific"], "The Pacific Ocean."],
  ["How many continents are there?", ["7", "seven"], "Seven."],
  ["What planet is known as the Red Planet?", ["mars"], "Mars."],
  ["How many legs does a spider have?", ["8", "eight"], "Eight."],
  ["What is the tallest animal in the world?", ["giraffe"], "The giraffe."],
  ["What is the freezing point of water in Fahrenheit?", ["32", "thirty two"], "32 degrees."],
  ["Which is the longest river in Africa?", ["nile"], "The Nile."],
  ["How many sides does a hexagon have?", ["6", "six"], "Six."],
  ["What gas do plants take in from the air?", ["carbon dioxide", "co2"], "Carbon dioxide."],
  ["Who painted the Mona Lisa?", ["da vinci", "leonardo"], "Leonardo da Vinci."],
  ["What is the largest mammal?", ["blue whale", "whale"], "The blue whale."],
  ["How many minutes are in a day?", ["1440", "1,440"], "1,440."],
  ["What is the hardest natural substance?", ["diamond"], "Diamond."],
  ["In which country are the pyramids of Giza?", ["egypt"], "Egypt."],
  ["How many strings does a standard guitar have?", ["6", "six"], "Six."],
  ["What is the capital of Canada?", ["ottawa"], "Ottawa."],
  ["Which bird is a symbol of peace?", ["dove"], "The dove."],
  ["What do bees make?", ["honey"], "Honey."],
  ["How many hours are in a week?", ["168"], "168."],
  ["What is the smallest prime number?", ["2", "two"], "Two."],
  ["What color do you get when you mix blue and yellow?", ["green"], "Green."],
  ["Which planet has the most famous rings?", ["saturn"], "Saturn."],
  ["How many players are on a soccer team on the field?", ["11", "eleven"], "Eleven."],
  ["What is the main ingredient in guacamole?", ["avocado"], "Avocado."],
  ["What instrument has 88 keys?", ["piano"], "The piano."],
  ["How many days are in a leap year?", ["366"], "366."],
  ["What is the largest desert in the world, counting cold deserts?", ["antarctic", "antarctica"], "Antarctica."],
  ["What is H2O better known as?", ["water"], "Water."],
  ["Which animal is known as the king of the jungle?", ["lion"], "The lion."],
  ["How many books are in the Bible, in most Protestant Bibles?", ["66", "sixty six"], "66."],
  ["What is the first book of the Bible?", ["genesis"], "Genesis."],
  ["Who built the ark?", ["noah"], "Noah."],
  ["What is the square root of 81?", ["9", "nine"], "Nine."],
  ["What is the fastest land animal?", ["cheetah"], "The cheetah."],
  ["How many hearts does an octopus have?", ["3", "three"], "Three."],
  ["Which US state is known as the Sunshine State?", ["florida"], "Florida."],
  ["What is the boiling point of water in Celsius?", ["100", "hundred"], "100 degrees."],
  ["Which month has the fewest days?", ["february"], "February."],
  ["How many colors are in a rainbow?", ["7", "seven"], "Seven."],
  ["What is the closest star to Earth?", ["sun"], "The Sun."],
];
export const EIGHT_BALL = ["It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];
export const WOULD_YOU_RATHER = [
  "Would you rather be able to fly, or be invisible?", "Would you rather live by the beach, or in the mountains?", "Would you rather have breakfast for dinner every night, or dessert for breakfast?",
  "Would you rather talk to animals, or speak every language?", "Would you rather always be ten minutes early, or ten minutes late?", "Would you rather explore space, or the deep ocean?",
  "Would you rather have a pet dragon, or a pet unicorn?", "Would you rather never have to sleep, or never have to eat?", "Would you rather be really fast, or really strong?",
  "Would you rather read minds, or see the future?", "Would you rather live without music, or without movies?", "Would you rather have summer all year, or winter all year?",
  "Would you rather be a famous singer, or a famous chef?", "Would you rather have a time machine, or a teleporter?", "Would you rather only whisper, or only shout?",
  "Would you rather live in a treehouse, or a castle?", "Would you rather have a robot helper, or a genie with three wishes?", "Would you rather give up pizza, or ice cream?",
];
export const RPS = ["rock", "paper", "scissors"];
export function rpsPlay(mine, rand = Math.random) {
  const me = RPS.includes(mine) ? mine : null;
  const them = RPS[Math.floor(rand() * 3)];
  if (!me) return { them, result: null };
  const win = { rock: "scissors", paper: "rock", scissors: "paper" };
  const result = me === them ? "tie" : win[me] === them ? "you" : "me";
  return { me, them, result, line: result === "tie" ? `I picked ${them} too. It's a tie!` : result === "you" ? `I picked ${them}. ${me[0].toUpperCase() + me.slice(1)} beats ${them}. You win!` : `I picked ${them}. ${them[0].toUpperCase() + them.slice(1)} beats ${me}. I win this time!` };
}
