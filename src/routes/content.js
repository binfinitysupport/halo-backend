// Routes for the admin "Banners & announcements" page.
// Mounted at /api/content in index.js. Every route here needs an admin token (see middleware/require-admin.js).
// Banners live in the "banners" table; the running announcement text lives in the single "settings" row.
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError, rethrowInvalidIdAs400 } from '../utils/http.js';

const router = Router();

// Database row (snake_case columns) → the JSON shape the admin app expects (camelCase).
const toBannerResponse = (banner) => ({
  id: banner.id,
  title: banner.title,
  subtitle: banner.subtitle,
  isLive: banner.is_live,
});

// GET /api/content → { popup: [banners], home: [banners], announcement: { text, isLive } }
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // One query returns the announcement fields plus ALL banners as a JSON array (json_agg), sorted by sort_order.
    const { rows: settingsRows } = await query(`
      SELECT announcement_text, announcement_live,
        (SELECT coalesce(json_agg(b ORDER BY b.sort_order), '[]') FROM banners b) AS banners
      FROM settings WHERE key = 'global'`);

    const { banners, announcement_text, announcement_live } = settingsRows[0];
    // Split the banners into the two groups shown on the page.
    const popupBanners = banners.filter((banner) => banner.kind === 'popup');
    const homeBanners = banners.filter((banner) => banner.kind === 'home');

    res.json({
      popup: popupBanners.map(toBannerResponse),
      home: homeBanners.map(toBannerResponse),
      announcement: { text: announcement_text, isLive: announcement_live },
    });
  })
);

// PATCH /api/content/banners/:id  body { title?, subtitle?, isLive? } → the updated banner
// Only the fields that are sent get changed.
router.patch(
  '/banners/:id',
  asyncHandler(async (req, res) => {
    // Build the "SET ..." part of the SQL from the fields that were sent.
    // Each value goes into `params` and is referenced as $1, $2, ... (never pasted into the SQL text).
    const setClauses = [];
    const params = [];
    if (typeof req.body.title === 'string') {
      params.push(req.body.title);
      setClauses.push(`title = $${params.length}`);
    }
    if (typeof req.body.subtitle === 'string') {
      params.push(req.body.subtitle);
      setClauses.push(`subtitle = $${params.length}`);
    }
    if (typeof req.body.isLive === 'boolean') {
      params.push(req.body.isLive);
      setClauses.push(`is_live = $${params.length}`);
    }

    // The banner id is always the last parameter.
    params.push(req.params.id);
    const idPlaceholder = `$${params.length}`;

    // Something to change: UPDATE and get the new row back (RETURNING *).
    // Nothing to change: just read the banner so we still return it.
    let sql;
    if (setClauses.length > 0) {
      sql = `UPDATE banners SET ${setClauses.join(', ')} WHERE id = ${idPlaceholder} RETURNING *`;
    } else {
      sql = `SELECT * FROM banners WHERE id = ${idPlaceholder}`;
    }

    const { rows } = await query(sql, params).catch(rethrowInvalidIdAs400);
    if (!rows[0]) {
      throw new HttpError(404, 'Banner not found');
    }
    res.json(toBannerResponse(rows[0]));
  })
);

// PUT /api/content/announcement  body { text, isLive } → { text, isLive } as saved
router.put(
  '/announcement',
  asyncHandler(async (req, res) => {
    const { text = '', isLive = false } = req.body;

    // Save both fields and read them back in the same statement.
    const { rows } = await query(
      `UPDATE settings SET announcement_text = $1, announcement_live = $2 WHERE key = 'global'
       RETURNING announcement_text, announcement_live`,
      [String(text), Boolean(isLive)]
    );

    const saved = rows[0];
    res.json({ text: saved.announcement_text, isLive: saved.announcement_live });
  })
);

export default router;
