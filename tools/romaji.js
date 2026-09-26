/* Kana -> Latin alphabet transliteration.
   Japanese set names are nearly always English words written in katakana
   (ストームエメラルダ = Storm Emeralda), so turning them into our alphabet makes
   them recognisable. Kanji is left as it is: there is no way to read it
   without a huge dictionary. */

const KANA2 = {
  'キャ':'kya','キュ':'kyu','キョ':'kyo','シャ':'sha','シュ':'shu','ショ':'sho',
  'チャ':'cha','チュ':'chu','チョ':'cho','ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
  'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
  'ジャ':'ja','ジュ':'ju','ジョ':'jo','ビャ':'bya','ビュ':'byu','ビョ':'byo',
  'ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
  'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','フュ':'fyu',
  'ティ':'ti','ディ':'di','トゥ':'tu','ドゥ':'du','デュ':'dyu','テュ':'tyu',
  'ウィ':'wi','ウェ':'we','ウォ':'wo','シェ':'she','ジェ':'je','チェ':'che',
  'ヴァ':'va','ヴィ':'vi','ヴェ':'ve','ヴォ':'vo','ツァ':'tsa','ツェ':'tse','ツォ':'tso',
  'クァ':'kwa','クィ':'kwi','クェ':'kwe','クォ':'kwo','グァ':'gwa'
};
const KANA1 = {
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
  'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
  'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
  'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
  'ヤ':'ya','ユ':'yu','ヨ':'yo',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
  'ワ':'wa','ヰ':'i','ヱ':'e','ヲ':'o','ン':'n',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
  'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
  'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
  'ヴ':'vu','ャ':'ya','ュ':'yu','ョ':'yo','ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o',
  '・':' ','＝':' ','　':' '
};

const isKana = ch => {
  const c = ch.charCodeAt(0);
  return (c >= 0x30a0 && c <= 0x30ff) || (c >= 0x3040 && c <= 0x309f);
};
/* hiragana -> katakana, so a single table is enough */
const toKatakana = s => s.replace(/[ぁ-ゖ]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60));

function romaji(txt) {
  if (!txt) return '';
  const s = toKatakana(String(txt));
  let out = '';
  let i = 0;
  let afterKana = false;
  while (i < s.length) {
    const pair = s.slice(i, i + 2);
    if (KANA2[pair]) { out += KANA2[pair]; i += 2; afterKana = true; continue; }
    const ch = s[i];
    if (ch === 'ー') {                       // lengthens the previous vowel
      const v = out.slice(-1);
      if ('aeiou'.indexOf(v) >= 0) out += v;
      i++; continue;
    }
    if (ch === 'ッ') {                       // doubles the next consonant
      const next = KANA2[s.slice(i + 1, i + 3)] || KANA1[s[i + 1]] || '';
      if (next) out += next[0];
      i++; continue;
    }
    if (KANA1[ch] != null) { out += KANA1[ch]; i++; afterKana = true; continue; }
    /* not kana: kanji, Latin letters, digits... are copied as they are,
       with a space so they don't stick to the transliteration */
    if (afterKana && out.slice(-1) !== ' ') out += ' ';
    out += ch;
    afterKana = false;
    i++;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

if (typeof module !== 'undefined') module.exports = { romaji };
