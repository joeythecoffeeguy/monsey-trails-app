import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();
export type PassengerLanguage = "en" | "yi" | "he";
const REVIEW_AGE_DAYS = 90;
const CHECK_COOLDOWN_MS = 5 * 60 * 1_000;
const STAFF_COOKIE = "passenger_info_staff";
const STAFF_SESSION_MS = 8 * 60 * 60 * 1_000;
let lastWebsiteCheckStartedAt = 0;

export function claimWebsiteCheck(now = Date.now()) {
  if (now - lastWebsiteCheckStartedAt < CHECK_COOLDOWN_MS) return false;
  lastWebsiteCheckStartedAt = now;
  return true;
}

export function canonicalizeSourceHtml(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function fingerprintSourcePages(htmlPages: string[]) {
  return createHash("sha256")
    .update(htmlPages.map(canonicalizeSourceHtml).join("\n"))
    .digest("hex");
}
const SOURCE_URLS = [
  "https://monseytrails.com/",
  "https://monseytrails.com/rates",
  "https://monseytrails.com/information",
  "https://monseytrails.com/contact/",
];

export interface PassengerInfoContent {
  destinations: Array<{ title: string; text: string }>;
  fares: Array<{ title: string; text: string }>;
  guide: Array<{ title: string; text: string }>;
  contact: Array<{ title: string; text: string }>;
}
export type LocalizedPassengerInfoContent = Record<PassengerLanguage, PassengerInfoContent>;

export const DEFAULT_PASSENGER_INFO: PassengerInfoContent = {
  destinations: [
    { title: "Monsey & New Square", text: "Multiple daily routes connect Monsey with Boro Park, Williamsburg, and Manhattan." },
    { title: "Manhattan & Wall Street", text: "Manhattan service begins at 576 Fifth Avenue, with additional Midtown pickup points." },
    { title: "Boro Park", text: "Service begins at 18th Avenue & 50th Street and continues along the published route." },
    { title: "Williamsburg", text: "Service begins on Bedford Avenue between Hewes & Hooper and continues along Bedford Avenue." },
    { title: "Other regional service", text: "The website also links passengers to Lakewood Express and Monsey Tours charter service." },
    { title: "Baltimore notice", text: "Monsey Trails currently states that there is no bus service to or from Baltimore." },
  ],
  fares: [
    { title: "Published one-way fares", text: "Manhattan $17 • Williamsburg / Boro Park $20 • Kiryas Joel $15 • Lakewood $30" },
    { title: "Buying tickets", text: "Buy at the Spring Valley office or from the driver when available. Payment is accepted by cash or check. Returned checks carry a $15 fee." },
    { title: "Ticket rules", text: "Ten-trip books may be shared with family and do not expire. Forty-trip commuter books are for one person and expire after two calendar months. Detached tickets are void." },
    { title: "Refunds", text: "Commuter books, ten-trip books, and cash fares are non-refundable. Lost or stolen booklets are not refunded." },
  ],
  guide: [
    { title: "Children", text: "Under age 2 ride free without a seat. Ages 2–9 pay $12. Under age 10 must travel with someone age 15 or older. Ages 10–14 may travel alone only on the same schedule with an adult waiting at the destination. Car seats are not permitted." },
    { title: "Baggage", text: "Two luggage-compartment pieces and one personal item travel free. Extra pieces may cost $10 each during peak periods, if space is available. Baggage travels at the passenger’s risk." },
    { title: "Seating & operations", text: "Operating conditions may require a transfer to another coach or a route change. If a trip lacks seating capacity, passengers may be placed on the next available coach." },
    { title: "Lost & found", text: "Call 845-510-5100, extension 140, and follow the instructions. You can also submit a lost-item inquiry through monseytrails.com." },
  ],
  contact: [
    { title: "Call", text: "845-510-5100 • 718-972-5578 • Lost & Found: extension 140" },
    { title: "Headquarters", text: "8 Washington Avenue, Spring Valley, NY 10977" },
    { title: "Email dispatch", text: "dispatch@monseytrails.com" },
    { title: "Online help", text: "Visit monseytrails.com/contact for customer service, feedback, safety issues, refunds, charter service, or a lost-item inquiry." },
  ],
};

export const DEFAULT_LOCALIZED_PASSENGER_INFO: LocalizedPassengerInfoContent = {
  en: DEFAULT_PASSENGER_INFO,
  yi: {
    destinations: [
      { title: "מונסי און ניוסקווער", text: "עטליכע טעגלעכע ליניעס פארבינדן מונסי מיט באָראָ פּאַרק, וויליאמסבורג און מאנהעטן." },
      { title: "מאנהעטן און וואל סטריט", text: "די מאנהעטן סערוויס הייבט זיך אן ביי 576 Fifth Avenue, מיט נאך אפהאלט-פלעצער אין מידטאַון." },
      { title: "באָראָ פּאַרק", text: "די סערוויס הייבט זיך אן ביי 18th Avenue & 50th Street און גייט ווייטער אויפן פארעפנטלעכטן וועג." },
      { title: "וויליאמסבורג", text: "די סערוויס הייבט זיך אן אויף Bedford Avenue צווישן Hewes & Hooper און גייט ווייטער אויף Bedford Avenue." },
      { title: "אנדערע רעגיאָנאַלע סערוויס", text: "דער וועבזייטל פארבינדט אויך פאסאזשירן מיט Lakewood Express און טשארטער-סערוויס פון Monsey Tours." },
      { title: "באלטימאר מעלדונג", text: "Monsey Trails זאגט יעצט אז עס איז נישטא קיין באס-סערוויס קיין באלטימאר אדער פון באלטימאר." },
    ],
    fares: [
      { title: "פארעפנטלעכטע איין-וועג פרייזן", text: "מאנהעטן $17 • וויליאמסבורג / באָראָ פּאַרק $20 • Kiryas Joel $15 • Lakewood $30" },
      { title: "קויפן טיקעטס", text: "קויפט אינעם Spring Valley אפיס אדער ביים דרייווער ווען עס איז פאראן. צאלונג איז מעגליך מיט געלט אדער טשעק. א צוריקגעגעבענער טשעק האט א $15 אפצאל." },
      { title: "טיקעט רעגלען", text: "צען-רייזע ביכער מעגן ווערן געטיילט מיט דער פאמיליע און לויפן נישט אויס. פערציג-רייזע קאמיוטער ביכער זענען פאר איין מענטש און לויפן אויס נאך צוויי קאלענדאר-חדשים. אפגעריסענע טיקעטס זענען בטל." },
      { title: "געלט צוריק", text: "קאמיוטער ביכער, צען-רייזע ביכער און געלט-פרייזן ווערן נישט צוריקגעצאלט. פארלוירענע אדער גע'גנב'טע ביכלעך ווערן נישט צוריקגעצאלט." },
    ],
    guide: [
      { title: "קינדער", text: "קינדער אונטער 2 פארן פריי אן א זיץ. עלטער 2–9 צאלן $12. אונטער 10 מוזן פארן מיט איינעם פון 15 אדער עלטער. עלטער 10–14 מעגן אליין פארן נאר אויפן זעלבן סקעדזשועל ווען אן ערוואקסענער ווארט ביים דעסטינאציע. קאר-זיצן זענען נישט ערלויבט." },
      { title: "באגאזש", text: "צוויי שטיק אין דעם באגאזש-קאמפארטמענט און איין פערזענליכע זאך פארן פריי. נאך שטיקער קענען קאסטן $10 יעדע אין פארנומענע צייטן אויב פלאץ איז פאראן. באגאזש פארט אויפן ריזיקא פון דעם פאסאזשיר." },
      { title: "זיצן און אפעראציעס", text: "אפעראציע באדינגונגען קענען פארלאנגען א איבערטויש צו אן אנדערן קאוטש אדער א וועג-ענדערונג. אויב א רייזע האט נישט גענוג זיצן, קענען פאסאזשירן ווערן געשטעלט אויפן נעקסטן קאוטש מיט פלאץ." },
      { title: "פארלוירענע און געפונענע", text: "רופט 845-510-5100, עקסטענשאן 140, און פאלגט די אנווייזונגען. איר קענט אויך אריינגעבן א פארלוירענע-זאך פארלאנג דורך monseytrails.com." },
    ],
    contact: [
      { title: "רופט", text: "845-510-5100 • 718-972-5578 • פארלוירענע און געפונענע: עקסטענשאן 140" },
      { title: "הויפטקווארטיר", text: "8 Washington Avenue, Spring Valley, NY 10977" },
      { title: "דיספעטש אימעיל", text: "dispatch@monseytrails.com" },
      { title: "הילף אנליין", text: "באזוכט monseytrails.com/contact פאר קאסטומער סערוויס, פידבעק, זיכערהייט פראגעס, געלט צוריק, טשארטער-סערוויס אדער א פארלוירענע-זאך פארלאנג." },
    ],
  },
  he: {
    destinations: [
      { title: "מונסי וניו סקוור", text: "מספר קווים יומיים מחברים את מונסי עם בורו פארק, ויליאמסבורג ומנהטן." },
      { title: "מנהטן ו-Wall Street", text: "השירות למנהטן מתחיל ב-576 Fifth Avenue, עם תחנות איסוף נוספות במידטאון." },
      { title: "בורו פארק", text: "השירות מתחיל ב-18th Avenue & 50th Street וממשיך לאורך המסלול שפורסם." },
      { title: "ויליאמסבורג", text: "השירות מתחיל ב-Bedford Avenue בין Hewes & Hooper וממשיך לאורך Bedford Avenue." },
      { title: "שירות אזורי נוסף", text: "האתר מקשר גם לשירות Lakewood Express ולשירותי ההסעות של Monsey Tours." },
      { title: "הודעה על בולטימור", text: "Monsey Trails מציינת כעת שאין שירות אוטובוסים אל בולטימור או ממנה." },
    ],
    fares: [
      { title: "תעריפי נסיעה חד-כיוונית שפורסמו", text: "מנהטן $17 • ויליאמסבורג / בורו פארק $20 • Kiryas Joel $15 • Lakewood $30" },
      { title: "רכישת כרטיסים", text: "רכשו במשרד Spring Valley או מהנהג כאשר הדבר אפשרי. התשלום מתקבל במזומן או בצ׳ק. צ׳ק חוזר כרוך בעמלה של $15." },
      { title: "כללי כרטיסים", text: "ספרי עשר נסיעות ניתנים לשיתוף עם המשפחה ואינם פוקעים. ספרי ארבעים נסיעות מיועדים לאדם אחד ופוקעים לאחר שני חודשים קלנדריים. כרטיסים שנקרעו אינם תקפים." },
      { title: "החזרים", text: "ספרי נסיעות, ספרי עשר נסיעות ותעריפי מזומן אינם ניתנים להחזר. חוברות שאבדו או נגנבו אינן מוחזרות." },
    ],
    guide: [
      { title: "ילדים", text: "ילדים מתחת לגיל 2 נוסעים בחינם ללא מושב. גילאי 2–9 משלמים $12. מתחת לגיל 10 חייבים לנסוע עם אדם בן 15 ומעלה. גילאי 10–14 רשאים לנסוע לבד רק באותו לוח זמנים כאשר מבוגר ממתין ביעד. אסור להשתמש במושבי רכב." },
      { title: "מטען", text: "שני פריטי מטען בתא המטען ופריט אישי אחד נוסעים בחינם. פריטים נוספים עשויים לעלות $10 כל אחד בשעות עומס, אם יש מקום. המטען נוסע באחריות הנוסע." },
      { title: "מושבים ותפעול", text: "תנאי ההפעלה עשויים לחייב מעבר לאוטובוס אחר או שינוי מסלול. אם אין מספיק מושבים, הנוסעים עשויים לעבור לאוטובוס הזמין הבא." },
      { title: "אבידות ומציאות", text: "חייגו 845-510-5100, שלוחה 140, ופעלו לפי ההוראות. ניתן גם לשלוח פנייה על חפץ שאבד דרך monseytrails.com." },
    ],
    contact: [
      { title: "טלפון", text: "845-510-5100 • 718-972-5578 • אבידות ומציאות: שלוחה 140" },
      { title: "מטה החברה", text: "8 Washington Avenue, Spring Valley, NY 10977" },
      { title: "אימייל לשיגור", text: "dispatch@monseytrails.com" },
      { title: "עזרה מקוונת", text: "בקרו ב-monseytrails.com/contact לשירות לקוחות, משוב, בעיות בטיחות, החזרים, שירותי הסעות או פנייה על חפץ שאבד." },
    ],
  },
};

export function normalizeContent(value: unknown): LocalizedPassengerInfoContent {
  if (validContent(value)) {
    const isBundled = JSON.stringify(value) === JSON.stringify(DEFAULT_PASSENGER_INFO);
    return isBundled
      ? { en: value, yi: DEFAULT_LOCALIZED_PASSENGER_INFO.yi, he: DEFAULT_LOCALIZED_PASSENGER_INFO.he }
      : { en: value, yi: value, he: value };
  }
  const record = value as Record<string, unknown> | null;
  return {
    en: validContent(record?.en) ? record.en : DEFAULT_PASSENGER_INFO,
    yi: validContent(record?.yi) ? record.yi : DEFAULT_LOCALIZED_PASSENGER_INFO.yi,
    he: validContent(record?.he) ? record.he : DEFAULT_LOCALIZED_PASSENGER_INFO.he,
  };
}
function validLocalizedContent(value: unknown): value is LocalizedPassengerInfoContent {
  return Boolean(value && typeof value === "object"
    && ["en", "yi", "he"].every((language) => validContent((value as Record<string, unknown>)[language])));
}

function validContent(value: unknown): value is PassengerInfoContent {
  if (!value || typeof value !== "object") return false;
  return ["destinations", "fares", "guide", "contact"].every((section) => {
    const cards = (value as Record<string, unknown>)[section];
    return Array.isArray(cards) && cards.length >= 1 && cards.length <= 10 && cards.every((card) =>
      card && typeof card === "object"
      && typeof (card as { title?: unknown }).title === "string"
      && (card as { title: string }).title.trim().length > 0
      && (card as { title: string }).title.length <= 100
      && typeof (card as { text?: unknown }).text === "string"
      && (card as { text: string }).text.trim().length > 0
      && (card as { text: string }).text.length <= 800);
  });
}

async function ensureStore() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passenger_info (
      id text PRIMARY KEY,
      content jsonb NOT NULL,
      reviewed_at timestamptz NOT NULL,
      source_fingerprint text,
      detected_fingerprint text,
      checked_at timestamptz
    )
  `);
  await pool.query(
    `INSERT INTO passenger_info (id, content, reviewed_at)
     VALUES ('current', $1::jsonb, $2) ON CONFLICT (id) DO NOTHING`,
     [JSON.stringify(DEFAULT_LOCALIZED_PASSENGER_INFO), "2026-09-16T00:00:00.000Z"],
  );
}

async function getRecord() {
  await ensureStore();
  const { rows } = await pool.query<{
    content: PassengerInfoContent;
    reviewed_at: Date;
    source_fingerprint: string | null;
    detected_fingerprint: string | null;
    checked_at: Date | null;
  }>("SELECT * FROM passenger_info WHERE id = 'current'");
  const row = rows[0];
  const ageDays = Math.floor((Date.now() - row.reviewed_at.getTime()) / 86_400_000);
  return {
    content: normalizeContent(row.content),
    reviewedAt: row.reviewed_at.toISOString(),
    checkedAt: row.checked_at?.toISOString() ?? null,
    stale: ageDays > REVIEW_AGE_DAYS,
    ageDays,
    changesDetected: Boolean(row.detected_fingerprint && row.detected_fingerprint !== row.source_fingerprint),
    sourceUrls: SOURCE_URLS,
  };
}

function signStaffExpiry(expiresAt: number) {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", secret).update(`passenger-info-admin:${expiresAt}`).digest("hex");
}

export function issueStaffToken(now = Date.now()) {
  const expiresAt = now + STAFF_SESSION_MS;
  return `${expiresAt}.${signStaffExpiry(expiresAt)}`;
}

export function verifyStaffToken(token: string, now = Date.now()) {
  const [rawExpiry, suppliedSignature, extra] = token.split(".");
  const expiresAt = Number(rawExpiry);
  if (extra !== undefined || !Number.isFinite(expiresAt) || expiresAt <= now || !suppliedSignature) return false;
  const expectedSignature = signStaffExpiry(expiresAt);
  if (!process.env.SESSION_SECRET || suppliedSignature.length !== expectedSignature.length) return false;
  return timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature));
}

function cookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1] ?? "";
}

function isStaffRequest(req: { headers: { cookie?: string } }) {
  return verifyStaffToken(cookieValue(req.headers.cookie, STAFF_COOKIE));
}

function requireStaff(req: Parameters<typeof isStaffRequest>[0], res: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (isStaffRequest(req)) return true;
  res.status(401).json({ error: "Staff authorization is required." });
  return false;
}

router.get("/passenger-info", async (req, res): Promise<void> => {
  res.json({ ...await getRecord(), canManage: isStaffRequest(req) });
});

router.post("/passenger-info/session", (req, res): void => {
  const secret = process.env.PASSENGER_INFO_ADMIN_KEY ?? "";
  const supplied = typeof req.body?.key === "string" ? req.body.key : "";
  const authorized = secret.length > 0
    && supplied.length === secret.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
  if (!authorized) {
    res.status(401).json({ error: "The staff review key is incorrect." });
    return;
  }
  res.cookie(STAFF_COOKIE, issueStaffToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: STAFF_SESSION_MS,
    path: "/api/passenger-info",
  });
  res.status(204).end();
});

router.post("/passenger-info/check", async (req, res): Promise<void> => {
  if (!requireStaff(req, res)) return;
  if (!claimWebsiteCheck()) {
    res.status(429).json({ error: "The official website was checked recently. Try again in a few minutes." });
    return;
  }
  try {
    const pages = await Promise.all(SOURCE_URLS.map(async (url) => {
      const response = await fetch(url, {
        headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 passenger information review" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.text();
    }));
    const fingerprint = fingerprintSourcePages(pages);
    await ensureStore();
    await pool.query(
      "UPDATE passenger_info SET detected_fingerprint = $1, checked_at = NOW() WHERE id = 'current'",
      [fingerprint],
    );
    res.json(await getRecord());
  } catch (error) {
    req.log.warn({ err: error }, "passenger information website check failed");
    res.status(502).json({ error: "The Monsey Trails website could not be checked right now." });
  }
});

router.put("/passenger-info", async (req, res): Promise<void> => {
  if (!requireStaff(req, res)) return;
  if (!validLocalizedContent(req.body?.content)) {
    res.status(400).json({ error: "Passenger information must include valid destinations, fares, guide, and contact cards." });
    return;
  }
  await ensureStore();
  await pool.query(
    `UPDATE passenger_info
     SET content = $1::jsonb, reviewed_at = NOW(),
         source_fingerprint = COALESCE(detected_fingerprint, source_fingerprint)
     WHERE id = 'current'`,
    [JSON.stringify(req.body.content)],
  );
  res.json(await getRecord());
});

export default router;