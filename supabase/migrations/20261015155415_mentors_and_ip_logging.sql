-- Mentors are rows in members so that sessions.created_by and
-- adjustments.created_by can record which mentor acted. Mentors have no
-- graduation year. Who counts as a mentor is the ADMIN_DISCORD_IDS env var,
-- not a column.
alter table members alter column grad_year drop not null;

-- Raw client IP observed when a redeem link is tapped, stored on the QR code
-- it issues. Collected with enforcement off so the school allowlist can be
-- built from real data (Design.md §6, build step 10).
alter table pending_codes add column ip_address inet;
