// Public content for the user app: banners, announcement, support links, limits and maintenance.
// Mounted at /api/app/content in index.js. No login needed, because the app shows this before sign-in.
// Admins change these values in the admin portal (Banners & announcement, Settings).
import { Router } from 'express';
import { query, num } from '../../db.js';
import { asyncHandler } from '../../utils/http.js';
import { DEPOSIT_OPTIONS } from '../../rules/business-rules.js';

const router = Router();
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// GET /api/app/content → {
//   popupBanners, homeBanners, announcement (text or null), supportLinks,
//   minDeposit, minWithdrawal, maintenance: { on, until }, depositOptions
// }
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const bannerRows = await query(
      'SELECT kind, title, subtitle, sort_order FROM banners WHERE is_live = true ORDER BY sort_order'
    );
    const settingsResult = await query(
      `SELECT announcement_text, announcement_live, tg_official, tg_support, tg_community,
              min_deposit, min_withdrawal, maint_enabled, maint_hours, maint_started_at
       FROM settings WHERE key = 'global'`
    );
    const settings = settingsResult.rows[0];

    const bannerView = (row) => ({ title: row.title, subtitle: row.subtitle });
    const maintenanceEndsAt = settings.maint_started_at
      ? new Date(settings.maint_started_at).getTime() + num(settings.maint_hours) * MILLISECONDS_PER_HOUR
      : null;
    const isMaintenanceOn = settings.maint_enabled && maintenanceEndsAt !== null && Date.now() < maintenanceEndsAt;

    res.json({
      popupBanners: bannerRows.rows.filter((row) => row.kind === 'popup').map(bannerView),
      homeBanners: bannerRows.rows.filter((row) => row.kind === 'home').map(bannerView),
      announcement: settings.announcement_live ? settings.announcement_text : null,
      supportLinks: {
        official: settings.tg_official,
        support: settings.tg_support,
        community: settings.tg_community,
      },
      minDeposit: num(settings.min_deposit),
      minWithdrawal: num(settings.min_withdrawal),
      maintenance: { on: isMaintenanceOn, until: isMaintenanceOn ? maintenanceEndsAt : null },
      depositOptions: DEPOSIT_OPTIONS.map((option) => ({ id: option.id, label: option.label })),
    });
  })
);

export default router;
