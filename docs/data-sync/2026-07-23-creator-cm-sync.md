# Creator → CM sync (2026-07-23)

Sync `creators.owner_cpm_id` (the CM managing each creator) from the CM master
sheet into the **MCN MEA** production project (`bqknstylbpwsnlgnzayw`).

- Source sheet: <https://docs.google.com/spreadsheets/d/1YaXAxa9rLXnepDAUsjEU3jwT6ivf7aVDhLpW2xCIdr0>
- Executed SQL: [`2026-07-23-creator-cm-sync.sql`](./2026-07-23-creator-cm-sync.sql)
- Matching key: `lower(trim(coalesce(creators.username, creators.name)))` = sheet username.
- Every material change written to `audit_logs` (`action = sync_creator_cm_from_sheet`, `type = auto`).

## Sheet contents

378 rows → **373 distinct usernames**, mapped to 17 CM short-names.

## Pass 1 — applied

| CM (sheet) | team_members | Segment | Distinct creators | Rows updated |
|---|---|---|---|---|
| Ryan | Ryan Nita | tiktok | 55 | 188 |
| Ghifari | Mochammad Ghifari Cahyadi | tiktok | 40 | 138 |
| Rafly | Moch Rafly Nurhadi Hartono | tiktok | 28 | 115 |
| Bilal | Bilal Fadilah | tiktok | 27 | 58 |
| Elsa | Elsa Yashinta Amalia | tiktok | 18 | 47 |
| Hasna | Hasna Nuraini Aminah | tiktok | 17 | 40 |
| Keizha | Keizha Mayadha | tiktok | 16 | 31 |
| Delliq | Delliq Hastariq Atfhal | shopee | 20 | 28 |
| Sindi | Sindi Amalia Putri | celeb | 6 | 20 |
| Uma | Um Velika Juniardhani | celeb | 10 | 10 |
| Aminah | Aminah Alida | celeb | 5 | 5 |
| **Total** | | | **242** | **680** |

Spelling matches applied: `dina_arsylla`→`dina_arsyilla`, `koh_alex_shoppingterusss`→`koh_alex_shoppingteruss`, `rainaisty`→`rainaistypuspa`.
Conflict `agus_naj` resolved to Ghifari (its other CM, Netta, does not exist).

## Held — needs follow-up

**CM short-names not found in `team_members` (6)** — likely nicknames pending
clarification; their creators are not yet assigned:
`Netta`, `Gabriel`, `Aditya`, `Helsi`, `Fadel`, `Nanthie`.

**Conflict, skipped (1):** `my.lup_` appears under both Rafly and Hasna.

**Creators in the sheet with no record in `creators` (36):**
`2ndcaramels, akmildirumah, aprill.la24, ayuss808, basglerr_id, bosperkakass,
cecearaa2, da.zulian, derizagroup, dewiretisni, drachmaa, faniahome18,
ideliachristy, inembali, itsme.niik, jonekarrr, kelvinchou_, malipuherbal,
markibaikdeh, masdaanggitasidabukke, mentaari29, mirahpuspitaa2, neo.look,
purnama.larissa, rainyummy04, review.amandaalstr, rizkiche1, rosezanna14,
rrajengtsari2, sachiliving.daily, silviana_96, tokoterbaikori, vieldadamayanti,
winris12, wonglawas80an, yumna official`

## Data-quality note

The `creators` table holds **2,600 rows for ~1,119 distinct usernames** — heavy
duplication (e.g. `bossrei.id` and `dewigita01` each have 15 rows). The 242
matched usernames span 680 rows. This sync only sets ownership; de-duplication is
a separate task worth scheduling.
