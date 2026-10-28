-- sha256 of the member's permanent phone QR token (Design.md §5a). Kept
-- apart from token_hash, the printed badge, so making one never turns off
-- the other. Only the hash is stored (CLAUDE.md invariant #5).
alter table members add column qr_token_hash text unique;
