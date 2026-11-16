import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';

const router = Router();

const presentBanner = (b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, isLive: b.is_live });

// GET /api/content -> popup banners, home banners, announcement
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows: s } = await query(`
      SELECT announcement_text, announcement_live,
        (SELECT coalesce(json_agg(b ORDER BY b.sort_order), '[]') FROM banners b) AS banners
      FROM settings WHERE key = 'global'`);
    const rows = s[0].banners;
    res.json({
      popup: rows.filter((b) => b.kind === 'popup').map(presentBanner),
      home: rows.filter((b) => b.kind === 'home').map(presentBanner),
      announcement: { text: s[0].announcement_text, isLive: s[0].announcement_live },
    });
  })
);

// PATCH /api/content/banners/:id  { title?, subtitle?, isLive? }
router.patch(
  '/banners/:id',
  asyncHandler(async (req, res) => {
    const sets = [];
    const params = [];
    if (typeof req.body.title === 'string') { params.push(req.body.title); sets.push(`title = $${params.length}`); }
    if (typeof req.body.subtitle === 'string') { params.push(req.body.subtitle); sets.push(`subtitle = $${params.length}`); }
    if (typeof req.body.isLive === 'boolean') { params.push(req.body.isLive); sets.push(`is_live = $${params.length}`); }
    params.push(req.params.id);
    const sql = sets.length
      ? `UPDATE banners SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`
      : `SELECT * FROM banners WHERE id = $${params.length}`;
    const { rows } = await query(sql, params).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0]) throw new HttpError(404, 'Banner not found');
    res.json(presentBanner(rows[0]));
  })
);

// PUT /api/content/announcement  { text, isLive }
router.put(
  '/announcement',
  asyncHandler(async (req, res) => {
    const { text = '', isLive = false } = req.body;
    const { rows } = await query(
      `UPDATE settings SET announcement_text = $1, announcement_live = $2 WHERE key = 'global'
       RETURNING announcement_text, announcement_live`,
      [String(text), Boolean(isLive)]
    );
    res.json({ text: rows[0].announcement_text, isLive: rows[0].announcement_live });
  })
);

export default router;
