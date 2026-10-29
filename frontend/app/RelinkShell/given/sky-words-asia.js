// sky-words-asia.js — nothing on the SKY page stands in another script without
// its sound and its meaning. Each Thai or Japanese word a plate shows is given
// here with its romanization (Thai: the Royal Thai General System; Japanese:
// Hepburn) and a plain English gloss — the literal meaning of the word, never a
// verdict about the being. Pure tables; the record keeps its own words.

const THAI = Object.freeze({
  // the planets
  อาทิตย์: ['Athit', 'the Sun'], จันทร์: ['Chan', 'the Moon'], อังคาร: ['Angkhan', 'Mars'], พุธ: ['Phut', 'Mercury'],
  พฤหัสบดี: ['Phruehatsabodi', 'Jupiter'], ศุกร์: ['Suk', 'Venus'], เสาร์: ['Sao', 'Saturn'], ราหู: ['Rahu', 'Rahu'], เกตุ: ['Ket', 'Ketu'],
  // the eight roles of the Thaksa wheel
  บริวาร: ['Boriwan', 'dependants'], อายุ: ['Ayu', 'life'], เดช: ['Det', 'power'], ศรี: ['Si', 'fortune'],
  มูละ: ['Mula', 'roots'], อุตสาหะ: ['Utsaha', 'effort'], มนตรี: ['Montri', 'patrons'], กาลกิณี: ['Kalakini', 'misfortune'],
  // the birth-day colours
  แดง: ['daeng', 'red'], เหลือง: ['lueang', 'yellow'], ชมพู: ['chomphu', 'pink'], เขียว: ['khiao', 'green'],
  'เทา / ดำ': ['thao / dam', 'grey / black'], ส้ม: ['som', 'orange'], ฟ้า: ['fa', 'light blue'], ม่วง: ['muang', 'purple'],
  // the eight Buddha images (ปาง, pang: an attitude of the Buddha)
  ถวายเนตร: ['Pang Thawai Net', 'standing, gazing at the Bodhi tree'], ห้ามสมุทร: ['Pang Ham Samut', 'calming the ocean'],
  ไสยาสน์: ['Pang Saiyat', 'reclining'], อุ้มบาตร: ['Pang Um Bat', 'holding the alms bowl'],
  ป่าเลไลยก์: ['Pang Pa Lelai', 'in the Parileyya forest, with the elephant and the monkey'], สมาธิ: ['Pang Samathi', 'meditation'],
  รำพึง: ['Pang Ramphueng', 'contemplation'], นาคปรก: ['Pang Nak Prok', 'sheltered by the naga'],
  // the year names of the Chula Sakarat, by the year's last digit
  สัมฤทธิศก: ['Samritthisok', 'the year ending in 0'], เอกศก: ['Ekkasok', 'the year ending in 1'], โทศก: ['Thosok', 'the year ending in 2'],
  ตรีศก: ['Trisok', 'the year ending in 3'], จัตวาศก: ['Chattawasok', 'the year ending in 4'], เบญจศก: ['Benchasok', 'the year ending in 5'],
  ฉศก: ['Chasok', 'the year ending in 6'], สัปตศก: ['Sapphasok', 'the year ending in 7'], อัฐศก: ['Atthasok', 'the year ending in 8'], นพศก: ['Nopphasok', 'the year ending in 9'],
  // the twelve year animals (ปี, pi: year)
  ปีชวด: ['Pi Chuat', 'year of the Rat'], ปีฉลู: ['Pi Chalu', 'year of the Ox'], ปีขาล: ['Pi Khan', 'year of the Tiger'], ปีเถาะ: ['Pi Tho', 'year of the Rabbit'],
  ปีมะโรง: ['Pi Marong', 'year of the Naga'], ปีมะเส็ง: ['Pi Maseng', 'year of the Snake'], ปีมะเมีย: ['Pi Mamia', 'year of the Horse'], ปีมะแม: ['Pi Mamae', 'year of the Goat'],
  ปีวอก: ['Pi Wok', 'year of the Monkey'], ปีระกา: ['Pi Raka', 'year of the Rooster'], ปีจอ: ['Pi Cho', 'year of the Dog'], ปีกุน: ['Pi Kun', 'year of the Pig'],
});

const JAPANESE = Object.freeze({
  // the six days of rokuyō — the literal sense of each name
  大安: ['Taian', 'great peace'], 赤口: ['Shakkō', 'red mouth'], 先勝: ['Senshō', 'the first wins'],
  友引: ['Tomobiki', 'pulls a friend along'], 先負: ['Senbu', 'the first loses'], 仏滅: ['Butsumetsu', 'the Buddha’s passing'],
  // the nine stars (kyūsei): number, colour, element
  一白水星: ['Ippaku Suisei', 'One White, Water'], 二黒土星: ['Jikoku Dosei', 'Two Black, Earth'], 三碧木星: ['Sanpeki Mokusei', 'Three Jade, Wood'],
  四緑木星: ['Shiroku Mokusei', 'Four Green, Wood'], 五黄土星: ['Goō Dosei', 'Five Yellow, Earth'], 六白金星: ['Roppaku Kinsei', 'Six White, Metal'],
  七赤金星: ['Shichiseki Kinsei', 'Seven Red, Metal'], 八白土星: ['Happaku Dosei', 'Eight White, Earth'], 九紫火星: ['Kyūshi Kasei', 'Nine Purple, Fire'],
});

const WORDS = Object.freeze({ ...THAI, ...JAPANESE });

/** A word's romanization, or the word itself when it is not in the tables. Pure. */
export const romanOf = (w) => WORDS[w]?.[0] ?? w;
/** A word's English sense, or null. Pure. */
export const senseOf = (w) => WORDS[w]?.[1] ?? null;
/** "อังคาร Angkhan (Mars)" — the word, its sound, its sense. Pure. */
export const glossed = (w) => (WORDS[w] ? `${w} ${WORDS[w][0]} (${WORDS[w][1]})` : String(w ?? ''));

/** A Thai lunar date in words: […]. Pure. */
export const thaiLunarWords = (l) => `${l.phase === 'waxing' ? 'waxing' : 'waning'} day ${l.phaseDay} of month ${l.second8 ? '8 — the second eighth month' : l.month}`;
