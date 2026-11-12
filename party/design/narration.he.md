# The hosts narrating the show: the script

The two party hosts, as toy figurines in a pose, pop in on the TV at the big moments of the show with a
speech bubble, like two TV-show hosts. Pictures and text only: no audio of any kind.

- **Data the code reads:** `client/src/host/show/narration.ts` (`NARRATION`). Change this file and that one
  together; `tests/unit/narration.test.ts` checks the script's shape (count, length, pairs, exclamations).
- **The pictures:** `client/public/assets/hosts/poses/<a|b>_<pose>.webp`, see the hosts README.
- **Host A** is the man in the lemon hat (lines in the masculine), **host B** the woman with the bangs
  (lines in the feminine).
- **Voice:** `punchlines.he.md` and `humor-research.md`, the הפשוטע register: two stars delighted with
  themselves and with the show, a grand frame on a small local thing, one image per line, a local proper
  noun as the punch, never bitter, never at a guest's expense, nothing gross. The owner's exclamations:
  נודר, צדיק!, בן פורת יוסף!, וואו!, מחורחר!, אחשילי. **Less צדיק** (the owner, 2026-11-12): it stays only
  on the champion and in the doll's one-word reactions; elsewhere אש!, כפרה!, שיא!, מטורף!.
- **No guest name inside a line** of this script. Where it reads well the TV shows the name as a blue tag on
  the bubble (the first guests: whoever came in last; the champion). The exception is the round's banter
  (below): there the names are the point, and they show highlighted in blue inside the line.

## How it plays on the TV

- One bubble at a time, about 3 to 4 seconds each. A **banter pair** (A sets up, B answers) shows A, then B.
- A queue with priorities (the number next to each moment, 1 to 10): a moment that is no longer true when
  its turn comes is dropped (the round already started, the reveal already passed). Each moment is said once.
- The variants of a moment rotate: every one is used before any repeats, never the same twice in a row.
- One microphone: the hosts and the live commentator (the small head with the race lines of `lines.ts`)
  never talk at once. The hosts may cut an ordinary race line short; a ceremony line of the commentator is
  never cut (the hosts wait). With the hosts on the TV, the last ten seconds, the small-room drum roll, the
  podium's opening line and the champion line are the hosts' (the commentator keeps the rest).
- Nothing while a cutscene plays, nothing on a portrait screen. **Calm mode** keeps only priority 7 and up.
- **Never over what the room is watching.** During a round the hosts stand only in the empty margin under the
  timer (measured; with no margin, nothing is said), or for the flappy finale in the side column's title
  block, which steps aside. The live commentator moved into that same margin too (small head, bubble beside
  it): before, its bubble covered the bottom rows of the race. Between rounds each screen has its own corner: the empty lobby's left, the
  intro's top-left, the results' left column, the ceremony's bottom band, the podium's left margin, the
  final table's right.

## The script (41 lines)

### The opening (7) · the TV opens on an empty lobby

| Host · pose | Line |
| --- | --- |
| A · presenting | ערב טוב, ישראל! זה פארטי ארנה. |
| B · laughing | כמו האירוויזיון, רק עם במבה. |
| *or* B · presenting | סרקו את הקוד. כרטיסים אחרונים, כמו בקיסריה. |

### The first guests (5) · tag: the guest who came in last

| A · shocked | וואו, אורחים אמיתיים! לא ניצבים. |
| --- | --- |
| *or* B · cheering | יש לנו מתמודדים! אש! |

### Each game's intro (8) · a banter pair per game

| Game | A · presenting | B |
| --- | --- | --- |
| tap | שימי טאפ: חוטטים לשימי באף, באישור משרד הבריאות. | (laughing) חצי דקה להתחיל, ומהנגיעה הראשונה עשרים שניות שלכם. |
| icy | אייסי שימי: מטפסים כמה שיותר גבוה. | (cheering) בקומה האחרונה מחכה פנטהאוז בעזריאלי. |
| flappy | פלאפי תבורי: מי שנשאר אחרון באוויר, מנצח. | (laughing) כמו טיסה לאילת, רק בלי לנחות. |
| plotzel | פלוצל: מחמוד לפלוץ, אות אחת בכל פעם. | (shocked) כל צעד מילה אמיתית. האקדמיה ללשון צופה. |
| ninja | נינג׳ה תבורי: חותכים פלאפל, סביח ובורקס. | (laughing) רק לא את הפצצות. הפצצות של הערב זה אנחנו. |

Plotzel opens with four words (חמוד, פוקי, נדיר, שימי): the line starts from חמוד. The ninja bombs are the
two hosts themselves (`bomb_hosts.png`), so the hosts make the joke about themselves.

### GO (6) · the round starts

| A · cheering | יאללה, אחשילי! מחורחר! |
| --- | --- |
| *or* B · cheering | צאו לדרך! בן פורת יוסף! |

### The last 10 seconds (7)

| A · shocked | עשר שניות! לחץ של גמר הישרדות. |
| --- | --- |
| *or* B · cheering | עשר שניות! קצב של דיג׳יי בשלוש בלילה. |

### The flappy finale (7) · with the "נשארו 3!" banner

| A · shocked | הגמר באוויר! מחורחר! |
| --- | --- |
| *or* B · suspense | רק האחרונים נשארו. אף אחד לא נושם. |

### After a cutscene (6) · the 3-2-1 back into the round

| A · presenting | חזרנו מהפרסומות! הטלפונים ביד. |
| --- | --- |
| *or* B · laughing | איפה היינו? אה כן, בחלק שבו אני מושלמת. |

### Time up (6) · the results open

| A · shocked | סוף! מניחים את הטלפונים, לאט. |
| --- | --- |
| *or* B · presenting | הזמן נגמר. ממתינים לדוז פואה מהשופטים. |

### The suspense before the round winner (7) · the drum roll

| B · suspense | ששש... אפילו אני עוד לא יודעת. נודר. |
| --- | --- |
| *or* A · suspense | אף מילה. גם לא ממני, וזה קשה לי. |

### The reveal (9) · the winner's name has landed (the name is on screen, not in the line)

| B · cheering | וואו! כמו אוסקר, רק עם כנפיים. |
| --- | --- |
| *or* A · cheering | בן פורת יוסף! המלאך עובר דירה. |
| *or* B · laughing | כפרה! המלאך כבר מחפש חניה ליד הבית. |

### The standings (5)

| A · presenting | הטבלה הכללית. ואין ירידת ליגה. |
| --- | --- |
| *or* B · presenting | והטבלה! מי למעלה, ומי בדרך למעלה. |

### The podium (8) · the drum roll before third place

| A · presenting | הפודיום של הערב! טקס של פתיחת המכביה. |
| --- | --- |
| *or* B · suspense | נשמו עמוק, כמו ביוגה בפרדס חנה. |

### The champion (9) · tag: the champion's name

| A · cheering, then B · cheering | יש לנו אלוף ערב! בן פורת יוסף! / צדיק! מחר זה בכותרת הראשית של ynet. |
| --- | --- |
| *or* B · cheering | וואו! אלוף הערב, רשמית ובחתימה של שנינו. |

### Goodbye (8) · once the final table has had a look

| A · waving | זה היה פארטי ארנה. לילה טוב, ישראל! |
| --- | --- |
| *or* B · waving | תודה שבאתם! מי שזכה, שמרו על המלאך. |

### The round's banter: fallback (4) · only when a banter cue comes without its own take

| A · cheering | איזה מרוץ! מחורחר! |
| --- | --- |
| *or* B · cheering | איזה ערב! בן פורת יוסף! |

## During a round: the banter (`client/src/host/show/banter.ts`)

The owner asked for both hosts to narrate more during the competition and to trash talk the players, in the
הפשוטע voice. So during a round the posed hosts talk the race through, **with the guests' names**:

- **What they react to:** the race moments (`show/moments.ts`: a new leader, an overtake, a big jump, a ninja
  bomb, neck and neck, last place, a comeback, still on zero, a photo finish, on fire) and, in flappy, every
  fall (the first one as such). When nothing has been said for 3 seconds, a jab at somebody: the leader, the
  middle of the table, the last place, a line about the game, or the whole room. The quiet-race jabs go
  around: whoever has been named least tonight is next, so everybody gets their turn over the evening.
- **How:** almost every take is a banter pair, one host sets it up and the other answers, starting from
  either side, so both talk about the same amount. The names show in blue inside the line. A take is
  said only while it is still true (the leader still leads, the zero is still a zero); a take that goes
  unsaid goes back to be said next time. The lines rotate across the whole evening, never twice in a row.
- **Where:** the same margin under the timer as every round line; in flappy (no margin) the side column's
  title block, which steps aside. Never over the race, the count or the timer.
- **Who wins the mic:** the banter sits under the show's own moments: GO, the last ten seconds and the flappy
  finale cut a banter take short. With the hosts on the TV the small commentator head says no race lines
  (its stickers, sounds and confetti stay). Calm mode mutes the banter (priority under 7).
- **The trash talk:** about the play only (the score, the crash, the bomb, the zero), never about looks,
  family, money or anything sad, and the hosts make fun of themselves just as much (the bombs are the
  hosts). A guest can be anyone, so a name is never the subject of a gendered verb or adjective: a noun
  ("{a} בראש"), "ל{a}" / "של {a}", or the guest addressed in the past tense, which Hebrew writes the same for
  everyone ("{a}, חתכת פצצה!"). Host A still speaks in the masculine and host B in the feminine.

The number after each kind is its priority. {a} is the guest the take is about, {b} the other one.

### lead (5) · a new leader ({a}; {b} who led before)

| Takes |
| --- |
| A · cheering: {a} בהובלה! נודר! / B · laughing: תהנו. זה כמו חניה בתל אביב: זמני. |
| B · shocked: {a} בראש? מי אישר את זה? / A · presenting: אני. תמורת קפה בארומה. |
| A · presenting: הכתר עובר ל{a}. / B · laughing: כתר מבורגר קינג. אבל עדיין כתר. |
| B · presenting: מבזק: {a} במקום הראשון. / A · shocked: ובחדשות אחרות: {b} בהלם. |
| A · laughing: {a}, הגעת לפסגה. / B · suspense: תצלמו מהר. מכאן רק יורדים. |
| B · cheering: {a} למעלה! אש! / A · laughing: {b}, זה לא אישי. זה קצת אישי. |

### overtake (4) · {a} passed {b}

| Takes |
| --- |
| A · shocked: עקיפה! {a} לפני {b}. / B · laughing: {b}, זה מה שקורה כשעוצרים לבורקס. |
| B · presenting: {b}, מישהו עקף אותך. / A · laughing: קוראים לזה {a}. תתרגלו. |
| A · cheering: עקיפה מימין של {a}! / B · suspense: לא ראיתי כלום. אני רק מנחה. |
| B · shocked: ביי ביי, {b}! / A · presenting: {a} בנתיב המהיר. באיילון זה נס. |
| A · presenting: {b}, עקפו אותך בלי לאותת. / B · laughing: תתלוננו על {a} בווייז. אף אחד לא קורא. |

### jump (4) · {a} jumped a lot of points at once

| Takes |
| --- |
| B · shocked: וואו, {a}! מאיפה הנקודות? / A · suspense: אל תשאלו. יש דברים שעדיף לא לדעת. |
| A · cheering: {a} בטורבו! / B · laughing: תבדקו שהטלפון לא מחובר לחשמל. |
| B · presenting: {a}, על מה לחצת שם? / A · shocked: זה נקרא כישרון. אני מזהה, יש לי. |
| A · shocked: {a} במעלית של עזריאלי! / B · laughing: ואנחנו במדרגות. כרגיל. |

### drop (5) · {a} lost points (a ninja bomb: the bombs are the hosts)

| Takes |
| --- |
| A · shocked: {a}, חתכת פצצה! / B · laughing: הפצצה זאת אני. נעים מאוד. |
| B · shocked: בום! הנקודות של {a} עפו. / A · presenting: הן בדרך לאילת. יחזרו ביום ראשון. |
| A · laughing: {a}, זה לא סביח. זה אני. |
| B · suspense: {a}, פגעת בי. אני סולחת. / A · laughing: היא לא סולחת. היא רושמת. |

### tie (4) · {a} and {b} neck and neck at the top

| Takes |
| --- |
| A · shocked: {a} מול {b}. ראש בראש! / B · presenting: דרבי של השכונה. אני מוכרת כרטיסים. |
| B · cheering: בין {a} ל{b} לא נכנסת פיתה. / A · laughing: אולי לאפה. קטנה. בלי חריף. |
| A · presenting: {a} ו{b} צמודים. / B · laughing: כמו בחתונמי. רק בלי החתונה. |

### last (4) · {a} in last place (also when the race is quiet)

| Takes |
| --- |
| A · presenting: {a} במקום האחרון. / B · laughing: מישהו צריך לכבות את האור בסוף. |
| B · suspense: ששש. {a} בונה מתח. / A · laughing: כבר שלוש עונות. כמו טלנובלה. |
| A · laughing: {a}, ראינו אותך. מלמטה. / B · cheering: ומשם הנוף הכי יפה. נודר. |
| B · presenting: {a}, הטלפון בכלל דולק? / A · presenting: אולי במצב טיסה. נוחת ביום שלישי. |
| A · presenting: {a} כאן בשביל הכיבוד. / B · cheering: החלטה נבונה. ראיתם את הבורקס? |

### comeback (5) · {a} from the bottom half into the top three

| Takes |
| --- |
| A · shocked: קאמבק של {a}! / B · cheering: כמו להיט מ־2005 בחתונה. כולם לרחבה. |
| B · shocked: {a}, מאיפה הגעת?! / A · laughing: מהמקום האחרון. בלי לאותת, כמובן. |
| A · presenting: {a} בצמרת! / B · laughing: בבוקר לא האמנו. גם עכשיו לא. |

### zero (4) · {a} still on zero after 15 seconds

| Takes |
| --- |
| B · shocked: {a} על אפס. / A · presenting: מינימליזם סקנדינבי. ראיתי באיקאה. |
| A · laughing: {a}, המשחק התחיל. מזמן. / B · presenting: זה בסדר. גם הטכנאי של בזק מאחר. |
| B · presenting: {a}, נגעת במסך? בכלל? / A · presenting: אני מכבד. אמנות של מינימום מאמץ. |
| A · shocked: אפס נקודות ל{a}. / B · laughing: לפחות מספר עגול. אסתטי. |

### photo (6) · photo finish in the last seconds: {a} and {b}

| Takes |
| --- |
| A · shocked: {a} מול {b}! צמוד! / B · suspense: אני לא נושמת. גם אתם לא. |
| B · cheering: פוטו פיניש! {a} או {b}? / A · presenting: מזמינים צילום מהמסוק של החדשות. |

### streak (4) · {a} keeps climbing

| Takes |
| --- |
| A · cheering: {a} על האש! / B · laughing: כמו מנגל ביום העצמאות. השכנים מתקשרים. |
| B · cheering: אי אפשר לעצור את {a}. / A · presenting: ניסיתי. קיבלתי כרטיס צהוב. |
| A · shocked: {a} ברצף! מחורחר! / B · presenting: מישהו יביא לטלפון הזה מים. הוא רותח. |

### firstOut (5) · flappy: the first one to fall ({a})

| Takes |
| --- |
| A · shocked: יציאה ראשונה: {a}! / B · laughing: מישהו היה צריך לפתוח. תודה על השירות. |
| B · shocked: {a}, כבר?! / A · presenting: טיסה קצרה. כמו לאילת, רק בלי אילת. |

### out (4) · flappy: {a} fell

| Takes |
| --- |
| A · shocked: {a} בחוץ! / B · laughing: נחיתה בנתב״ג. בלי מחיאות כפיים. |
| B · presenting: הטיסה של {a} הסתיימה. / A · laughing: תודה שטסתם איתנו. החגורות פתוחות. |
| A · laughing: {a}, הנחיתה הייתה... אמנותית. / B · cheering: עשר בסגנון. אפס בתעופה. |
| B · shocked: אוי, {a}! / A · presenting: המלאך ראה. המלאך מצחקק. |

### stillLead (3) · quiet race: {a} still leads ({b} second)

| Takes |
| --- |
| A · presenting: {a} עדיין בראש. / B · suspense: חשוד. מישהו יבדוק את הטלפון הזה. |
| B · laughing: {b}, ראית את {a}? / A · presenting: רק את הגב. מרחוק. |
| A · laughing: {a}, נראה לך שזה סגור? / B · cheering: פה שום דבר לא סגור. חוץ מהמטבח. |

### mid (3) · quiet race: {a} in the middle of the table

| Takes |
| --- |
| A · presenting: ואיפה {a}? באמצע. / B · laughing: שווייץ של המרוץ. ניטרלי, ושוקולד טוב. |
| B · presenting: {a} באמצע הטבלה. / A · laughing: קומה שלוש בלי מעלית. אבל עם נוף. |

### room (3) · quiet race: about everybody (no names)

| Takes |
| --- |
| A · presenting: כולם על הטלפונים. כמו בחתונה. / B · laughing: רק שהפעם זה מותר. |
| B · suspense: תסתכלו על הפרצופים. מחורחר. / A · presenting: אני רואה פה ריכוז. כמו בבגרות. |
| A · cheering: איזה מרוץ! בן פורת יוסף! |

### tap (3) · quiet race in Shimi Tap: anybody

| Takes |
| --- |
| A · presenting: {a}, האצבע שלך בכושר. / B · laughing: מנוי שנתי בחדר כושר. רק לאצבע. |
| B · shocked: {a}, זה מסך. לא תוף. / A · laughing: תגידו את זה לשכנים מלמטה. |

### icy (3) · quiet race in Icy: anybody

| Takes |
| --- |
| A · presenting: {a}, איזה טיפוס! / B · cheering: קומה אחרי קומה. תמ״א 38. |
| B · shocked: {a}, החלקת? / A · laughing: קרח זה בוגדני. כמו מדרכה בירושלים בשלג. |

### flappy (3) · quiet race in Flappy: anybody still in the air

| Takes |
| --- |
| A · presenting: {a} עדיין באוויר. / B · laughing: אל על מתקשרים. רוצים להחתים. |
| B · presenting: {a}, טסת יפה. / A · laughing: טיסת שכר. בלי ארוחה. |

### plotzel (3) · quiet race in Plotzel: anybody

| Takes |
| --- |
| B · presenting: {a}, המילון פתוח אצלך? / A · laughing: אבן שושן. מהדורת 84׳. |
| A · presenting: {a}, איזו מילה זאת? / B · suspense: ששש. האקדמיה ללשון בודקת. |

### ninja (3) · quiet race in Ninja: anybody

| Takes |
| --- |
| A · presenting: {a}, סכין זה לא שרביט. / B · laughing: אבל הפלאפל דווקא התרגש. |
| B · shocked: {a}, חתכת סביח בלי עמבה? / A · shocked: זה פשע. מעבירים לשופט. |

## Adding or changing a line

Keep it one sentence (two very short ones at most), under 55 characters, ending in a full stop or an
exclamation mark, in its speaker's gender, with no guest name. Pick a pose that exists (presenting,
cheering, shocked, suspense, laughing, waving). Run `npx vitest run tests/unit/narration.test.ts`.

A banter line: at most 46 characters with a six-letter name in each slot, {a} in every take about somebody,
and a name never the subject of a gendered verb. Change `banter.ts`, regenerate the tables above from it, and
run `npx vitest run tests/unit/banter.test.ts`.
