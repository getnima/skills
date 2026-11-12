/**
 * ☰ → "קרדיטים": who made the pictures and fonts the show uses. The accessory photos come
 * from Wikimedia Commons under CC licences that ask for attribution; the list is the one
 * on the owner's page (client/public/assets/shimi/README.md). TV-local: not an action of
 * the control model, nothing goes to the remote.
 */
import { Modal } from './ui';

import type { JSX } from 'preact';

interface PhotoCredit {
  /** The accessory, in Hebrew. */
  readonly item: string;
  readonly author: string;
  readonly licence: string;
  /** The file's page on Wikimedia Commons. */
  readonly file: string;
}

const COMMONS = 'https://commons.wikimedia.org/wiki/File:';

export const PHOTO_CREDITS: readonly PhotoCredit[] = [
  { item: 'כתר', author: 'Gryffindor', licence: 'CC BY-SA 3.0', file: 'Replica_of_Crown_of_Wilhelm_II_002.png' },
  { item: 'משקפי לב', author: 'ShyAndroid', licence: 'CC0', file: 'Heart_sunglasses,_front_view.jpg' },
  { item: 'כובע צילינדר', author: 'The Metropolitan Museum of Art', licence: 'CC0', file: 'Top_hat_MET_50.100.4a_CP1.jpg' },
  { item: 'שפם', author: 'Denisgrim', licence: 'CC BY-SA 3.0', file: 'Moustache01big.jpg' },
  { item: 'סומבררו', author: 'Jamain', licence: 'CC BY-SA 3.0', file: 'Sombrero_J1.jpg' },
  { item: 'אוזניות', author: 'Sotti, Niabot', licence: 'CC BY-SA 3.0', file: 'AKG_K701.jpg' },
  { item: 'קסדת ויקינגים', author: 'Michel wal', licence: 'CC BY-SA 3.0', file: 'Horned_helmet.jpg' },
  { item: 'זר הוואי', author: 'Bchachara', licence: 'CC BY-SA 4.0', file: 'Plumeria_Floral_Garland.jpg' },
  { item: 'כובע טמבל', author: 'Araras Sombrerería', licence: 'CC BY-SA 4.0', file: 'Sombrero_pescador_o_Bucket_de_Araras_sombrereria.jpg' },
  { item: 'כובע מסיבה', author: 'Polylerus, Iain', licence: 'CC BY-SA 3.0', file: 'Partyhat.JPG' },
];

export function CreditsPanel(props: { onClose(): void }): JSX.Element {
  return (
    <Modal title="קרדיטים" wide onClose={props.onClose} testId="credits">
      <div class="hs-credits">
        <h3>תמונות האביזרים: ויקישיתוף (Wikimedia Commons)</h3>
        <ul class="hs-credits-list">
          {PHOTO_CREDITS.map((c) => (
            <li key={c.file} data-testid="credit">
              <b>{c.item}</b>
              <a href={COMMONS + c.file} target="_blank" rel="noopener noreferrer" dir="ltr">
                {c.author}
              </a>
              <span class="hs-credits-lic" dir="ltr">
                {c.licence}
              </span>
            </li>
          ))}
        </ul>
        <p>
          שינויים בתמונות: גזירת רקע ושינוי גודל. הרישיונות: <bdi dir="ltr">CC0</bdi> / <bdi dir="ltr">CC BY-SA</bdi> (<bdi dir="ltr">creativecommons.org/licenses</bdi>).
        </p>
        <h3>גופנים</h3>
        <p>
          <bdi dir="ltr">Rubik</bdi>: <bdi dir="ltr">SIL Open Font License 1.1</bdi> · מוטלה (<bdi dir="ltr">Motaleh</bdi>): גופן הכותרות מהדף של בעל הבית.
        </p>
        <h3>שימי והמארחים</h3>
        <p>בובת שימי, האביזרים והעיצוב: מהדף של בעל הבית. בובות המארחים: פסלונים שנוצרו מתמונות המארחים.</p>
      </div>
    </Modal>
  );
}
