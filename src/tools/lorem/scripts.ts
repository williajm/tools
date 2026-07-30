/**
 * Word banks per writing system.
 *
 * The reason this exists: layout bugs almost never show up in Latin text. CJK
 * has no spaces and much wider glyphs, Arabic and Hebrew run right to left,
 * Devanagari stacks marks above the line, and Thai has no word boundaries at
 * all — so naive line-breaking silently fails on it. Generating real text in
 * these scripts is how you find those bugs before a user does.
 */

export type ScriptId =
  | 'latin'
  | 'latin-accented'
  | 'cyrillic'
  | 'greek'
  | 'arabic'
  | 'hebrew'
  | 'cjk-han'
  | 'japanese'
  | 'korean'
  | 'devanagari'
  | 'thai';

export interface ScriptDef {
  id: ScriptId;
  name: string;
  /** Right-to-left, so the UI can set dir="rtl" on the preview. */
  rtl: boolean;
  /** No spaces between words, so wrapping must break mid-run. */
  unspaced: boolean;
  words: readonly string[];
  note: string;
}

export const SCRIPTS: readonly ScriptDef[] = [
  {
    id: 'latin',
    name: 'Latin (lorem ipsum)',
    rtl: false,
    unspaced: false,
    note: 'The classic. Baseline for comparison.',
    words: [
      'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
      'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
      'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi',
      'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
      'voluptate', 'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur', 'excepteur',
      'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
      'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum',
    ],
  },
  {
    id: 'latin-accented',
    name: 'Latin (accented)',
    rtl: false,
    unspaced: false,
    note: 'Diacritics and ligatures. Catches font fallback and normalisation bugs.',
    words: [
      'café', 'naïve', 'résumé', 'jalapeño', 'Ångström', 'Zürich', 'façade', 'crème', 'brûlée',
      'æther', 'Œuvre', 'piñata', 'señor', 'Dvořák', 'Škoda', 'Łódź', 'Þórr', 'Ærø', 'Malmö',
      'garçon', 'élève', 'hôtel', 'straße', 'Gdańsk', 'Košice', 'Århus', 'Reykjavík',
    ],
  },
  {
    id: 'cyrillic',
    name: 'Cyrillic',
    rtl: false,
    unspaced: false,
    note: 'Wider average word length than Latin. Good for testing truncation.',
    words: [
      'привет', 'мир', 'текст', 'пример', 'страница', 'документ', 'значение', 'система',
      'разработка', 'программа', 'компьютер', 'информация', 'пользователь', 'сообщение',
      'настройка', 'библиотека', 'интерфейс', 'приложение', 'данные', 'результат',
    ],
  },
  {
    id: 'greek',
    name: 'Greek',
    rtl: false,
    unspaced: false,
    note: 'Distinct casing rules — final sigma changes form.',
    words: [
      'γεια', 'κόσμος', 'κείμενο', 'παράδειγμα', 'σελίδα', 'έγγραφο', 'σύστημα', 'ανάπτυξη',
      'πρόγραμμα', 'υπολογιστής', 'πληροφορία', 'χρήστης', 'μήνυμα', 'βιβλιοθήκη', 'δεδομένα',
    ],
  },
  {
    id: 'arabic',
    name: 'Arabic (RTL)',
    rtl: true,
    unspaced: false,
    note: 'Right to left, and letters change shape by position. Breaks naive rendering.',
    words: [
      'مرحبا', 'عالم', 'نص', 'مثال', 'صفحة', 'وثيقة', 'نظام', 'تطوير', 'برنامج', 'حاسوب',
      'معلومات', 'مستخدم', 'رسالة', 'مكتبة', 'واجهة', 'تطبيق', 'بيانات', 'نتيجة', 'إعداد',
    ],
  },
  {
    id: 'hebrew',
    name: 'Hebrew (RTL)',
    rtl: true,
    unspaced: false,
    note: 'Right to left with final letter forms.',
    words: [
      'שלום', 'עולם', 'טקסט', 'דוגמה', 'עמוד', 'מסמך', 'מערכת', 'פיתוח', 'תוכנה', 'מחשב',
      'מידע', 'משתמש', 'הודעה', 'ספרייה', 'ממשק', 'יישום', 'נתונים', 'תוצאה',
    ],
  },
  {
    id: 'cjk-han',
    name: 'Chinese (Han)',
    rtl: false,
    unspaced: true,
    note: 'No spaces, full-width glyphs. Character counts and width diverge sharply.',
    words: [
      '你好', '世界', '文本', '例子', '页面', '文档', '系统', '开发', '程序', '计算机',
      '信息', '用户', '消息', '设置', '数据库', '接口', '应用', '数据', '结果', '测试',
    ],
  },
  {
    id: 'japanese',
    name: 'Japanese',
    rtl: false,
    unspaced: true,
    note: 'Mixes kanji, hiragana and katakana with no spaces.',
    words: [
      'こんにちは', '世界', 'テキスト', '例', 'ページ', '文書', 'システム', '開発', 'プログラム',
      'コンピュータ', '情報', 'ユーザー', 'メッセージ', '設定', 'ライブラリ', 'データ', '結果',
    ],
  },
  {
    id: 'korean',
    name: 'Korean',
    rtl: false,
    unspaced: false,
    note: 'Hangul syllable blocks. Spaced, but glyphs are full-width.',
    words: [
      '안녕하세요', '세계', '텍스트', '예시', '페이지', '문서', '시스템', '개발', '프로그램',
      '컴퓨터', '정보', '사용자', '메시지', '설정', '라이브러리', '데이터', '결과',
    ],
  },
  {
    id: 'devanagari',
    name: 'Devanagari (Hindi)',
    rtl: false,
    unspaced: false,
    note: 'Marks stack above and below the baseline — line height bugs show up here.',
    words: [
      'नमस्ते', 'दुनिया', 'पाठ', 'उदाहरण', 'पृष्ठ', 'दस्तावेज़', 'प्रणाली', 'विकास', 'कार्यक्रम',
      'संगणक', 'जानकारी', 'उपयोगकर्ता', 'संदेश', 'पुस्तकालय', 'डेटा', 'परिणाम',
    ],
  },
  {
    id: 'thai',
    name: 'Thai',
    rtl: false,
    unspaced: true,
    note: 'No spaces between words and no obvious break points. The hardest wrapping case.',
    words: [
      'สวัสดี', 'โลก', 'ข้อความ', 'ตัวอย่าง', 'หน้า', 'เอกสาร', 'ระบบ', 'การพัฒนา', 'โปรแกรม',
      'คอมพิวเตอร์', 'ข้อมูล', 'ผู้ใช้', 'ข่าวสาร', 'การตั้งค่า', 'ห้องสมุด', 'ผลลัพธ์',
    ],
  },
];

export function scriptById(id: ScriptId): ScriptDef {
  const found = SCRIPTS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown script: ${id}`);
  return found;
}
