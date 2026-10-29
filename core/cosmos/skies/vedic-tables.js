/**
 * The Vedic reference tables — each cross-verified across independent sources
 * in docs/architecture/identity/many-skies-vedic.md (§4, §6). Pure data.
 *
 * Varna is deliberately ABSENT: its mappings disagree three ways and it would
 * apply caste labels to a being (ruled out 2026-10-19).
 */

const T = Object.freeze;

// per nakshatra: Vimshottari lord, presiding deity (devatā), gana, yoni, nadi, symbol (primary / alternates)
export const NAKSHATRA_INFO = T([
  ['Ketu', 'Ashvini Kumaras', 'Deva', 'Horse', 'male', 'Adi', "Horse's head", null],
  ['Venus', 'Yama', 'Manushya', 'Elephant', 'male', 'Madhya', 'Yoni', null],
  ['Sun', 'Agni', 'Rakshasa', 'Sheep', 'female', 'Antya', 'Knife or spear', 'razor, dagger'],
  ['Moon', 'Prajapati (Brahma)', 'Manushya', 'Serpent', 'male', 'Antya', 'Cart or chariot', 'temple, banyan'],
  ['Mars', 'Soma', 'Deva', 'Serpent', 'female', 'Madhya', "Deer's head", null],
  ['Rahu', 'Rudra', 'Manushya', 'Dog', 'female', 'Adi', 'Teardrop', 'diamond, human head, gem'],
  ['Jupiter', 'Aditi', 'Deva', 'Cat', 'female', 'Adi', 'Bow and quiver', 'house'],
  ['Saturn', 'Brihaspati', 'Deva', 'Sheep', 'male', 'Madhya', "Cow's udder", 'lotus, arrow, circle, flower'],
  ['Mercury', 'Sarpas (Nagas)', 'Rakshasa', 'Cat', 'male', 'Antya', 'Serpent', 'wheel'],
  ['Ketu', 'Pitris', 'Rakshasa', 'Rat', 'male', 'Antya', 'Royal throne', 'palanquin'],
  ['Venus', 'Bhaga', 'Manushya', 'Rat', 'female', 'Madhya', 'Front legs of a bed', 'hammock, fig tree, stage'],
  ['Sun', 'Aryaman', 'Manushya', 'Cow', 'male', 'Adi', 'Four legs of a bed', 'back legs of a cot'],
  ['Moon', 'Savitr', 'Deva', 'Buffalo', 'female', 'Adi', 'Hand or fist', 'palm'],
  ['Mars', 'Tvashtar (Vishvakarma)', 'Rakshasa', 'Tiger', 'female', 'Madhya', 'Bright jewel or pearl', null],
  ['Rahu', 'Vayu', 'Deva', 'Buffalo', 'male', 'Antya', 'Shoot of a plant, or coral', 'sapphire'],
  ['Jupiter', 'Indra-Agni', 'Rakshasa', 'Tiger', 'male', 'Antya', 'Triumphal arch', "potter's wheel"],
  ['Saturn', 'Mitra', 'Deva', 'Deer', 'female', 'Madhya', 'Triumphal archway', 'lotus, heap of rice, umbrella'],
  ['Mercury', 'Indra', 'Rakshasa', 'Deer', 'male', 'Adi', 'Circular amulet or earring', 'umbrella'],
  ['Ketu', 'Nirriti', 'Rakshasa', 'Dog', 'male', 'Adi', 'Bunch of roots', "elephant goad, lion's tail"],
  ['Venus', 'Apah (the Waters)', 'Manushya', 'Monkey', 'male', 'Madhya', 'Elephant tusk', 'fan, winnowing basket'],
  ['Sun', 'Vishvedevas', 'Manushya', 'Mongoose', 'male', 'Antya', 'Elephant tusk', 'small bed, square'],
  ['Moon', 'Vishnu', 'Deva', 'Monkey', 'female', 'Antya', 'Ear, or three footprints', 'arrow'],
  ['Mars', 'Vasus', 'Rakshasa', 'Lion', 'female', 'Madhya', 'Drum or flute', null],
  ['Rahu', 'Varuna', 'Rakshasa', 'Horse', 'female', 'Adi', 'Empty circle', 'a thousand flowers or stars'],
  ['Jupiter', 'Aja Ekapada', 'Manushya', 'Lion', 'male', 'Adi', 'Swords', 'front legs of a funeral cot, two-faced man'],
  ['Saturn', 'Ahirbudhnya', 'Manushya', 'Cow', 'female', 'Madhya', 'Twins', 'back legs of a funeral cot, snake in water'],
  ['Mercury', 'Pushan', 'Deva', 'Elephant', 'female', 'Antya', 'Fish, or a pair of fish', 'drum'],
].map(([lord, deity, gana, yoni, yoniGender, nadi, symbol, alternates]) => T({ lord, deity, gana, yoni, yoniGender, nadi, symbol, alternates })));

export const YOGAS = T(['Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti', 'Shula', 'Ganda',
  'Vriddhi', 'Dhruva', 'Vyaghata', 'Harshana', 'Vajra', 'Siddhi', 'Vyatipata', 'Variyan', 'Parigha', 'Shiva', 'Siddha', 'Sadhya',
  'Shubha', 'Shukla', 'Brahma', 'Indra', 'Vaidhriti']);

const TITHI_14 = ['Pratipada', 'Dvitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dvadashi', 'Trayodashi', 'Chaturdashi'];
/** The name of tithi 1–30. Pure. */
export const tithiName = (n) => (n === 15 ? 'Purnima' : n === 30 ? 'Amavasya' : TITHI_14[(n - 1) % 15]);

// the lunar months — MASAS[0] Chaitra … MASAS[11] Phalguna
export const MASAS = T(['Chaitra', 'Vaishakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada', 'Ashvina', 'Kartika',
  'Margashirsha', 'Pausha', 'Magha', 'Phalguna']);

export const RITUS = T(['Vasanta', 'Grishma', 'Varsha', 'Sharad', 'Hemanta', 'Shishira']);

export const SAMVATSARAS = T(['Prabhava', 'Vibhava', 'Shukla', 'Pramoda', 'Prajapati', 'Angirasa', 'Shrimukha', 'Bhava', 'Yuva', 'Dhatri',
  'Ishvara', 'Bahudhanya', 'Pramathi', 'Vikrama', 'Vrisha', 'Chitrabhanu', 'Svabhanu', 'Tarana', 'Parthiva', 'Vyaya',
  'Sarvajit', 'Sarvadhari', 'Virodhi', 'Vikriti', 'Khara', 'Nandana', 'Vijaya', 'Jaya', 'Manmatha', 'Durmukhi',
  'Hevilambi', 'Vilambi', 'Vikari', 'Sharvari', 'Plava', 'Shubhakrit', 'Shobhakrit', 'Krodhi', 'Vishvavasu', 'Parabhava',
  'Plavanga', 'Kilaka', 'Saumya', 'Sadharana', 'Virodhakrit', 'Paridhavi', 'Pramadi', 'Ananda', 'Rakshasa', 'Nala',
  'Pingala', 'Kalayukta', 'Siddharthi', 'Raudra', 'Durmati', 'Dundubhi', 'Rudhirodgari', 'Raktakshi', 'Krodhana', 'Akshaya']);

// the nine grahas in their Sanskrit names
export const GRAHA_NAMES = T({ sun: 'Surya', moon: 'Chandra', mars: 'Mangala', mercury: 'Budha', jupiter: 'Guru', venus: 'Shukra', saturn: 'Shani', rahu: 'Rahu', ketu: 'Ketu' });
