// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  STUB ENGINE — REPLACE WITH P2's DETECTION ENGINE (see CONTRACT.md §1)     ║
// ║  Deliberately small: a handful of obvious patterns so the whole flow works ║
// ║  end-to-end before the real engine lands. No anti-trick handling here.    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Words before a match that turn "share your OTP" into "never share your OTP".
const NEGATION_BEFORE = /\b(?:not|never|don'?t|do not|dont|won'?t|will never|no one|nobody|no need to)\b[^.!?\n]{0,15}$/i;
const NEGATION_AFTER = /^[^.!?\n]{0,8}(?:ಬೇಡ|beda|maadbedi|madbedi|madabedi|maadabedi)/i;
// Hindi / Hinglish put the "not" inside the phrase: "OTP किसी को न बताएं", "OTP kisi ko mat batao".
const NEGATION_INSIDE = /(?:^|[\s,])(?:न|ना|मत|नहीं|mat|na|nahi|nahin)(?=[\s,]|$)/iu;

const R = (id, category, strength, weight, lang, re, explanation, negatable = false) => ({
  id, category, strength, weight, lang, re, explanation, negatable,
});

const RULES = [
  // ── credential ────────────────────────────────────────────────────────────
  R('otp_request', 'credential', 'serious', 35, 'en',
    /\b(?:share|send|tell|give|provide|enter|confirm|forward|reply with|disclose|submit)\b[^.!?\n]{0,40}?\b(?:otp|one[- ]?time[- ]?password|m?pin|cvv|password|passcode)\b/gi,
    'Asks you to share an OTP, PIN or password — real banks and companies never ask for these.', true),
  R('otp_request', 'credential', 'serious', 35, 'kanglish',
    /\b(?:otp|pin|password)\b[^.!?\n]{0,25}?\b(?:heli|helri|kodi|kodri|kalsi|kalisi|share\s?maadi|share\s?madi|send\s?maadi|send\s?madi|tilsi|thilsi)\b/gi,
    'Asks you to tell or send your OTP/PIN (Kanglish) — never share these with anyone.', true),
  R('otp_request', 'credential', 'serious', 35, 'kn',
    /(?:ಒಟಿಪಿ|ಓಟಿಪಿ|OTP|ಪಿನ್|PIN|ಪಾಸ್‌?ವರ್ಡ್)[^.!?\n]{0,35}?(?:ಹಂಚಿಕೊಳ್ಳಿ|ತಿಳಿಸಿ|ಕಳುಹಿಸಿ|ಹೇಳಿ|ನೀಡಿ|ಕೊಡಿ)/gu,
    'Asks you to share your OTP/PIN (Kannada) — real organisations never ask for these.', true),
  R('kyc_update', 'credential', 'weak', 12, 'en',
    /\b(?:(?:update|verify|complete|re-?submit|link)\b[^.!?\n]{0,25}?\b(?:kyc|pan|aadhaa?r)\b|(?:kyc|pan|aadhaa?r)\b[^.!?\n]{0,20}?\b(?:update|verification|verify|expired?|pending|suspended|blocked)\b)/gi,
    'Banks and companies do not ask you to update KYC/PAN/Aadhaar through a message.'),
  R('kyc_update', 'credential', 'weak', 12, 'kn',
    /KYC\s?(?:ಅಪ್‌?ಡೇಟ್|ನವೀಕರಿಸಿ|ಪರಿಶೀಲನೆ)/gu,
    'Asks you to update KYC (Kannada) — banks never do this through an SMS.'),

  // ── urgency ───────────────────────────────────────────────────────────────
  R('urgency', 'urgency', 'weak', 10, 'en',
    /\b(?:urgent(?:ly)?|immediately|right now|act now|asap|within \d+\s?(?:hours?|hrs?|minutes?|mins?)|today itself|last chance|final (?:notice|warning|reminder)|expires? (?:today|tonight)|before midnight|expires? in \d+\s?(?:hours?|hrs?|minutes?|mins?)|before it expires|limited[- ]time offer|hurry|don'?t miss out|mandatory (?:action|compliance|system)[^.!?\n]{0,20}|(?:check|payment|balance|filing)s? (?:is |are )?overdue)\b/gi,
    'Creates urgency so you act before you think.'),
  R('urgency', 'urgency', 'weak', 10, 'kanglish',
    /\b(?:bega|beega|takshana|thakshana|ivattu\s?ne|ivathe|eegle|eega\s?le)\b/gi,
    'Rushes you ("bega", "takshana") so you act before you think.'),
  R('urgency', 'urgency', 'weak', 10, 'kn',
    /(?:ತಕ್ಷಣ|ಕೂಡಲೇ|ತುರ್ತು|ಇಂದೇ|ಈಗಲೇ)/gu,
    'Rushes you ("ತಕ್ಷಣ" = immediately) so you act before you think.'),

  // ── threat ────────────────────────────────────────────────────────────────
  R('threat', 'threat', 'weak', 12, 'en',
    /\b(?:blocked|suspended|suspension|deactivated|deactivation|disconnected|disconnection|terminated|frozen|legal action|penalty|permanently locked|security breach|compromised|flagged for (?:a )?(?:severe )?violation|restricted (?:profile|account)|(?:temporarily|permanently) (?:restricted|locked|suspended|on hold)|unauthori[sz]ed (?:wire|transaction|charge|payment|login|sign-?in|access|debit)|(?:sign-?in|login) attempt|unrecogni[sz]ed device|unusual (?:activity|sign-?in|login)|on hold due to)\b/gi,
    'Threatens that something will be blocked or cut to scare you.'),
  R('threat', 'threat', 'weak', 12, 'kanglish',
    /\b(?:(?:power|current|line)\s?cut\s?(?:aagutte|agutte|madtivi|maadtivi)|block\s?(?:aagutte|agutte|madtivi|maadtivi)|band\s?(?:aagutte|agutte))\b/gi,
    'Threatens a power cut or block (Kanglish) to scare you.'),
  R('threat', 'threat', 'weak', 12, 'kn',
    /(?:ಬ್ಲಾಕ್|ಸ್ಥಗಿತ|ಕಡಿತ|ನಿರ್ಬಂಧ)/gu,
    'Threatens that your account or service will be blocked (Kannada).'),
  R('digital_arrest', 'threat', 'serious', 30, 'en',
    /\b(?:digital(?:ly)? arrest(?:ed)?|arrest warrant|under arrest|face arrest|will be arrested|money laundering|narcotics|illegal drugs)\b/gi,
    'Police, CBI and customs never "arrest" anyone over a call or message — this is the "digital arrest" scam.'),
  R('digital_arrest', 'threat', 'serious', 30, 'kanglish',
    /\b(?:arrest\s?(?:madtivi|maadtivi|aagthira|agtira|aagtira))\b/gi,
    'Threatens arrest (Kanglish) — real police never do this over a message.'),
  R('digital_arrest', 'threat', 'serious', 30, 'kn',
    /(?:ಡಿಜಿಟಲ್ ಅರೆಸ್ಟ್|ಬಂಧಿಸಲಾಗುವುದು|ಬಂಧನ ವಾರಂಟ್)/gu,
    'Threatens arrest (Kannada) — real police never do this over a message.'),

  // ── money ─────────────────────────────────────────────────────────────────
  R('money_request', 'money', 'serious', 22, 'en',
    /\b(?:pay|transfer|deposit|remit|send)\b[^.!?\n]{0,35}?(?:\brs\.?\s?\d|₹\s?\d|\binr\s?\d|\$\s?\d|\brupees\b|\bmoney\b|\bfees?\b|\bcharges?\b|\bfine\b|\bpenalty\b|\[UPI_ID\]|\bverification account\b)/gi,
    'Asks you to pay or transfer money — verify through the official app before paying anyone.', true),
  R('money_request', 'money', 'serious', 22, 'kanglish',
    /\b(?:pay\s?maadi|pay\s?madi|duddu\s?(?:kalsi|kalisi|haaki|haki)|amount\s?(?:kalsi|kalisi|haaki|haki)|transfer\s?maadi|transfer\s?madi)\b/gi,
    'Asks you to pay money (Kanglish) — verify through the official app before paying anyone.', true),
  R('money_request', 'money', 'serious', 22, 'kn',
    /(?:ಶುಲ್ಕ(?:ವನ್ನು)?\s?ಪಾವತಿಸಿ|ಹಣ(?:ವನ್ನು)?\s?(?:ಕಳುಹಿಸಿ|ವರ್ಗಾಯಿಸಿ|ಪಾವತಿಸಿ)|ದಂಡ(?:ವನ್ನು)?\s?ಪಾವತಿಸಿ)/gu,
    'Asks you to pay money (Kannada) — verify through the official app before paying anyone.', true),

  // ── too good to be true ───────────────────────────────────────────────────
  R('too_good', 'other', 'weak', 10, 'en',
    /\b(?:congratulations|you(?:'ve| have)? won|you'?re a winner|lottery|lucky draw|jackpot|cashback|reward(?: points)?|prize|(?:you (?:are|have been) )?selected for|work[- ]from[- ]home|earn rs|guaranteed returns?|(?:free )?gift (?:voucher|card)|bonus (?:cash|payout)|crypto giveaway|giveaway)\b/gi,
    'Too-good-to-be-true offers (prizes, rewards, easy jobs) are a classic scam hook.'),
  R('too_good', 'other', 'weak', 10, 'kn',
    /(?:ಅಭಿನಂದನೆಗಳು|ಬಹುಮಾನ|ಲಾಟರಿ|ಕ್ಯಾಶ್‌?ಬ್ಯಾಕ್)/gu,
    'Too-good-to-be-true offer (Kannada) — a classic scam hook.'),
  // ── Hindi (Devanagari) + Hinglish ─────────────────────────────────────────
  R('otp_request', 'credential', 'serious', 35, 'hi',
    /(?:ओटीपी|OTP|पिन|PIN|पासवर्ड|सीवीवी|CVV)[^।.!?\n]{0,35}?(?:बताएं|बताएँ|बताइए|बताओ|भेजें|भेजिए|भेजो|शेयर करें|शेयर करो|साझा करें|डालें|डालिए|दर्ज करें|दें|दीजिए|दो)/gu,
    'Asks you to share your OTP/PIN (Hindi) — real organisations never ask for these.', true),
  R('otp_request', 'credential', 'serious', 35, 'hinglish',
    /\b(?:otp|pin|password)\b[^.!?\n]{0,25}?\b(?:batao|bataye|bataiye|batayein|bhejo|bhejiye|bheje|share\s?karo|share\s?karein|share\s?kare|de\s?do|dijiye)\b/gi,
    'Asks you to tell or send your OTP/PIN (Hinglish) — never share these with anyone.', true),
  R('kyc_update', 'credential', 'weak', 12, 'hi',
    /(?:केवाईसी|KYC|पैन|आधार)\s?(?:अपडेट|सत्यापन|लंबित|समाप्त|अधूरा)/gu,
    'Asks you to update KYC/PAN/Aadhaar (Hindi) — banks never do this through a message.'),
  R('urgency', 'urgency', 'weak', 10, 'hi',
    /(?:तुरंत|तत्काल|फौरन|फ़ौरन|आज ही|24 घंटे में|जल्द से जल्द)/gu,
    'Rushes you ("तुरंत" = immediately) so you act before you think.'),
  R('urgency', 'urgency', 'weak', 10, 'hinglish',
    /\b(?:turant|turent|fauran|jaldi\s?se\s?jaldi|aaj\s?hi)\b/gi,
    'Rushes you ("turant", "aaj hi") so you act before you think.'),
  R('threat', 'threat', 'weak', 12, 'hi',
    /(?:खाता\s?(?:बंद|ब्लॉक|निलंबित)|ब्लॉक कर दिया जाएगा|बंद कर दिया जाएगा|बंद हो जाएगा|ब्लॉक हो जाएगा|काट दी जाएगी|कट जाएगी|निलंबित|कानूनी कार्रवाई)/gu,
    'Threatens that your account or service will be blocked or cut (Hindi) to scare you.'),
  R('threat', 'threat', 'weak', 12, 'hinglish',
    /\b(?:khata\s?band|account\s?band|block\s?ho\s?jayega|band\s?ho\s?jayega|kat\s?jayegi|cut\s?ho\s?jayegi|band\s?kar\s?diya\s?jayega)\b/gi,
    'Threatens a block or cut (Hinglish) to scare you.'),
  R('digital_arrest', 'threat', 'serious', 30, 'hi',
    /(?:डिजिटल अरेस्ट|गिरफ्तार|गिरफ़्तार|गिरफ्तारी वारंट)/gu,
    'Threatens arrest (Hindi) — real police never do this over a call or message.'),
  R('digital_arrest', 'threat', 'serious', 30, 'hinglish',
    /\b(?:giraftar|giraftaar|arrest\s?ho\s?jaoge|arrest\s?kar\s?liya\s?jayega)\b/gi,
    'Threatens arrest (Hinglish) — real police never do this over a message.'),
  R('money_request', 'money', 'serious', 22, 'hi',
    /(?:भुगतान करें|भुगतान करो|पेमेंट करें|शुल्क\s?(?:जमा|भुगतान|भरें)|पैसे\s?(?:भेजें|भेजो|ट्रांसफर)|रुपये\s?(?:भेजें|जमा करें)|जुर्माना\s?(?:भरें|जमा))/gu,
    'Asks you to pay money (Hindi) — verify through the official app before paying anyone.', true),
  R('money_request', 'money', 'serious', 22, 'hinglish',
    /\b(?:pay\s?karo|pay\s?karein|pay\s?kare|paise\s?bhejo|paisa\s?bhejo|payment\s?karo|transfer\s?karo|fees?\s?bharo)\b/gi,
    'Asks you to pay money (Hinglish) — verify through the official app before paying anyone.', true),
  R('too_good', 'other', 'weak', 10, 'hi',
    /(?:बधाई हो|इनाम|लॉटरी|कैशबैक|जीत लिया|जीते हैं|उपहार)/gu,
    'Too-good-to-be-true offer (Hindi) — a classic scam hook.'),
  R('too_good', 'other', 'weak', 10, 'hinglish',
    /\b(?:inaam|inam|jeet\s?gaye|lottery\s?lagi|badhai\s?ho)\b/gi,
    'Too-good-to-be-true offer (Hinglish) — a classic scam hook.'),
  R('refund_bait', 'other', 'weak', 10, 'hi',
    /(?:रिफंड|धनवापसी)/gu,
    'Promises a refund (Hindi) — refunds go back automatically; nobody needs your details or a fee.'),

  // ── curiosity / "is this you?" bait, legal threats, identity "verification" ──
  R('clickbait', 'other', 'weak', 10, 'en',
    /\b(?:is this you\??|(?:uploaded|posted|leaked) (?:a )?(?:hidden|private|secret|intimate) (?:video|photo)s? of you|who(?:'s| is) (?:looking at|viewing|checking) your (?:private )?profile|uncover the secret|see the reveal|secret reveal|invite-only event)/gi,
    'Curiosity bait ("is this you?", "a hidden video of you") — made to make you click before you think.'),
  R('legal_threat', 'threat', 'serious', 25, 'en',
    /\b(?:you (?:are|have been) summoned|summons? for (?:a )?court|court (?:violation|summons|notice)|(?:legal|arrest) warrant|prevent (?:a|an|the) (?:arrest )?warrant|illegal activity (?:linked to|on|from) your|tax (?:fraud|evasion) case)\b/gi,
    'Threatens court, a warrant or illegal-activity charges — real authorities never send these by text with a link.'),
  // Fake invoice / renewal + "call this number to cancel": the tech-support refund trick. Needs a
  // purchase word AND a number in the message, so "Not you? Call the number on your card" stays clean.
  R('callback_scam', 'money', 'serious', 25, 'en',
    /\b(?:invoice|billing|subscription|renewal|auto-?renew(?:al|ed)?|order)\b[^\n]{0,120}?\b(?:if (?:this was )?(?:not you|unauthori[sz]ed|not authori[sz]ed)|to cancel|to dispute|for (?:a )?refund)\b[^\n]{0,40}?\bcall\b[^\n]{0,15}?(?:\[PHONE\]|\+?\d[\d\s().-]{8,}\d)/gi,
    'A "billing confirmation" you don\'t recognise with a number to call — the fake-invoice trick. Real companies point you to their app or the number on your card.'),
  R('job_lure', 'other', 'weak', 8, 'en',
    /\b(?:internship|job offer|placement|hiring|certification program|work from home)\b[^\n]{0,100}?\b(?:register|apply|enrol|enroll|closes|limited seats)\b/gi,
    'A job or internship offer pushing you to register through a link — fake offers often charge a "registration fee".'),
  R('identity_verify', 'credential', 'weak', 12, 'en',
    /\b(?:verify|confirm|re-?validate) your (?:identity|account|banking details|details)|unlock your (?:restricted )?(?:account|profile)|(?:immediate )?identity (?:review|verification)\b/gi,
    'Asks you to "verify your identity" or unlock an account through a message — that is how login details get stolen.'),

  // ── refund bait + generic greeting (all languages) ────────────────────────
  R('refund_bait', 'other', 'weak', 10, 'en',
    /\b(?:refund (?:of (?:rs|inr|\$|₹)|approved|is pending|initiated|amount|request)|claim (?:your )?refund|refund (?:will be )?(?:credited|processed)|(?:unclaimed|pending|eligible for (?:an? )?(?:unclaimed |tax )?)(?:tax )?refunds?|tax rebate)/gi,
    'Promises a refund — real refunds go back automatically; nobody needs your details or a fee to send one.'),
  R('generic_greeting', 'other', 'weak', 5, 'en',
    /\bdear (?:customer|user|sir\/madam|account ?holder|valued customer|card ?holder|consumer|beneficiary)\b/gi,
    'Uses a generic greeting instead of your name — common in mass scam messages (but also in some real ones).'),
  R('generic_greeting', 'other', 'weak', 5, 'hi',
    /(?:प्रिय ग्राहक|प्रिय उपभोक्ता|प्रिय खाताधारक)/gu,
    'Uses a generic greeting ("प्रिय ग्राहक") instead of your name — common in mass scam messages.'),
  R('generic_greeting', 'other', 'weak', 5, 'kn',
    /(?:ಆತ್ಮೀಯ ಗ್ರಾಹಕರೇ|ಪ್ರಿಯ ಗ್ರಾಹಕರೇ)/gu,
    'Uses a generic greeting ("ಆತ್ಮೀಯ ಗ್ರಾಹಕರೇ") instead of your name — common in mass scam messages.'),
];

// ── links (text only — NEVER fetched) ─────────────────────────────────────────
const TLDS = 'com|in|net|org|info|io|co|me|ly|xyz|top|click|link|site|online|live|app|biz|shop|store|buzz|icu|rest|cc|tk|ml|ga|cf|gq|pw|vip|win|loan|work|support|services|bank|gov|edu|ac|sbi|gl|gd|at|to|ws|us|uk|party|cfd|sbs|cyou';
const URL_RE = new RegExp(
  `https?:\\/\\/[^\\s<>"'\\u0C80-\\u0CFF\\u0900-\\u097F]+|(?<![\\w@.\\-/])(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?![a-z0-9-])(?:[:/?#][^\\s<>"'\\u0C80-\\u0CFF\\u0900-\\u097F]*)?`,
  'gi',
);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'goo.gl', 'rb.gy', 'shorturl.at', 'tiny.cc', 'ow.ly', 's.id', 'v.gd', 'rebrand.ly', 't.ly', 'bitly.com']);
const RISKY_TLDS = new Set(['xyz', 'top', 'click', 'link', 'site', 'online', 'live', 'buzz', 'icu', 'rest', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'vip', 'win', 'loan', 'work', 'support', 'shop', 'party', 'cfd', 'sbs', 'cyou']);
const BRANDS = [
  ['sbi', 'SBI', ['sbi.co.in', 'onlinesbi.sbi', 'sbi.bank.in', 'sbicard.com']],
  ['hdfc', 'HDFC Bank', ['hdfcbank.com', 'hdfc.bank.in']],
  ['icici', 'ICICI Bank', ['icicibank.com', 'icici.bank.in']],
  ['axisbank', 'Axis Bank', ['axisbank.com', 'axis.bank.in']],
  ['kotak', 'Kotak', ['kotak.com', 'kotak.bank.in']],
  ['bescom', 'BESCOM', ['bescom.karnataka.gov.in', 'bescom.co.in']],
  ['indiapost', 'India Post', ['indiapost.gov.in']],
  ['bluedart', 'Blue Dart', ['bluedart.com']],
  ['delhivery', 'Delhivery', ['delhivery.com']],
  ['amazon', 'Amazon', ['amazon.in', 'amazon.com']],
  ['flipkart', 'Flipkart', ['flipkart.com']],
  ['paytm', 'Paytm', ['paytm.com']],
  ['phonepe', 'PhonePe', ['phonepe.com']],
  ['incometax', 'Income Tax Dept', ['incometax.gov.in']],
  ['uidai', 'UIDAI', ['uidai.gov.in']],
  ['aadhaar', 'UIDAI', ['uidai.gov.in']],
  ['kyc', 'a bank', []],
];

const isOfficial = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));

function hostOf(url) {
  const h = url.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function checkLink(url) {
  const host = hostOf(url);
  const tld = host.split('.').pop();
  const reasons = [];
  let danger = false;
  let susp = false;
  if (SHORTENERS.has(host)) {
    susp = true;
    reasons.push('Shortened link — it hides the real website');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    danger = true;
    reasons.push('Uses a raw IP address instead of a website name');
  }
  if (host.includes('xn--')) {
    danger = true;
    reasons.push('Uses look-alike characters (punycode)');
  }
  if (RISKY_TLDS.has(tld)) {
    danger = true;
    reasons.push(`Uses a cheap ".${tld}" domain often used by scammers`);
  }
  const brand = BRANDS.find(([key, , domains]) => host.replace(/-/g, '').includes(key) && !isOfficial(host, domains));
  if (brand) {
    danger = true;
    reasons.push(brand[0] === 'kyc' ? 'Website name is built to look like a bank/KYC page' : `Uses "${brand[1]}" in the address but is not ${brand[1]}'s official website`);
  }
  if (!danger && !susp && (/(?:login|verify|kyc|update|secure|account|reward|refund)/.test(host) || (host.match(/-/g) || []).length >= 3)) {
    susp = true;
    reasons.push('Website name uses words scammers like (login, verify, update…)');
  }
  if (/^http:\/\//i.test(url) && (danger || susp)) reasons.push('Not secure (http, not https)');
  return { verdict: danger ? 'dangerous' : susp ? 'suspicious' : 'ok', reasons };
}

const ORG_WORDS = /\b(?:bank|sbi|hdfc|icici|axis|kotak|kyc|a\/c|account|bescom|electricity|india post|courier|parcel|amazon|flipkart|paytm|phonepe|income tax|aadhaa?r|police|cbi|customs|bijli|light bill)\b|ಬ್ಯಾಂಕ್|ಖಾತೆ|ಬೆಸ್ಕಾಂ|ವಿದ್ಯುತ್|बैंक|खाता|बिजली|पार्सल|पुलिस|आयकर/i;

/** STUB detect() — same signature P2's engine must implement. */
export function detect({ text, senderInfo, replyToInfo, subject } = {}) {
  const t = typeof text === 'string' ? text : '';
  const signals = [];
  const links = [];

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of t.matchAll(rule.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (rule.negatable) {
        if (NEGATION_BEFORE.test(t.slice(Math.max(0, start - 30), start))) continue;
        if (NEGATION_AFTER.test(t.slice(end, end + 12))) continue;
        if ((rule.lang === 'hi' || rule.lang === 'hinglish') && NEGATION_INSIDE.test(m[0])) continue;
      }
      signals.push({ id: rule.id, category: rule.category, strength: rule.strength, weight: rule.weight, start, end, evidence: m[0], explanation: rule.explanation, lang: rule.lang });
    }
  }

  URL_RE.lastIndex = 0;
  const urlSpans = [...t.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length]);
  // Words inside a URL ("sbi-kyc-verify.xyz") are judged by the link checks, not the text rules.
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i];
    if (urlSpans.some(([a, b]) => s.start >= a && s.end <= b)) signals.splice(i, 1);
  }

  URL_RE.lastIndex = 0;
  for (const m of t.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]'"]+$/, '');
    const start = m.index;
    const end = start + url.length;
    const { verdict, reasons } = checkLink(url);
    links.push({ url, start, end, verdict, reasons });
    if (verdict === 'dangerous') {
      signals.push({ id: 'dangerous_link', category: 'link', strength: 'serious', weight: 30, start, end, evidence: url, explanation: `Dangerous link: ${reasons[0].toLowerCase()}.`, lang: 'en' });
    } else if (verdict === 'suspicious') {
      signals.push({ id: 'suspicious_link', category: 'link', strength: 'weak', weight: 15, start, end, evidence: url, explanation: `Suspicious link: ${reasons[0].toLowerCase()}.`, lang: 'en' });
    }
  }

  // A lure plus a link that hides where it goes is the classic click-to-steal pattern: each is
  // weak on its own, together they are serious. Lures: a prize/refund/"is this you?" bait, or a
  // scare ("account locked") / "verify your account" request.
  const BAIT = new Set(['too_good', 'refund_bait', 'clickbait', 'job_lure']);
  const SCARE = new Set(['threat', 'identity_verify', 'kyc_update']);
  const lure = signals.find((s) => BAIT.has(s.id)) || signals.find((s) => SCARE.has(s.id));
  const badLink = links.find((l) => l.verdict !== 'ok');
  if (lure && badLink) {
    signals.push({
      id: 'bait_link', category: 'link', strength: 'serious', weight: 20, start: badLink.start, end: badLink.end, evidence: badLink.url,
      explanation: BAIT.has(lure.id)
        ? 'Pairs a prize, refund or "secret" bait with a link that hides where it really goes — the classic way to steal details or money.'
        : 'Pairs a scare or a "verify your account" request with a link that hides where it really goes — the classic way to steal logins.',
      lang: 'en',
    });
  }

  // Free form / page builders (Google Forms, Sites, MS Forms…) are fine for a college fest, but
  // never where a bank, courier or tax office asks you to secure an account, pay or claim money.
  const FORM_HOSTS = /^(?:forms\.gle|docs\.google\.com\/forms|forms\.google\.com|sites\.google\.com|forms\.office\.com|forms\.microsoft\.com|form\.jotform\.com|[a-z0-9-]+\.typeform\.com)/i;
  const formLink = links.find((l) => FORM_HOSTS.test(l.url.replace(/^https?:\/\/(?:www\.)?/i, '')));
  const pressure =
    signals.some((s) => ['threat', 'credential', 'money'].includes(s.category) || s.id === 'refund_bait') ||
    (signals.some((s) => s.id === 'too_good') && /\b(?:claim|redeem|withdraw|collect)\b/i.test(t));
  if (formLink && pressure && !signals.some((s) => s.id === 'bait_link' && s.start === formLink.start)) {
    signals.push({
      id: 'form_link', category: 'link', strength: 'serious', weight: 22, start: formLink.start, end: formLink.end, evidence: formLink.url,
      explanation: 'Sends you to a free online form to secure an account, pay or claim money — anyone can make one, and real organisations never use them for this.', lang: 'en',
    });
  }

  const mentionsOrg = ORG_WORDS.test(t) || ORG_WORDS.test(subject || '');
  const kind = senderInfo?.kind;
  if (mentionsOrg && (kind === 'mobile' || kind === 'intl' || kind === 'landline')) {
    signals.push({
      id: 'bank_from_mobile', category: 'sender', strength: 'weak', weight: 18, start: null, end: null, evidence: '[PHONE]',
      explanation: kind === 'intl'
        ? 'Claims to be an Indian bank/company but was sent from a foreign phone number.'
        : 'Claims to be a bank/company but was sent from a normal 10-digit mobile number. Real ones use registered sender IDs like "VM-SBIINB".',
      lang: 'en',
    });
  }
  if (mentionsOrg && kind === 'email' && senderInfo.freemail) {
    signals.push({ id: 'brand_from_freemail', category: 'sender', strength: 'weak', weight: 18, start: null, end: null, evidence: senderInfo.domain, explanation: `Claims to be an organisation but was sent from a free ${senderInfo.domain} address.`, lang: 'en' });
  }
  if (kind === 'email' && replyToInfo?.domain && senderInfo.domain && replyToInfo.domain !== senderInfo.domain) {
    signals.push({ id: 'reply_to_mismatch', category: 'sender', strength: 'weak', weight: 12, start: null, end: null, evidence: replyToInfo.domain, explanation: `Replies go to a different address (${replyToInfo.domain}) than the sender (${senderInfo.domain}).`, lang: 'en' });
  }

  return { signals, links };
}
