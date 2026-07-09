-- Shopee ingest lane (Lane 1, Shopee card) — CLAUDE.md task spec.
-- upload_batches.source_type check constraint only allowed ('mcn','tap','master');
-- add 'shopee' so the Shopee Conversion Report pipeline (src/lib/ingest/shopee-run.ts)
-- can record its own upload_batches rows without violating the check.
alter table upload_batches drop constraint upload_batches_source_type_check;
alter table upload_batches add constraint upload_batches_source_type_check
  check (source_type in ('mcn', 'tap', 'master', 'shopee'));
