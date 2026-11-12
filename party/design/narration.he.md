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
  נודר, צדיק!, בן פורת יוסף!, וואו!, מחורחר!, אחשילי.
- **No guest name inside a line.** Where it reads well the TV shows the name as a blue tag on the bubble
  (the first guests: whoever came in last; the champion).

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
  block, which steps aside. Between rounds each screen has its own corner: the empty lobby's left, the
  intro's top-left, the results' left column, the ceremony's bottom band, the podium's left margin, the
  final table's right.

## The script (39 lines)

### The opening (7) · the TV opens on an empty lobby

| Host · pose | Line |
| --- | --- |
| A · presenting | ערב טוב, ישראל! זה פארטי ארנה. |
| B · laughing | כמו האירוויזיון, רק עם במבה. |
| *or* B · presenting | סרקו את הקוד. כרטיסים אחרונים, כמו בקיסריה. |

### The first guests (5) · tag: the guest who came in last

| A · shocked | וואו, אורחים אמיתיים! לא ניצבים. |
| --- | --- |
| *or* B · cheering | יש לנו מתמודדים! צדיק! |

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
| *or* B · laughing | צדיק! המלאך כבר מחפש חניה ליד הבית. |

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

## Adding or changing a line

Keep it one sentence (two very short ones at most), under 55 characters, ending in a full stop or an
exclamation mark, in its speaker's gender, with no guest name. Pick a pose that exists (presenting,
cheering, shocked, suspense, laughing, waving). Run `npx vitest run tests/unit/narration.test.ts`.
