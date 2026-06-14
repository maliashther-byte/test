const LOCAL_QUESTION_BANK = {
  general: {
    easy: [
      { question: "What color is the sky on a clear day?", options: ["Blue","Green","Red","Purple"], answer: "Blue" },
      { question: "How many legs does a spider normally have?", options: ["6","8","4","2"], answer: "8" },
      { question: "Which animal is known as man's best friend?", options: ["Cat","Dog","Parrot","Horse"], answer: "Dog" }
    ],
    medium: [
      { question: "Which planet is known as the Red Planet?", options: ["Venus","Mars","Jupiter","Mercury"], answer: "Mars" },
      { question: "What is the capital of France?", options: ["Berlin","Madrid","Paris","Rome"], answer: "Paris" },
      { question: "In computing, what does CPU stand for?", options: ["Central Process Unit","Central Processing Unit","Computer Processing Unit","Control Processing Unit"], answer: "Central Processing Unit" }
    ],
    hard: [
      { question: "Who developed the theory of general relativity?", options: ["Newton","Einstein","Bohr","Eddington"], answer: "Einstein" },
      { question: "What is the value of pi rounded to 3 decimal places?", options: ["3.142","3.141","3.143","3.140"], answer: "3.142" },
      { question: "Which element has the chemical symbol 'Au'?", options: ["Silver","Gold","Astatine","Argon"], answer: "Gold" }
    ]
  },
  science: {
    easy: [
      { question: "What gas do plants take in for photosynthesis?", options: ["Oxygen","Carbon Dioxide","Nitrogen","Helium"], answer: "Carbon Dioxide" },
      { question: "Water freezes at what temperature on the Celsius scale?", options: ["0","32","100","-10"], answer: "0" }
    ],
    medium: [
      { question: "What is the chemical symbol for water?", options: ["O2","H2O","CO2","HO2"], answer: "H2O" },
      { question: "Which planet has the most moons in our solar system (as of 2024)?", options: ["Earth","Mars","Jupiter","Venus"], answer: "Jupiter" }
    ],
    hard: [
      { question: "What is the powerhouse of the cell?", options: ["Nucleus","Ribosome","Mitochondria","Golgi apparatus"], answer: "Mitochondria" }
    ]
  },
  history: {
    easy: [
      { question: "Who was the first President of the United States?", options: ["Abraham Lincoln","George Washington","Thomas Jefferson","John Adams"], answer: "George Washington" }
    ],
    medium: [
      { question: "In which year did World War II end?", options: ["1942","1945","1939","1950"], answer: "1945" }
    ],
    hard: [
      { question: "Which ancient civilization built Machu Picchu?", options: ["Maya","Aztec","Inca","Olmec"], answer: "Inca" }
    ]
  },
  geography: {
    easy: [
      { question: "Which is the largest continent by land area?", options: ["Africa","Asia","Europe","Antarctica"], answer: "Asia" }
    ],
    medium: [
      { question: "What is the longest river in the world?", options: ["Amazon","Nile","Yangtze","Mississippi"], answer: "Nile" }
    ],
    hard: [
      { question: "Which country has the most natural lakes?", options: ["Canada","Russia","USA","Finland"], answer: "Canada" }
    ]
  },
  movies: {
    easy: [
      { question: "Which movie features the character 'Darth Vader'?", options: ["Star Wars","The Matrix","Jurassic Park","Back to the Future"], answer: "Star Wars" }
    ],
    medium: [
      { question: "Who directed 'Jaws' (1975)?", options: ["Steven Spielberg","James Cameron","Martin Scorsese","Ridley Scott"], answer: "Steven Spielberg" }
    ],
    hard: [
      { question: "Which film won the first Academy Award for Best Picture (1929)?", options: ["Wings","Sunrise","All Quiet on the Western Front","The Jazz Singer"], answer: "Wings" }
    ]
  },
  sports: {
    easy: [
      { question: "How many players are there in a soccer (football) team on the field?", options: ["9","10","11","12"], answer: "11" }
    ],
    medium: [
      { question: "What sport uses a shuttlecock?", options: ["Tennis","Badminton","Squash","Table Tennis"], answer: "Badminton" }
    ],
    hard: [
      { question: "In which country were the first modern Olympics held in 1896?", options: ["France","Greece","UK","USA"], answer: "Greece" }
    ]
  }
};

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function decodeHtmlEntities(str = "") {
  return str.replace(/&quot;|&#34;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é');
}

async function fetchOpenTrivia(difficulty = 'medium') {
  try {
    const level = (difficulty || 'medium').toLowerCase();
    const url = `https://opentdb.com/api.php?amount=1&type=multiple&difficulty=${encodeURIComponent(level)}`;
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) throw new Error('Fetch failed');
    const json = await res.json();
    if (!json.results || !json.results.length) throw new Error('No results');
    const r = json.results[0];
    const question = decodeHtmlEntities(r.question);
    const correct = decodeHtmlEntities(r.correct_answer);
    const incorrect = (r.incorrect_answers || []).map(decodeHtmlEntities);
    const options = shuffle([correct, ...incorrect]).slice(0, 4);
    return { question, options, answer: correct };
  } catch (e) {
    return null;
  }
}


/**
 * generateTriviaQuestion(difficulty = 'medium', category = null)
 * - difficulty: 'easy'|'medium'|'hard'
 * - category: null for random or one of LOCAL_QUESTION_BANK keys
 */
export async function generateTriviaQuestion(difficulty = 'medium', category = null) {
  // Try live API first when enabled
  if (process.env.USE_OPEN_TRIVIA === 'true') {
    const live = await fetchOpenTrivia(difficulty);
    if (live) return live;
  }

  const level = (difficulty || 'medium').toLowerCase();

  // Choose category
  const categories = Object.keys(LOCAL_QUESTION_BANK);
  let chosenCategory = category && categories.includes(category) ? category : null;
  if (!chosenCategory) {
    // Prefer general, but randomize occasionally
    chosenCategory = Math.random() < 0.6 ? 'general' : categories[Math.floor(Math.random() * categories.length)];
  }

  const pool = (LOCAL_QUESTION_BANK[chosenCategory] && LOCAL_QUESTION_BANK[chosenCategory][level]) || LOCAL_QUESTION_BANK.general[level];
  const item = pool[Math.floor(Math.random() * pool.length)];
  const options = shuffle(Array.from(item.options));
  return { question: item.question, options, answer: item.answer, category: chosenCategory, difficulty: level };
}

export default { generateTriviaQuestion };
