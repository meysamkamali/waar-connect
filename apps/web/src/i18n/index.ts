// Guest-facing strings in the station's languages: English, Bahdini (code ku), Sorani (ckb) and Arabic.
// The Kurdish and Arabic texts were written by the assistant and need a native speaker's review
// before the first programme; every key is short on purpose.
import { signal } from '@preact/signals';

export type Lang = 'en' | 'ku' | 'ckb' | 'ar';

const en = {
  appName: 'waar Connect',
  loading: 'Loading…',
  invalidLink: 'This link is not valid.',
  checkTitle: 'Camera and microphone',
  camera: 'Camera',
  microphone: 'Microphone',
  permission: 'Allow the camera and microphone when the phone asks.',
  network: 'Connection to the studio',
  join: 'Join',
  lobbyTitle: 'Please wait',
  lobbyText: 'The producer will bring you in shortly.',
  you: 'You',
  greenTitle: 'Green room',
  greenText: 'You are with the producer. The studio cannot hear you yet.',
  studioTitle: 'Studio',
  standby: 'STAND BY',
  onair: 'ON AIR',
  mute: 'Mute',
  unmute: 'Unmute',
  raiseHand: 'Raise hand',
  handRaised: 'Hand raised',
  help: 'Help',
  info: 'Info',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Connection lost. Reload the page.',
  noMedia: 'Connected, but no picture or sound is going out.',
  exitTitle: 'Thank you',
  exitText: 'You have left the programme.',
  producer: 'Producer',
  ended: 'This programme has ended.',
  deviceError: 'The camera or microphone could not be started.',
  fullScreen: 'Full screen',
  exitFullScreen: 'Leave full screen',
  tapFullScreen: 'Tap the screen for full screen',
};

export type Strings = typeof en;

// Bahdini, in Arabic letters, as the station writes Kurdish. Until 2026-11-11 this was Kurmanji in Latin letters.
const ku: Strings = {
  appName: 'waar Connect',
  loading: 'دهێتە بارکرن…',
  invalidLink: 'ئەڤ لینکە نە یێ دروستە.',
  checkTitle: 'کامێرا و مایکرۆفۆن',
  camera: 'کامێرا',
  microphone: 'مایکرۆفۆن',
  permission: 'دەمێ مۆبایل دپرسیت، دەستویریێ بدە کامێرا و مایکرۆفۆنێ.',
  network: 'پەیوەندی دگەل ستۆدیۆیێ',
  join: 'بەشدار ببە',
  lobbyTitle: 'هیڤیە چاڤەڕێ بە',
  lobbyText: 'بەرهەمهێنەر دێ نوکە تە ئینیتە ژوور.',
  you: 'تو',
  greenTitle: 'ژوورا کەسک',
  greenText: 'تو یێ دگەل بەرهەمهێنەری. ستۆدیۆ هێشتا دەنگێ تە نابهیسیت.',
  studioTitle: 'ستۆدیۆ',
  standby: 'ئامادە بە',
  onair: 'ل سەر هەوایێ',
  mute: 'بێدەنگ',
  unmute: 'دەنگی ڤەکە',
  raiseHand: 'دەستێ خۆ بلند بکە',
  handRaised: 'دەست یێ بلندکریە',
  help: 'هاریکاری',
  info: 'پێزانین',
  connecting: 'پەیوەندی دهێتە کرن…',
  reconnecting: 'دوبارە پەیوەندی دهێتە کرن…',
  disconnected: 'پەیوەندی هاتە بڕین. لاپەڕەی نوی بکە.',
  noMedia: 'پەیوەندی هەیە، بەلێ وێنە و دەنگ ناچن.',
  exitTitle: 'سوپاس',
  exitText: 'تو ژ بەرنامەی دەرکەفتی.',
  producer: 'بەرهەمهێنەر',
  ended: 'ئەڤ بەرنامە ب دوماهیک هات.',
  deviceError: 'کامێرا یان مایکرۆفۆن دەست پێ نەکر.',
  fullScreen: 'هەمی شاشە',
  exitFullScreen: 'دەرکەفتن ژ هەمی شاشێ',
  tapFullScreen: 'بۆ هەمی شاشێ دەستێ خۆ ل شاشێ بدە',
};

const ckb: Strings = {
  appName: 'waar Connect',
  loading: 'بارکردن…',
  invalidLink: 'ئەم لینکە کار ناکات.',
  checkTitle: 'کامێرا و مایکرۆفۆن',
  camera: 'کامێرا',
  microphone: 'مایکرۆفۆن',
  permission: 'کاتێک مۆبایلەکە داوا دەکات، ڕێگە بدە بە کامێرا و مایکرۆفۆن.',
  network: 'پەیوەندی لەگەڵ ستودیۆ',
  join: 'بچۆ ژوورەوە',
  lobbyTitle: 'تکایە چاوەڕێ بکە',
  lobbyText: 'بەرهەمهێنەر بەم زووانە دەتهێنێتە ژوورەوە.',
  you: 'تۆ',
  greenTitle: 'ژووری سەوز',
  greenText: 'تۆ لەگەڵ بەرهەمهێنەریت. ستودیۆ هێشتا گوێت لێ نابێت.',
  studioTitle: 'ستودیۆ',
  standby: 'ئامادە بە',
  onair: 'لەسەر هەوا',
  mute: 'بێدەنگ',
  unmute: 'دەنگ بکەرەوە',
  raiseHand: 'دەست بەرز بکەرەوە',
  handRaised: 'دەست بەرزکراوەتەوە',
  help: 'یارمەتی',
  info: 'زانیاری',
  connecting: 'پەیوەندی دەکرێت…',
  reconnecting: 'دووبارە پەیوەندی دەکرێتەوە…',
  disconnected: 'پەیوەندی پچڕا. لاپەڕەکە نوێ بکەرەوە.',
  noMedia: 'پەیوەست بووە، بەڵام وێنە و دەنگ ناڕۆن.',
  exitTitle: 'سوپاس',
  exitText: 'تۆ لە بەرنامەکە چوویتە دەرەوە.',
  producer: 'بەرهەمهێنەر',
  ended: 'ئەم بەرنامەیە کۆتایی هات.',
  deviceError: 'کامێرا یان مایکرۆفۆن دەست پێ نەکرد.',
  fullScreen: 'پڕ بە شاشە',
  exitFullScreen: 'دەرچوون لە پڕ بە شاشە',
  tapFullScreen: 'بۆ پڕ بە شاشە دەست لە شاشەکە بدە',
};

const ar: Strings = {
  appName: 'waar Connect',
  loading: 'جارٍ التحميل…',
  invalidLink: 'هذا الرابط غير صالح.',
  checkTitle: 'الكاميرا والميكروفون',
  camera: 'الكاميرا',
  microphone: 'الميكروفون',
  permission: 'اسمح بالكاميرا والميكروفون عندما يطلب الهاتف ذلك.',
  network: 'الاتصال بالاستوديو',
  join: 'انضمام',
  lobbyTitle: 'يرجى الانتظار',
  lobbyText: 'سيُدخلك المنتج بعد قليل.',
  you: 'أنت',
  greenTitle: 'الغرفة الخضراء',
  greenText: 'أنت مع المنتج. الاستوديو لا يسمعك بعد.',
  studioTitle: 'الاستوديو',
  standby: 'استعد',
  onair: 'على الهواء',
  mute: 'كتم',
  unmute: 'إلغاء الكتم',
  raiseHand: 'رفع اليد',
  handRaised: 'اليد مرفوعة',
  help: 'مساعدة',
  info: 'معلومات',
  connecting: 'جارٍ الاتصال…',
  reconnecting: 'جارٍ إعادة الاتصال…',
  disconnected: 'انقطع الاتصال. أعد تحميل الصفحة.',
  noMedia: 'متصل، لكن لا يمر صوت أو صورة.',
  exitTitle: 'شكرًا',
  exitText: 'لقد غادرت البرنامج.',
  producer: 'المنتج',
  ended: 'انتهى هذا البرنامج.',
  deviceError: 'تعذّر تشغيل الكاميرا أو الميكروفون.',
  fullScreen: 'ملء الشاشة',
  exitFullScreen: 'الخروج من ملء الشاشة',
  tapFullScreen: 'المس الشاشة لملء الشاشة',
};

const DICTS: Record<Lang, Strings> = { en, ku, ckb, ar };
const RTL: ReadonlySet<Lang> = new Set<Lang>(['ku', 'ckb', 'ar']);

export const lang = signal<Lang>('en');

export function setLanguage(code: string | undefined): void {
  const l: Lang = code === 'ku' || code === 'ckb' || code === 'ar' ? code : 'en';
  lang.value = l;
  document.documentElement.lang = l;
  document.documentElement.dir = RTL.has(l) ? 'rtl' : 'ltr';
}

export function t(key: keyof Strings): string {
  return DICTS[lang.value][key];
}
