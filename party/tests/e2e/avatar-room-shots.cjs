// Quick look at the dressing room: one screenshot per phone size (and a few states).
//   node tests/e2e/avatar-room-shots.cjs [size-name] [look]
const { chromium } = require('playwright');
const { SIZES, openRoom, shot, tapEl } = require('./avatar-room-lib.cjs');

(async () => {
  const only = process.argv[2];
  const look = process.argv[3] || '1.8.8-17.9.0.11.7';
  const browser = await chromium.launch();
  try {
    for (const size of SIZES.filter((s) => !only || s.name === only)) {
      const { ctx, page, errors } = await openRoom(browser, size, {
        look,
        settle: 2500,
      });
      console.log(size.name, await shot(page, `quick-${size.name}`));
      await tapEl(page, '.dr-tab[data-tab="BG"]');
      await page.waitForTimeout(1500);
      console.log(size.name, await shot(page, `quick-${size.name}-bg`));
      if (errors.length) console.log('ERRORS', errors);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})();
