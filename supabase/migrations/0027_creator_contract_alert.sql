-- Threshold window "kontrak kreator akan habis" untuk summary widget /creators.
-- CLAUDE.md: semua threshold hidup di app_config, JANGAN hardcode di kode.
-- Terpisah dari m4.expiry_alert_days (=7) yang dipakai untuk deal_end shop —
-- domain & horizon beda: kontrak kreator butuh lead time lebih panjang untuk
-- proses perpanjangan/follow-up.
insert into app_config (key, value) values
  ('creators.contract_alert_days', '30')
on conflict (key) do nothing;
