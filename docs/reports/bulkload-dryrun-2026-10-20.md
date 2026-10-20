# Dry-run Import Bulk Deal Brand — 2026-10-20

- Sumber: Google Sheet "All Brand TAP [Database Bizdev TikTok 2026]" — tab "DATA BULKING! UNTUK KO YOHAN"
- Dibandingkan dengan: **produksi** (SELECT read-only, tidak ada yang ditulis)
- Dibuat: 2026-10-20T15:49:00.897Z
- Kunci upsert: (platform, shop_id, trim(brand_name)), case-sensitive

## Ringkasan
| Item | Jumlah |
|---|---|
| Baris data di sheet | 813 |
| Baris brand_deals di produksi sekarang | 48 |
| Akan di-INSERT | 773 |
| Akan di-UPDATE | 26 |
| Sama persis (tidak berubah) | 0 |
| Di-SKIP (perlu konfirmasi tim) | 14 |
| Baris produksi yang tidak ada di sheet | 22 |
| Status kosong → NULL | 3 |
| Ads Brand di luar daftar | 6 |
| Ads Brand perlu dipasang ke Project BD | 191 |
| Nama Bizdev tidak cocok | 1 |
| Nama Campaign Ops tidak cocok | 1 |

## 1. Perlu konfirmasi tim — baris di-SKIP
| Baris sheet | Brand | Shop ID | Alasan | Baris kembar |
|---|---|---|---|---|
| 70 | Baseus official store | 7495650924726291277 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 71 |
| 71 | Baseus official store | 7495650924726291277 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 70 |
| 85 | Bintang Toedjoe Store | 7494556100094363834 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 86 |
| 86 | Bintang Toedjoe Store | 7494556100094363834 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 85 |
| 96 | BIC MALL - BOYA Indonesia OS | (kosong) | Tanpa Shop ID — perlu konfirmasi tim |  |
| 97 | Brand Testing | (kosong) | Tanpa Shop ID — perlu konfirmasi tim |  |
| 134 | Cooger HomeLiving Mall - COOGER Electric | (kosong) | Tanpa Shop ID — perlu konfirmasi tim |  |
| 168 | DiliDili.Shop | 7495625938392025265 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 169 |
| 169 | DiliDili.Shop | 7495625938392025265 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 168 |
| 235 | Footage | 7494083435652613559 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 236 |
| 236 | Footage | 7494083435652613559 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 235 |
| 237 | For Skin's Sake | 7494645309267282444 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 238 |
| 238 | For Skin's Sake | 7494645309267282444 | Duplikat persis (nama brand + Shop ID sama) — perlu konfirmasi tim | 237 |
| 809 | (kosong) | 7494931568031533225 | Tanpa nama brand |  |

## 2. Status kosong (disimpan NULL)
| Baris | Brand | Shop ID |
|---|---|---|
| 467 | MIORIO | 7494401438774428990 |
| 745 | USMILE | 7495000198045272280 |
| 757 | Vibrant Glamour | 7495066760799816395 |

## 3. Ads Brand
### 3a. Nilai lama di luar daftar pilihan (dilaporkan, tidak dipetakan)
| Baris | Brand | Shop ID | Nilai lama |
|---|---|---|---|
| 39 | Anessa Indonesia | 7494033681309861696 | Daily (Barcode/Invoicing) |
| 286 | H&H Skincare | 7494083747781968989 | Not yet Support |
| 406 | Le Ding Ding | 7495478238059465663 | Campaign Bulking |
| 446 | Maybelline Indonesia | 7494048773396071648 | Daily (Barcode/Invoicing) |
| 476 | MOELL OFFICIAL | 7494840462703167559 | Daily (Barcode), Minim Support |
| 598 | Purbasari Indonesia | 7494083658890053184 | Daily (Barcode/Invoicing) |

### 3b. Perlu dipasang ke Project BD (shop belum ada di Project BD mana pun — project TIDAK dibuat otomatis)
| Baris | Brand | Shop ID | Ads Brand |
|---|---|---|---|
| 4 | 2Tang & Tjatoet Official | 7495791507057838382 | Brand Invoice One Time - Cek BD |
| 5 | 3CE Indonesia | 7496114913756744244 | Ads By Brand - Minta Barcode |
| 8 | ABC Heinz Shop | 7494761761994017029 | Tidak Support Ads |
| 9 | Acome Indonesia | 7493991045969577150 | Tidak Support Ads |
| 11 | ADVAN INDONESIA | 7494083562202629991 | Brand Invoice One Time - Cek BD |
| 12 | ADVAN NOTEBOOK | 7495274674923998006 | Brand Invoice Bulking - Cek BD |
| 13 | Advance DIgitals Store | 7494083752709293123 | Ads By Brand - Minta Barcode |
| 33 | Amestan | 7496100090953566882 | Brand Invoice One Time - Cek BD |
| 35 | AMOREPACIFIC Hair&Beauty Shop | 7494997478679743213 | Ads By Brand - Minta Barcode |
| 40 | Animate | 7494534933580187896 | Ads By Brand - Minta Barcode |
| 45 | Arizona Carpet | 7495041153448970397 | Tidak Support Ads |
| 53 | AUTOMOTIVELED | 7494811603992610963 | Brand Invoice One Time - Cek BD |
| 55 | Aveeno Baby ID | 7494288416611337574 | Ads By Brand - Minta Barcode |
| 58 | Ayucitra Fashion | 7493993157318051090 | Tidak Support Ads |
| 62 | Baby Millenial | 7495085189702191175 | Brand Invoice One Time - Cek BD |
| 79 | Betadine Shop | 7494881384198474181 | Ads By Brand - Minta Barcode |
| 84 | Bintang leather | 7494837873396124586 | Ads By Brand - Minta Barcode |
| 91 | Blackmores Official | 7495816200401750342 | Ads By Brand - Minta Barcode |
| 99 | Braven Perfume | 7495676835953805708 | Tidak Support Ads |
| 101 | Bravhom Personal Care | 7495475212053285594 | Ads By Brand - Minta Barcode |
| 105 | BRUGGMAN.STORE | 7494608116311624104 | Tidak Support Ads |
| 109 | Bumbu Bunda Official Shop | 7494083410172150843 | Ads By Brand - Minta Barcode |
| 116 | Captain Cemilan | 7495083875561015754 | Tidak Support Ads |
| 121 | Cerave Indonesia | 7495725536740870256 | Ads By Brand - Minta Barcode |
| 123 | Cetaphil Indonesia | 7494083592855389916 | Brand Invoice One Time - Cek BD |
| 125 | Cimory Indonesia | 7495149753706122212 | Brand Invoice One Time - Cek BD |
| 132 | Colgate Palmolive Indonesia | 7494598689875462188 | Ads By Brand - Minta Barcode |
| 135 | COOGER Indonesia | 7494001692248016281 | Tidak Support Ads |
| 136 | Coolvita Indonesia | 7494441594609830017 | Ads By Brand - Minta Barcode |
| 138 | COSRX ID | 7494738145561315657 | Tidak Support Ads |
| 144 | Crusita Official | 7494466814323886133 | Brand Invoice One Time - Cek BD |
| 149 | Daily Care by Unilever | 7495181208386570479 | Ads By Brand - Minta Barcode |
| 151 | Dalezz Foods Indonesia | 7494324121989383391 | Brand Invoice One Time - Cek BD |
| 154 | DAZZLE ME Indonesia | 7494540729581276041 | Ads By Brand - Minta Barcode |
| 159 | Delto Shop/antangin | 7494556635593411484 | Brand Invoice One Time - Cek BD |
| 160 | Deorex | 7493995135107106184 | Ads By Brand - Minta Barcode |
| 161 | Deoxide Official | 7496110970150160399 | Ads By Brand - Minta Barcode |
| 176 | Dove | 7495181208386570479 | Ads By Brand - Minta Barcode |
| 178 | Dr Ekle's Skincare | 7494731573439203419 | Brand Invoice One Time - Cek BD |
| 181 | Dricha | 7494537453470190153 | Brand Invoice Bulking - Cek BD |
| 183 | DRVE | 7496031009988708422 | Tidak Support Ads |
| 186 | DTG Grup | 7495276102755190828 | Brand Invoice One Time - Cek BD |
| 189 | DVARA | 7494906156684446033 | Ads By Brand - Minta Barcode |
| 192 | Dyson | 7495152152248289572 | Ads By Brand - Minta Barcode |
| 194 | ecentio Official Shop | 7494019617815103057 | Tidak Support Ads |
| 200 | ELVICTO | 7493996645226087753 | Tidak Support Ads |
| 203 | Embryolisse Indonesia | 7495066992398469742 | Tidak Support Ads |
| 209 | Esqa Cosmetics | 7494597156705568891 | Brand Barcode Bulking - Cek BD |
| 210 | Etawaku Platinum | 7494547918922812323 | Tidak Support Ads |
| 211 | Etawaku Platinum Shop | 7494880432126135077 | Brand Invoice One Time - Cek BD |
| 212 | Etawalin Store | 7494733250585660194 | Tidak Support Ads |
| 213 | Etude Indonesia | 7496013178714359933 | Ads By Brand - Minta Barcode |
| 218 | facetologystore | 7494518382967229229 | Ads By Brand - Minta Barcode |
| 224 | Fill The Room Fragrance | 7496229531934165942 | Tidak Support Ads |
| 228 | flimbeauty.id | 7495212045229000936 | Brand Invoice One Time - Cek BD |
| 232 | Foca Kue Sachima Official | 7496203411210995779 | Brand Invoice One Time - Cek BD |
| 233 | FOCA Sachima by AISA Food | 7496004098318895987 | Brand Invoice One Time - Cek BD |
| 240 | Freemir | 7493995778015528220 | Tidak Support Ads |
| 241 | Frisian Flag Official Store | 7494910991163689766 | Brand Invoice One Time - Cek BD |
| 250 | GAGA Shop Official Mie 100 | 7494831151462975864 | Tidak Support Ads |
| 252 | Gain Yum Official | 7496031910742035328 | Tidak Support Ads |
| 254 | Garnier Indonesia | 7494048805936399778 | Ads By Brand - Minta Barcode |
| 261 | glad2glow.indo | 7494807241590606114 | Ads By Brand - Minta Barcode |
| 267 | GLOW FX | 7494734706184194419 | Ads By Brand - Minta Barcode |
| 269 | Glowsicha Indonesia | 7495304714025077543 | Ads By Brand - Minta Barcode |
| 272 | GO JILL GORDEN | 7495824148619430886 | Tidak Support Ads |
| 276 | Golden Up | 7494695197051750257 | Brand Invoice One Time - Cek BD |
| 277 | Golden Us | 7494719215742388182 | Brand Invoice One Time - Cek BD |
| 281 | Grandville Food | 7494547831600810815 | Brand Invoice One Time - Cek BD |
| 282 | GRENEY.Underwear.id | 7494083724179703696 | Ads By Brand - Minta Barcode |
| 287 | HAJI SALMAN | 7494916758399519015 | Brand Invoice One Time - Cek BD |
| 291 | Hansaplast Indonesia | 7494936513126894282 | Tidak Support Ads |
| 293 | Happysembako | 7495773180141734061 | Brand Invoice One Time - Cek BD |
| 294 | Haquhara | 7493994407041271768 | Ads By Brand - Minta Barcode |
| 296 | Heaven Lights | 7494020635315373567 | Tidak Support Ads |
| 302 | Herborist Natural Care ID | 7494083492655236964 | Ads By Brand - Minta Barcode |
| 318 | Huawei Indonesia | 7494981603942894396 | Ads By Brand - Minta Barcode |
| 319 | HYLE Clothing | 7494775538383424365 | Ads By Brand - Minta Barcode |
| 328 | innisfree Indonesia | 7494083561467971250 | Ads By Brand - Minta Barcode |
| 333 | itel Home ID | 7495479542837906274 | Brand Invoice Bulking - Cek BD |
| 339 | Jestham | 7494460339853035957 | Ads By Brand - Minta Barcode |
| 344 | Jims Honey Official Shop | 7494568852019120243 | Ads By Brand - Minta Barcode |
| 347 | Johnson's Baby ID | 7494083506288690969 | Ads By Brand - Minta Barcode |
| 350 | Judydoll Indonesia | 7495634419875220215 | Ads By Brand - Minta Barcode |
| 358 | KalonOfficial.id | 7494505781899856331 | Brand Invoice One Time - Cek BD |
| 363 | Kathwi Shop Indonesia | 7495486369172654686 | Ads By Brand - Minta Barcode |
| 364 | Katia Collections | 7494854118469765333 | Ads By Brand - Minta Barcode |
| 365 | KedaiMart | 7494649527781919026 | Brand Invoice One Time - Cek BD |
| 379 | Koepoe Koepoe Shop | 7494595239588366983 | Brand Invoice One Time - Cek BD |
| 380 | Kojic Plankton Original | 7494529954242398927 | Brand Invoice One Time - Cek BD |
| 381 | KOPHER ID | 7496101090037303518 | Ads By Brand - Minta Barcode |
| 383 | Kremes Kraton | 7494965266172840762 | Brand Invoice One Time - Cek BD |
| 390 | L'Oreal Paris Haircare | 7496100006925011248 | Ads By Brand - Minta Barcode |
| 391 | L'Oreal Paris Indonesia | 7494420619288217834 | Ads By Brand - Minta Barcode |
| 392 | L'Oréal Professionnel ID | 7495817678334494753 | Ads By Brand - Minta Barcode |
| 393 | La Roche Posay | 7494929988145220466 | Ads By Brand - Minta Barcode |
| 395 | Lahap Bareng | 7495479583098046475 | Tidak Support Ads |
| 397 | Laneige Indonesia Official | 7494754655541955273 | Ads By Brand - Minta Barcode |
| 399 | LashBoss | 7494083449197331619 | Ads By Brand - Minta Barcode |
| 408 | LeDingDing | 7496149164176869721 | Brand Invoice Bulking - Cek BD |
| 409 | leekumkeeindonesia | 7495139876079438479 | Tidak Support Ads |
| 415 | LiangGui Food | 7495660615512001016 | Tidak Support Ads |
| 416 | Lifebuoy | 7495181208386570479 | Ads By Brand - Minta Barcode |
| 423 | Loluna Official | 7495182677925792112 | Ads By Brand - Minta Barcode |
| 424 | Loony | 7494551701629930456 | Ads By Brand - Minta Barcode |
| 425 | Lozy Hijab | 7494431046754339527 | Ads By Brand - Minta Barcode |
| 431 | Lunavee Indonesia | 7494202251683136851 | Ads By Brand - Minta Barcode |
| 433 | Madame Gie | 7493996803401680547 | Tidak Support Ads |
| 440 | Mars Snacking Indonesia | 7495861496180214041 | Ads By Brand - Minta Barcode |
| 449 | Mc Lewis Indonesia | 7495656314416695865 | Brand Invoice One Time - Cek BD |
| 452 | Medicube Indonesia | 7496019554130888970 | Brand Barcode Bulking - Cek BD |
| 455 | Menara Sembako | 7495295626462595675 | Brand Invoice One Time - Cek BD |
| 459 | Milkita Indonesia | 7494083758575420490 | Brand Invoice One Time - Cek BD |
| 461 | Minaier Official Store | 7494273583221540073 | Ads By Brand - Minta Barcode |
| 466 | minisoshopid | 7495228315098515899 | Ads By Brand - Minta Barcode |
| 467 | MIORIO | 7494401438774428990 | Ads By Brand - Minta Barcode |
| 475 | MOC Indonesia | 7494873758279240221 | Ads By Brand - Minta Barcode |
| 478 | Mom Uung Official | 7493997672409892433 | Ads By Brand - Minta Barcode |
| 483 | Moorkoedal.Id | 7495986821446798305 | Ads By Brand - Minta Barcode |
| 485 | Morris Indonesia | 7493991977724905079 | Ads By Brand - Minta Barcode |
| 487 | Mossèru | 7495297011747293899 | Ads By Brand - Minta Barcode |
| 493 | Mukena Ayzara | 7494083526714558174 | Ads By Brand - Minta Barcode |
| 502 | Nabati Indonesia | 7495909645038881575 | Brand Invoice One Time - Cek BD |
| 508 | Nazura Mart | 7496000256423660307 | Brand Invoice One Time - Cek BD |
| 509 | ncoperfume | 7495917837212158137 | Ads By Brand - Minta Barcode |
| 513 | Neoalgae Official | 7494698874318654145 | Ads By Brand - Minta Barcode |
| 516 | Nestle Indonesia | 7494558784899090960 | Tidak Support Ads |
| 519 | NEXT PRIME | 7494252350444373159 | Ads By Brand - Minta Barcode |
| 521 | NIVEA Official Store | 7494512520393231104 | Ads By Brand - Minta Barcode |
| 526 | NOOYA INDONESIA | 7496267563117218179 | Ads By Brand - Minta Barcode |
| 529 | npureofficial | 7493991957026932115 | Ads By Brand - Minta Barcode |
| 534 | Nusa Inti Pangan | 7496162072465738583 | Tidak Support Ads |
| 554 | OMRON Healthcare ID | 7495597609928788046 | Brand Barcode Bulking - Cek BD |
| 555 | OMURA POWDER SHOP | 7494759625119599254 | Tidak Support Ads |
| 557 | Onoma | 7494911167947573320 | Ads By Brand - Minta Barcode |
| 558 | OOJHI | 7494457292083267284 | Brand Invoice One Time - Cek BD |
| 559 | OPPO Store Indonesia | 7493995189200651473 | Tidak Support Ads |
| 564 | OT-Store | 7494966433662864130 | Tidak Support Ads |
| 566 | OURINONE | 7494581616182266319 | Ads By Brand - Minta Barcode |
| 583 | Pigeonbabyindonesia | 7494475070809671863 | Ads By Brand - Minta Barcode |
| 587 | POLKI INDONESIA | 7494083647066703443 | Ads By Brand - Minta Barcode |
| 589 | Pond's | 7494693460590561622 | Ads By Brand - Minta Barcode |
| 590 | Porto Footwear | 7493990205884696137 | Ads By Brand - Minta Barcode |
| 591 | Porto X | 7495553106418698678 | Ads By Brand - Minta Barcode |
| 596 | Pronas Indonesia | 7495475160973413268 | Brand Invoice One Time - Cek BD |
| 597 | PUMA Indonesia | 7496085094426446137 | Ads By Brand - Minta Barcode |
| 603 | Puxi Official Store | 7496087135491623856 | Tidak Support Ads |
| 609 | raeccaid | 7493994870019556382 | Ads By Brand - Minta Barcode |
| 620 | REREYSHOP | 7494083441640113885 | Tidak Support Ads |
| 625 | Rosé All Day Cosmetics | 7494002318068516091 | Brand Barcode Bulking - Cek BD |
| 634 | Ryusei | 7494083411718276575 | Ads By Brand - Minta Barcode |
| 636 | SAFF & Co. | 7494521006737033571 | Tidak Support Ads |
| 638 | Sahabat Kesehatan | 7495001424040659912 | Ads By Brand - Minta Barcode |
| 642 | Sajodo Snack & Food | 7493990017834189830 | Brand Invoice One Time - Cek BD |
| 643 | Sakura Baru | 7494438723482454810 | Ads By Brand - Minta Barcode |
| 644 | Sakurastore25 | 7496160717827902445 | Brand Invoice One Time - Cek BD |
| 646 | Samono Indonesia | 7494083391869387815 | Ads By Brand - Minta Barcode |
| 649 | Sasa Melezatkan | 7494706614872148889 | Brand Invoice One Time - Cek BD |
| 660 | Scora | 7495479414655715854 | Ads By Brand - Minta Barcode |
| 672 | Sepatu Kanky | 7494763862183872809 | Ads By Brand - Minta Barcode |
| 684 | Sido Muncul Store | 7494743120013789832 | Ads By Brand - Minta Barcode |
| 685 | Sidomuncul Tolak Angin | 7495209408569313450 | Brand Invoice One Time - Cek BD |
| 687 | SKIN1004 | 7494928748302076708 | Tidak Support Ads |
| 689 | Skintificid | 7496055932977580622 | Ads By Brand - Minta Barcode |
| 693 | Soho Global Health | 7494668433258940787 | Ads By Brand - Minta Barcode |
| 696 | SOME BY MI SHOP | 7495500107169171632 | Ads By Brand - Minta Barcode |
| 702 | Stellar Line | 7494499943157041751 | Ads By Brand - Minta Barcode |
| 705 | Sulwhasoo Indonesia | 7495609693569649132 | Ads By Brand - Minta Barcode |
| 706 | SunCoid | 7495305673342421068 | Tidak Support Ads |
| 717 | THENBLANK | 7494729079531145300 | Tidak Support Ads |
| 720 | Tirtir Indonesia | 7495811548760148272 | Ads By Brand - Minta Barcode |
| 723 | tokosekarwangi | 7495209408569313450 | Tidak Support Ads |
| 726 | Torriden Indonesia | 7496054858587932747 | Ads By Brand - Minta Barcode |
| 727 | Toshiba TV Official Store | 7495188891025442904 | Ads By Brand - Minta Barcode |
| 729 | TT Mode wanita | 7495481862045141587 | Ads By Brand - Minta Barcode |
| 734 | Ultra Sakti Health | 7494529998403701089 | Brand Invoice One Time - Cek BD |
| 735 | Ultra Sakti Store | 7494862522912508574 | Brand Invoice One Time - Cek BD |
| 739 | Unilever Food Solutions | 7495159511201122707 | Tidak Support Ads |
| 740 | Unilever Hair Beauty Studio | 7495116066316716919 | Ads By Brand - Minta Barcode |
| 742 | UNITWO Home | 7495634116320922282 | Brand Barcode Bulking - Cek BD |
| 745 | USMILE | 7495000198045272280 | Ads By Brand - Minta Barcode |
| 749 | Vaseline Indonesia | 7494687833781864968 | Ads By Brand - Minta Barcode |
| 750 | VELIA CO | 7496210867435899171 | Ads By Brand - Minta Barcode |
| 756 | Vianova Watch Store | 7494547827244435895 | Ads By Brand - Minta Barcode |
| 757 | Vibrant Glamour | 7495066760799816395 | Tidak Support Ads |
| 763 | vivanindonesia | 7494083547676509234 | Ads By Brand - Minta Barcode |
| 764 | VIVI NICI | 7494422182333614375 | Ads By Brand - Minta Barcode |
| 776 | Willofi Hijab | 7496046036214515820 | Ads By Brand - Minta Barcode |
| 777 | Wings Indonesia | 7495481450890169058 | Tidak Support Ads |
| 793 | Yves Rocher Indonesia | 7495712062124952311 | Ads By Brand - Minta Barcode |
| 804 | Zwitsal | 7494925843634358389 | Ads By Brand - Minta Barcode |

## 4. Nama Bizdev & Campaign Ops
Dicocokkan PERSIS (tanpa beda huruf besar/kecil) ke team_members. Kandidat hanya saran — tidak dipakai otomatis.
| Kolom | Nama di sheet | Cocok | Kandidat |
|---|---|---|---|
| Bizdev | Alya | ya |  |
| Bizdev | Dania Tiffany | ya |  |
| Bizdev | Erlina sri utami | ya |  |
| Bizdev | Fanny | TIDAK | Fanny Putri Fernanda [bizdev] |
| Bizdev | Laila S | ya |  |
| Bizdev | M Yaumal Mizan Firdaus | ya |  |
| Campaign Ops | Diena | TIDAK | Diena Shofwah [campaign_ops] |

### 4a. BizDev handler per shop yang TIDAK ditulis (nama tak cocok / >2 BizDev di shop bersama)
| Shop ID | Brand | Tidak cocok | Konflik >2 | Handler produksi sekarang |
|---|---|---|---|---|
| 7494837873396124586 | Bintang leather | Fanny |  |  |
| 7494083548652799336 | ERHA | Fanny |  |  |
| 7494748231736592749 | Finally Found You | Fanny |  | Fanny Putri Fernanda |
| 7495634419875220215 | Judydoll Indonesia | Fanny |  |  |
| 7494854118469765333 | Katia Collections | Fanny |  |  |
| 7494656771777596182 | LABORE | Fanny |  |  |
| 7493990262625109760 | makeoverid | Fanny |  |  |
| 7496019554130888970 | Medicube Indonesia | Fanny |  |  |
| 7495228315098515899 | minisoshopid | Fanny |  |  |
| 7495293503028562237 | MlenDiaryID | Fanny |  | Fanny Putri Fernanda |
| 7494083526714558174 | Mukena Ayzara | Fanny |  |  |
| 7494839777434241358 | MUKENA.AMINAH | Fanny |  | Fanny Putri Fernanda |
| 7494698874318654145 | Neoalgae Official | Fanny |  |  |
| 7494735752283785875 | Noni Magic | Fanny |  | Fanny Putri Fernanda |
| 7495597609928788046 | OMRON Healthcare ID | Fanny |  |  |
| 7494432922944572288 | P&G Store | Fanny |  | Fanny Putri Fernanda |
| 7494600208527362201 | perfectwhiteseries | Fanny |  |  |
| 7493994870019556382 | raeccaid | Fanny |  |  |
| 7494002318068516091 | Rosé All Day Cosmetics | Fanny |  |  |
| 7494521006737033571 | SAFF & Co. | Fanny |  |  |
| 7494083391869387815 | Samono Indonesia | Fanny |  |  |
| 7494763862183872809 | Sepatu Kanky | Fanny |  |  |
| 7494524380528937142 | SHIJI. | Fanny |  | Fanny Putri Fernanda |
| 7494919300905863950 | Shinzui | Fanny |  | Fanny Putri Fernanda |
| 7495209408569313450 | Sidomuncul Tolak Angin / tokosekarwangi |  | ya |  |
| 7495500107169171632 | SOME BY MI SHOP | Fanny |  |  |
| 7494914015393057526 | Swisse - Indonesia | Fanny |  | Fanny Putri Fernanda |
| 7495811548760148272 | Tirtir Indonesia | Fanny |  |  |
| 7495188891025442904 | Toshiba TV Official Store | Fanny |  |  |
| 7495036815769701000 | Uwwais store | Fanny |  | Fanny Putri Fernanda |
| 7493999781643847575 | wardahbeautyid | Fanny |  | Fanny Putri Fernanda |
| 7494191970187446916 | Youvit for life | Fanny |  | Fanny Putri Fernanda |
| 7495712062124952311 | Yves Rocher Indonesia | Fanny |  |  |
| 7494374563450226664 | Zegavit Gummy | Fanny |  |  |

## 5. Niche
### 5a. Usulan penggabungan ejaan (TIDAK digabung otomatis)
| Nilai sheet | Usulan | Jumlah brand | Catatan |
|---|---|---|---|
| Personal care | Beauty & Personal Care | 4 | ejaan/kategori induk TikTok |
| Mom & baby | Baby & Maternity | 7 | kategori TikTok = Baby & Maternity |
| Fashion | Womenswear & Underwear / Menswear & Underwear / Muslim Fashion | 23 | terlalu umum — pilih kategori TikTok |
| Lifestyle | Home & Living / Fashion Accessories | 21 | bukan kategori TikTok |

### 5b. Brand tanpa niche
| Baris | Brand | Shop ID |
|---|---|---|
| 29 | Amarome.Naturals | 7494672391771818169 |
| 141 | Cottonela.idn | 7494705179784546170 |

## 6. Peringatan per baris (tetap dimuat)
| Baris | Brand | Peringatan |
|---|---|---|
| 13 | Advance DIgitals Store | GMV TAP tidak terbaca: "couldn't found" |
| 467 | MIORIO | Status kosong → disimpan NULL |
| 535 | nusantarahelm | Exp Date "3/1/2027" ambigu (dibaca hari/bulan → 2027-01-03) — mohon cek |
| 745 | USMILE | Status kosong → disimpan NULL |
| 757 | Vibrant Glamour | Status kosong → disimpan NULL |

## 7. Baris produksi yang TIDAK ada di sheet (kandidat dihapus / dinonaktifkan)
Baris yang masih direferensikan FK TIDAK boleh di-hard-delete → usulan soft-deactivate (`deactivated_at`).
| ID | Brand | Shop ID | Status | Referensi FK | Usulan |
|---|---|---|---|---|---|
| DEAL-25VDA | Femmy | (kosong) | Stop | — | boleh dihapus / dinonaktifkan |
| DEAL-3CKKW | Glughava | 147607132 | Running Bulan Pertama | cooperating_shops: 1, campaign_requests: 1 | soft-deactivate (masih direferensikan) |
| DEAL-5BXMK | testingShopName | 123123 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-5ST5K | Sulwhasoo Indonesia | 2143151 | — | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-7QSSX | Raja Karpet | 7494701207877225245 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-AWVPK | Zeea.Official Store | (kosong) | Stop | — | boleh dihapus / dinonaktifkan |
| DEAL-GXCBF | MLEN DIARY | 7495293503028562237 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-HPV5P | Madame Gie | (kosong) | Running Bulan Pertama | — | boleh dihapus / dinonaktifkan |
| DEAL-HZRTW | Sattelite of Glow | (kosong) | Stop | — | boleh dihapus / dinonaktifkan |
| DEAL-KMH5J | P&G Store | 7645028054468724498 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-M4YXK | Wardah | (kosong) | Running Bulan Pertama | live_schedule_slots: 1 | soft-deactivate (masih direferensikan) |
| DEAL-Q3FQZ | Shinzui Shop | 7494919300905863950 | Running Bulan Pertama | — | boleh dihapus / dinonaktifkan |
| DEAL-Q3TJJ | Femmy | (kosong) | Running Bulan Pertama | — | boleh dihapus / dinonaktifkan |
| DEAL-QVBW8 | NONIMAGIC OFFICIAL STORE | 7494735752283785875 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-RAXJD | Sattelite of Glow | (kosong) | — | live_schedule_slots: 1 | soft-deactivate (masih direferensikan) |
| DEAL-TEST01 | Skintific Official Store | 7495001001 | Running Bulan Pertama | deal_products: 3 | soft-deactivate (masih direferensikan) |
| DEAL-TEST02 | Erigo Store | 7495002002 | Running Bulan Pertama | deal_products: 1 | soft-deactivate (masih direferensikan) |
| DEAL-TEST03 | Wardah Beauty | 7495003003 | Hold | — | boleh dihapus / dinonaktifkan |
| DEAL-U24US | Wardahbeautyid | 7493999781643847575 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |
| DEAL-VFN6U | Bintang Toedjoe Store | 7494083427604399900 | Stop | cooperating_shops: 1, campaign_requests: 56, deal_live_sessions: 39, deal_creator_proposals: 47, deal_products: 1 | soft-deactivate (masih direferensikan) |
| DEAL-YSC6Z | Wardah | (kosong) | Running Bulan Pertama | — | boleh dihapus / dinonaktifkan |
| DEAL-ZB6QW | Berkahfashion89 | 7494083372748212051 | Running Bulan Pertama | cooperating_shops: 1 | soft-deactivate (masih direferensikan) |

## 8. UPDATE — diff per field
| ID | Brand | Shop ID | Field | Sebelum | Sesudah |
|---|---|---|---|---|---|
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | bizdev_label | — | Alya |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | status | Running Bulan Pertama | Reguler |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | niche | — | Beauty & Personal Care |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | nama_grup | — | (ada, disembunyikan) |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | gmv_tap | — | 1095105 |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | avg_price | — | 250000 |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | leads_type | — | Internal TAP |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | campaign_name | — | Maybelline, 3CE, L'Oreal |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | campaign_id | — | 7592819782115821330 |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | exp_date | — | 2026-10-31 |
| DEAL-AHCAD | 3CE Indonesia | 7496114913756744244 | shop_code | — | IDLC2ATLWSU |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | bizdev_label | — | Laila S |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | status | Running Bulan Pertama | Reguler |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | niche | — | Fashion |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | gmv_tap | — | 3707303 |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | avg_price | — | 120000 |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | support_types | — | Sample, Flash Sale |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | ads_brand | — | Tidak Support Ads |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | leads_type | — | China |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | priority | — | P2 |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | campaign_id | — | 7579983660942706453 |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | exp_date | — | 2027-06-17 |
| DEAL-PYSUV | Ayucitra Fashion | 7493993157318051090 | shop_code | — | IDLCYLLLAN |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | bizdev_label | — | Laila S |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | status | Running Bulan Pertama | Reguler |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | niche | — | Health |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | avg_price | — | 75000 |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | leads_type | — | Internal TAP |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | campaign_name | — | Matchmaking Top Creator 3.0 - MEA Digital Agency |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | campaign_id | — | 7611476489859188487 |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | exp_date | — | 2027-02-21 |
| DEAL-XTX6C | Betadine Shop | 7494881384198474181 | shop_code | — | IDLC4SLW76 |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | bizdev_label | — | Non BD Hande |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | status | Running Bulan Pertama | Reguler |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | niche | — | Beauty & Personal Care |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | nama_grup | — | (ada, disembunyikan) |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | avg_price | — | 200000 |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | ads_brand | — | Brand Barcode Bulking - Cek BD |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | working_sheet | — | Buds x MEA |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | campaign_id | — | 7579983660942706453 |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | exp_date | — | 2027-10-31 |
| DEAL-ENFHB | Buds Organics Indonesia | 7494083694437893783 | shop_code | — | IDLC2TLL6F |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | bizdev_label | — | Laila S |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | status | Running Bulan Pertama | Reguler |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | niche | — | Beauty & Personal Care |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | nama_grup | — | (ada, disembunyikan) |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | gmv_tap | — | 0 |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | avg_price | — | 250000 |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | leads_type | — | Internal TAP |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | campaign_name | — | MEA Influencer X Brand - TAP |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | campaign_id | — | 7563124707795584789 |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | exp_date | — | 2026-12-31 |
| DEAL-5BASF | Cerave Indonesia | 7495725536740870256 | shop_code | — | IDLCK8LT92 |
| DEAL-JATUM | facetologystore | 7494518382967229229 | bizdev_label | — | Laila S |
| DEAL-JATUM | facetologystore | 7494518382967229229 | status | Running Bulan Pertama | Retention |
| DEAL-JATUM | facetologystore | 7494518382967229229 | niche | — | Beauty & Personal Care |
| DEAL-JATUM | facetologystore | 7494518382967229229 | avg_price | — | 50000 |
| DEAL-JATUM | facetologystore | 7494518382967229229 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-JATUM | facetologystore | 7494518382967229229 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-JATUM | facetologystore | 7494518382967229229 | leads_type | — | China |
| DEAL-JATUM | facetologystore | 7494518382967229229 | campaign_name | — | vikahere X Brand |
| DEAL-JATUM | facetologystore | 7494518382967229229 | campaign_id | — | 7578644933704664853 |
| DEAL-JATUM | facetologystore | 7494518382967229229 | exp_date | — | 2026-11-25 |
| DEAL-JATUM | facetologystore | 7494518382967229229 | shop_code | — | IDLC3DLLVW |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | bizdev_label | — | Laila S |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | status | Running Bulan Pertama | Reguler |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | niche | — | Beauty & Personal Care |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | nama_grup | — | (ada, disembunyikan) |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | gmv_tap | — | 16573896 |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | avg_price | — | 100000 |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | leads_type | — | Minishowcase |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | priority | — | P1 |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | campaign_name | — | BHPC x MEA |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | campaign_id | — | 7511580962423211792 |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | exp_date | — | 2027-02-28 |
| DEAL-VKDVT | Glowsicha Indonesia | 7495304714025077543 | shop_code | — | IDLCFGW774 |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | bizdev_label | — | Laila S |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | status | Running Bulan Pertama | Reguler |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | niche | — | Beauty & Personal Care |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | working_sheet | — | HAQUHARA X MEA (Tiktok) |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | campaign_name | — | BHPC 2.0 x MEA |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | campaign_id | — | 7654430588150220562 |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | exp_date | — | 2027-06-17 |
| DEAL-Q2MFA | Haquhara | 7493994407041271768 | shop_code | — | IDLCXLLLTN |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | bizdev_label | — | Laila S |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | status | Running Bulan Pertama | Reguler |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | niche | — | Beauty & Personal Care |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | nama_grup | — | (ada, disembunyikan) |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | gmv_tap | — | 132890 |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | avg_price | — | 100000 |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | leads_type | — | Internal TAP |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | campaign_name | — | Maybelline, 3CE, L'Oreal |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | campaign_id | — | 7628158556608448264 |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | exp_date | — | 2027-01-31 |
| DEAL-Q93TH | L'Oreal Paris Haircare | 7496100006925011248 | shop_code | — | IDLCQPTLWP2 |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | bizdev_label | — | Alya |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | status | Running Bulan Pertama | Reguler |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | niche | — | Beauty & Personal Care |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | nama_grup | — | (ada, disembunyikan) |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | gmv_tap | — | 1004939 |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | avg_price | — | 150000 |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | leads_type | — | Internal TAP |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | campaign_name | — | Maybelline, 3CE, L'Oreal |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | campaign_id | — | 7592819782115821330 |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | exp_date | — | 2027-01-31 |
| DEAL-F57JE | L'Oreal Paris Indonesia | 7494420619288217834 | shop_code | — | IDLCQ4LLJC |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | bizdev_label | — | Laila S |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | status | Running Bulan Pertama | Reguler |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | niche | — | Beauty & Personal Care |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | avg_price | — | 155000 |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | campaign_name | — | vikahere X Brand |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | campaign_id | — | 7578644933704664853 |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | exp_date | — | 2026-11-25 |
| DEAL-2B2WU | L'Oréal Professionnel ID | 7495817678334494753 | shop_code | — | IDIDLCKCLFRT |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | bizdev_label | — | Laila S |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | status | Running Bulan Pertama | Reguler |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | niche | — | Beauty & Personal Care |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | nama_grup | — | (ada, disembunyikan) |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | gmv_tap | — | 1543697 |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | avg_price | — | 300000 |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | leads_type | — | Internal TAP |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | campaign_name | — | MEA Influencer X Brand - TAP |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | campaign_id | — | 7563124707795584789 |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | exp_date | — | 2026-12-31 |
| DEAL-P3WTE | La Roche Posay | 7494929988145220466 | shop_code | — | IDLCDCL229 |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | bizdev_label | — | Laila S |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | status | Running Bulan Pertama | Reguler |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | niche | — | Baby & Maternity |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | avg_price | — | 67500 |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | campaign_name | — | Matchmaking Top Creator 3.0 - MEA Digital Agency |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | campaign_id | — | 7611476489859188487 |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | exp_date | — | 2027-02-21 |
| DEAL-ZZBGC | Loluna Official | 7495182677925792112 | shop_code | — | IDLCTXWA4M |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | bizdev_label | — | Laila S |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | status | Running Bulan Pertama | Reguler |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | niche | — | Beauty & Personal Care |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | nama_grup | — | (ada, disembunyikan) |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | gmv_tap | — | 85591541 |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | avg_price | — | 100000 |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | ads_brand | — | Daily (Barcode/Invoicing) |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | leads_type | — | Celebrity |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | priority | — | P1 |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | campaign_name | — | Maybelline, 3CE, L'Oreal |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | campaign_id | — | 7592819782115821330 |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | exp_date | — | 2027-01-31 |
| DEAL-SSYD2 | Maybelline Indonesia | 7494048773396071648 | shop_code | — | IDLCDLLLXM |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | bizdev_label | — | Laila S |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | status | Running Bulan Pertama | Reguler |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | niche | — | Health |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | nama_grup | — | (ada, disembunyikan) |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | gmv_tap | — | 3203082 |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | avg_price | — | 120000 |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | leads_type | — | Celebrity |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | campaign_id | — | 7579983660942706453 |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | exp_date | — | 2026-12-31 |
| DEAL-ANHE4 | Moorkoedal.Id | 7495986821446798305 | shop_code | — | IDLCYSWLWDE |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | bizdev_label | — | Fanny, Laila S |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | status | Running Bulan Pertama | Reguler |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | niche | — | Muslim Fashion |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | nama_grup | — | (ada, disembunyikan) |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | gmv_tap | — | 160869 |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | avg_price | — | 70000 |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | ads_brand | — | Brand Barcode Bulking - Cek BD |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | leads_type | — | Celebrity |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | working_sheet | — | Mukena Aminah (All Creators) X MEA |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | campaign_id | — | 7579983660942706453 |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | exp_date | — | 2026-12-31 |
| DEAL-JR28W | MUKENA.AMINAH | 7494839777434241358 | shop_code | — | IDLCAPLWJ2 |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | bizdev_label | — | Alya |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | niche | — | Health |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | nama_grup | — | (ada, disembunyikan) |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | avg_price | — | 200000 |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | ads_brand | — | Brand Invoice Bulking - Cek BD |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | leads_type | — | Internal TAP |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | working_sheet | — | NOW FOODS X MEA |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | campaign_name | — | Matchmaking Top Creator 3.0 - MEA Digital Agency |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | campaign_id | — | 7611476489859188487 |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | exp_date | — | 2027-02-21 |
| DEAL-MU74W | Now Foods indonesia | 7494854818827700648 | shop_code | — | IDLCDDLWM8 |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | bizdev_label | — | Laila S |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | status | Running Bulan Pertama | Reguler |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | niche | — | Beauty & Personal Care |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | nama_grup | — | (ada, disembunyikan) |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | gmv_tap | — | 0 |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | avg_price | — | 75000 |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | leads_type | — | Matchmaking |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | campaign_name | — | FASHION & BEAUTY X MEA |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | campaign_id | — | 7563124707795584789 |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | exp_date | — | 2026-12-31 |
| DEAL-GSP2U | npureofficial | 7493991957026932115 | shop_code | — | IDLCELLLWC |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | bizdev_label | — | Dania Tiffany |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | status | Running Bulan Pertama | Retention |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | niche | — | Beauty & Personal Care |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | nama_grup | — | (ada, disembunyikan) |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | gmv_tap | — | 9011994 |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | avg_price | — | 50000 |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | support_types | — | Sample |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | ads_brand | — | Daily (Barcode/Invoicing) |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | leads_type | — | Celebrity |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | campaign_name | — | MEA Influencer X Brand - TAP |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | campaign_id | — | 7563124707795584789 |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | exp_date | — | 2026-12-31 |
| DEAL-QJCEC | Purbasari Indonesia | 7494083658890053184 | shop_code | — | IDLC6TLL8E |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | bizdev_label | — | Laila S |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | status | Running Bulan Pertama | Reguler |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | niche | — | Menswear & Underwear |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | nama_grup | — | (ada, disembunyikan) |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | gmv_tap | — | 4479178 |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | avg_price | — | 150000 |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | leads_type | — | Internal TAP |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | campaign_name | — | FASHION & BEAUTY X MEA |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | campaign_id | — | 7594564844172330773 |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | exp_date | — | 2026-12-31 |
| DEAL-YYTHG | Ryusei | 7494083411718276575 | shop_code | — | IDLCDLLL3M |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | bizdev_label | — | Alya |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | status | Running Bulan Pertama | Hold |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | niche | — | Health |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | nama_grup | — | (ada, disembunyikan) |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | avg_price | — | 75000 |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | leads_type | — | Internal TAP |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | campaign_name | — | Matchmaking Top Creator 3.0 - MEA Digital Agency |
| DEAL-P4NEC | Sahabat Kesehatan | 7495001424040659912 | shop_code | — | IDLCWCW7J4 |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | bizdev_label | — | Fanny, Laila S |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | status | Running Bulan Pertama | Reguler |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | niche | — | Fashion |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | nama_grup | — | (ada, disembunyikan) |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | avg_price | — | 100000 |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | campaign_name | — | Mix Category - MEA Digital Marketing |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | campaign_id | — | 7631060847046117128 |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | exp_date | — | 2027-03-01 |
| DEAL-S2WCW | SHIJI. | 7494524380528937142 | shop_code | — | IDLC7DLLBK |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | bizdev_label | — | Laila S |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | status | Running Bulan Pertama | Reguler |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | niche | — | Muslim Fashion |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | nama_grup | — | (ada, disembunyikan) |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | gmv_tap | — | 0 |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | support_types | — | Sample, Flash Sale |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | ads_brand | — | Tidak Support Ads |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | leads_type | — | Internal TAP |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | campaign_name | — | MEA Influencer X Brand - TAP |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | campaign_id | — | 7563124707795584789 |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | exp_date | — | 2026-12-31 |
| DEAL-NXC6Z | THENBLANK | 7494729079531145300 | shop_code | — | IDLCD3WWEA |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | bizdev_label | — | Laila S |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | status | Running Bulan Pertama | Hold |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | niche | — | Womenswear & Underwear |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | gmv_tap | — | 2891807 |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | avg_price | — | 120000 |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | leads_type | — | China |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | campaign_id | — | 7579983660942706453 |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | exp_date | — | 2026-12-31 |
| DEAL-6SUWY | TT Mode wanita | 7495481862045141587 | shop_code | — | IDLCS4W8BU |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | bizdev_label | — | Fanny, Laila S |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | status | Running Bulan Pertama | Reguler |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | niche | — | Fashion |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | contact_pic_brand | — | (ada, disembunyikan) |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | nama_grup | — | (ada, disembunyikan) |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | avg_price | — | 235000 |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | ads_brand | — | Brand Barcode Bulking - Cek BD |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | working_sheet | — | Uwwaisstore x MEA TIKTOK |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | campaign_name | — | Mix Category - MEA Digital Marketing |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | campaign_id | — | 7631060847046117128 |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | exp_date | — | 2027-03-01 |
| DEAL-7HFTZ | Uwwais store | 7495036815769701000 | shop_code | — | IDLCPBWYMA |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | bizdev_label | — | Laila S |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | status | Running Bulan Pertama | Reguler |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | niche | — | Shoes |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | gmv_tap | — | 875805 |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | avg_price | — | 120000 |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | support_types | — | Sample, Flash Sale, Ads |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | ads_brand | — | Ads By Brand - Minta Barcode |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | leads_type | — | China |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | campaign_name | — | Matchmaking Top Creator 2.0 - MEA Digital Agency |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | campaign_id | — | 7579983660942706453 |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | exp_date | — | 2026-12-31 |
| DEAL-F94FK | VIVI NICI | 7494422182333614375 | shop_code | — | IDLC64LLWD |

## 9. INSERT
| Baris | Brand | Shop ID | Status | Niche | Bizdev | Exp Date |
|---|---|---|---|---|---|---|
| 3 | 20Mefree | 7494972658027039598 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 4 | 2Tang & Tjatoet Official | 7495791507057838382 | Reguler | Food & Beverages | Non BD Hande | 2026-11-25 |
| 6 | 4nngelbeauty | 7494650348365580515 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 7 | abayacollection12 | 7494897158220056747 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-31 |
| 8 | ABC Heinz Shop | 7494761761994017029 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 9 | Acome Indonesia | 7493991045969577150 | Reguler | Phones & Electronics | Laila S | 2027-01-31 |
| 10 | Adhinatacollection | 7494741121487243314 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 11 | ADVAN INDONESIA | 7494083562202629991 | Retention | Phones & Electronics | Alya | 2027-01-23 |
| 12 | ADVAN NOTEBOOK | 7495274674923998006 | Running Bulan Pertama | Phones & Electronics | Alya | 2027-01-31 |
| 13 | Advance DIgitals Store | 7494083752709293123 | Hold | Home & Living | Alya | 2026-12-31 |
| 14 | AELYS ID | 7495140008225376871 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 15 | Aestika Hair Coloring | 7495680123461471144 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 16 | Affiliate Akademi Indonesia | 7494907100201519964 | Reguler | Books, Magazines & Audio | Non BD Hande | 2026-09-03 |
| 17 | Affiliate Akademi Kreatif | 7495956547897887374 | Reguler | Books, Magazines & Audio | Non BD Hande | 2026-03-04 |
| 18 | Afha Fashion Galery | 7494246858222175509 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 19 | Aftermyskin | 7495618796463819220 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 20 | agefree.id | 7495475168838912239 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 21 | AITU.ID | 7494000401535502002 | Reguler | Baby & Maternity | Non BD Hande | 2026-11-30 |
| 22 | Alba Electric | 7495129251793504381 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 23 | Alethea.batik | 7494785966796213059 | Reguler | Menswear & Underwear | Non BD Hande | 2027-03-24 |
| 24 | Algaena Official Store | 7495801750238038962 | Reguler | Health | Non BD Hande | 2027-02-21 |
| 25 | Alifs Bakery N Cookies | 7494865459938691187 | Reguler | Food & Beverages | Non BD Hande | 2026-06-13 |
| 26 | AlloraBoutiqueOfficial | 7495476479509694926 | Reguler | Muslim Fashion | Non BD Hande | 2024-09-30 |
| 27 | ALUS.CO | 7495853121750796966 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 28 | Alvarocollection | 7494083431405946241 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 29 | Amarome.Naturals | 7494672391771818169 | Reguler | — | Non BD Hande | 2027-01-31 |
| 30 | Amaterasun | 7494817243297581566 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 31 | AMBERYS | 7494141895778010323 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 32 | amei アメイ | 7494552982189541833 | Reguler | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 33 | Amestan | 7496100090953566882 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 34 | Amiraderm | 7494886250664921791 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 35 | AMOREPACIFIC Hair&Beauty Shop | 7494997478679743213 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 36 | Amortals Indonesia | 7496291654045632778 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 37 | An Nahl Fashion | 7494600532776027873 | Reguler | Muslim Fashion | Non BD Hande | 2027-06-12 |
| 38 | Ando Official Store | 7494083375538931387 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 39 | Anessa Indonesia | 7494033681309861696 | Retention | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 40 | Animate | 7494534933580187896 | Reguler | Beauty & Personal Care | Laila S | 2026-12-31 |
| 41 | Anjalie Factory | 7494656817002875561 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-31 |
| 42 | ANUA Indonesia | 7495151047335905832 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 43 | Aolon | 7494083744117786373 | Reguler | Fashion Accessories | Non BD Hande | 2026-12-31 |
| 44 | ARCELL STORE | 7494083549162996908 | Reguler | Luggage & Bags | Non BD Hande | 2026-12-31 |
| 45 | Arizona Carpet | 7495041153448970397 | Reguler | Home & Living | Non BD Hande | 2026-12-05 |
| 46 | ARLGALERY COLLECTION | 7495054254369311053 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 47 | Asaya Ind | 7495515976466860850 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 48 | Asoka | 7494083458542896532 | Reguler | Fashion Accessories | Non BD Hande | 2027-02-21 |
| 49 | Asyifa Konveksi | 7494897074521934804 | Reguler | Muslim Fashion | Non BD Hande | 2027-02-28 |
| 50 | ATHOME | 7494083718140561084 | Reguler | Home & Living | Non BD Hande | 2026-10-31 |
| 51 | Attalwin Official Store | 7495324765352987383 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-31 |
| 52 | Auradia Skincare | 7495837463550396942 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 53 | AUTOMOTIVELED | 7494811603992610963 | Retention | Automotive & Motorcycle | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 54 | Autovision | 7494778530933148320 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-11-25 |
| 55 | Aveeno Baby ID | 7494288416611337574 | Reguler | Mom & baby | Laila S, Dania Tiffany | 2026-12-31 |
| 56 | AVELOGYFRAGRANCE | 7495293843423857344 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 57 | Avitaskin | 7496100045109037965 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 59 | azarinecosmetic | 7494002289927030680 | Reguler | Beauty & Personal Care | Laila S | 2027-06-17 |
| 60 | Azilfa Medika | 7494558675050269080 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 61 | Azrina Beauty | 7494083356089419649 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 62 | Baby Millenial | 7495085189702191175 | Retention | Food & Beverages | M Yaumal Mizan Firdaus, Erlina sri utami | 2026-12-31 |
| 63 | BabyCarrot.ID | 7495829872360065583 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 64 | babysultan | 7494511046331107946 | Reguler | Baby & Maternity | Non BD Hande | 2026-12-31 |
| 65 | BAGINBAGOfficial | 7495554470471961402 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 66 | BAGSMART Indonesia | 7495303488119605341 | Reguler | Sports & Outdoor | Alya | 2026-12-31 |
| 67 | Bajumurah | 7494083608936744011 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 68 | barenbliss | 7494418603289381491 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 69 | Baseus Indonesia Store | 7495453944971823688 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 72 | Bata Indonesia | 7494083531875452587 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 73 | BDN DR BOYKE | 7494634700630624678 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-07-31 |
| 74 | Beauty of Joseon Indonesia | 7494913072461286296 | Reguler | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 75 | Bebigoo.id | 7495922518118730423 | Reguler | Baby & Maternity | Non BD Hande | 2027-03-01 |
| 76 | Bebliss Indonesia | 7494651199031970479 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 77 | Bed Story | 7495105664079071500 | Reguler | Furniture | Non BD Hande | 2027-01-23 |
| 78 | Bestie Skin | 7496262987750804263 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 80 | beve korea | 7494083378800198893 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 81 | Bhatara Batik | 7494760761228102038 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 82 | BIC MALL | 7495677585433397637 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 83 | Bigroot | 7494531978318481555 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 84 | Bintang leather | 7494837873396124586 | Running Bulan Pertama | Fashion Accessories | Fanny, Laila S | 2026-11-30 |
| 87 | BIODEF | 7494662193662560601 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 88 | Bioderma Indonesia | 7494699675745159747 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 89 | biolage.indonesia | 7494940460176214800 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 90 | Biotek Farmasii Indonesia | 7494694908729198915 | Reguler | Health | Non BD Hande | 2026-07-31 |
| 91 | Blackmores Official | 7495816200401750342 | Retention | Baby & Maternity | Alya | 2027-02-21 |
| 92 | Bloom Up Beauty | 7494873053634922669 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 93 | BossCase | 7495967012034873928 | Reguler | Phones & Electronics | Non BD Hande | 2026-12-31 |
| 94 | Bossnack.id | 7494264212476822892 | Reguler | Food & Beverages | Non BD Hande | 2026-11-30 |
| 95 | Botare Indonesia | 7496048820540312568 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 98 | BRAVEKIDS FASHION | 7495060646109088711 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 99 | Braven Perfume | 7495676835953805708 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2027-06-17 |
| 100 | Bravhom Official Indonesia | 7495475070415112603 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 101 | Bravhom Personal Care | 7495475212053285594 | Running Bulan Pertama | Lifestyle | Alya | 2026-12-31 |
| 102 | brighty.id | 7493989966408419235 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 103 | BROMEN STORE | 7494083349998634786 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-30 |
| 104 | browieofficial | 7493992479185274020 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 105 | BRUGGMAN.STORE | 7494608116311624104 | Stop | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 106 | Buavita | 7494925848126982530 | Reguler | Food & Beverages | Non BD Hande | 2027-02-21 |
| 108 | Bumbu Bamboe Official | 7494629815387458175 | Reguler | Food & Beverages | Non BD Hande | 2026-11-30 |
| 109 | Bumbu Bunda Official Shop | 7494083410172150843 | Reguler | Mom & baby | Laila S | 2026-12-31 |
| 110 | Bunama store | 7494923644654618729 | Reguler | Menswear & Underwear | Non BD Hande | 2024-04-30 |
| 111 | Buttered | 7494798225955457303 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-17 |
| 112 | ByeoldeOfficial | 7495390547510987586 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 113 | caca beautyy | 7495479795693291993 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 114 | Calbi | 7494556858931841278 | Reguler | Shoes | Non BD Hande | 2027-01-31 |
| 115 | CANIKOREA | 7494511839892310488 | Reguler | Shoes | Non BD Hande | 2024-04-30 |
| 116 | Captain Cemilan | 7495083875561015754 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 117 | Careso | 7494072581986616825 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 118 | Cartiera Indonesia | 7494945882972129741 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 119 | CBD Professional | 7494535662913816982 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 120 | Ceceu Sajodo | 7494947127632104394 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 122 | Ceria Kutex Henna | 7494500847481752222 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 123 | Cetaphil Indonesia | 7494083592855389916 | Reguler | Beauty & Personal Care | Dania Tiffany | 2027-02-28 |
| 124 | Chacha'store | 7495042152587103084 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 125 | Cimory Indonesia | 7495149753706122212 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-06-30 |
| 126 | CIVAGO ID | 7495162254389775024 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 127 | clanish.id | 7494630600567786301 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 128 | Cleorabeauty.id | 7494083353344902436 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-10-29 |
| 129 | Clesmirra | 7495190067541871377 | Reguler | Food & Beverages | Non BD Hande | 2026-01-21 |
| 130 | Clinelleid | 7494700549092772338 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 131 | Clogent | 7495915977169340429 | Reguler | Home & Living | Non BD Hande | 2027-01-23 |
| 132 | Colgate Palmolive Indonesia | 7494598689875462188 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 133 | comvita.id | 7494903542979136397 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 135 | COOGER Indonesia | 7494001692248016281 | Reguler | Home & Living | Alya | 2026-12-31 |
| 136 | Coolvita Indonesia | 7494441594609830017 | Running Bulan Pertama | Health | Alya | 2026-12-31 |
| 137 | COROLLA Shoes Shop | 7495310213706451032 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 138 | COSRX ID | 7494738145561315657 | Running Bulan Pertama | Beauty & Personal Care | Laila S | 2026-11-25 |
| 139 | Cotton Mom | 7495107188883098372 | Reguler | Kids' Fashion | Non BD Hande | 2026-02-07 |
| 140 | Cotton Well | 7494682413468846956 | Reguler | Menswear & Underwear | Non BD Hande | 2026-10-31 |
| 141 | Cottonela.idn | 7494705179784546170 | Reguler | — | Non BD Hande | — |
| 142 | cottonella.idn | 7494705179784546170 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-12 |
| 143 | CPPETINDO Official Shop | 7494466771667290340 | Reguler | Pet Supplies | Non BD Hande | 2027-01-31 |
| 144 | Crusita Official | 7494466814323886133 | Running Bulan Pertama | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 145 | Crystallure | 7494661985178126951 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 146 | Cuculemon Bottle | 7496302964766706617 | Reguler | Kitchenware | Alya | 2027-01-23 |
| 147 | Cyskin by Calysta | 7494605305081465092 | Reguler | Beauty & Personal Care | Non BD Hande | 2025-03-24 |
| 148 | d'Alba Indonesia | 7495118023333678027 | Reguler | Beauty & Personal Care | Dania Tiffany | 2026-08-31 |
| 149 | Daily Care by Unilever | 7495181208386570479 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2026-12-31 |
| 150 | Daily Food ID | 7494359999668782878 | Reguler | Food & Beverages | Non BD Hande | 2027-02-21 |
| 151 | Dalezz Foods Indonesia | 7494324121989383391 | Reguler | Food & Beverages | Non BD Hande | 2027-02-21 |
| 152 | Dapoer Kuno | 7494083457871087340 | Reguler | Food & Beverages | Non BD Hande | 2027-01-31 |
| 153 | DasterBeauty | 7494083493681596260 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 154 | DAZZLE ME Indonesia | 7494540729581276041 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 155 | De Lana Beautiaura | 7495104335190264546 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 156 | Dear Me Beauty | 7493990045206545915 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 157 | DEARY CO. BALI | 7494935791857011037 | Reguler | Fashion Accessories | Non BD Hande | 2027-02-28 |
| 158 | DEFINITESTORE | 7494481057935886403 | Reguler | Home Improvement | Non BD Hande | 2024-04-01 |
| 159 | Delto Shop/antangin | 7494556635593411484 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 160 | Deorex | 7493995135107106184 | Reguler | Beauty & Personal Care | Dania Tiffany | 2027-02-21 |
| 161 | Deoxide Official | 7496110970150160399 | Hold | Beauty & Personal Care | Laila S | 2026-11-25 |
| 162 | Derma Angel ID | 7496008100890380362 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 163 | DESIGNER DIY STORE | 7496180556914395721 | Reguler | Kids' Fashion | Non BD Hande | 2027-03-01 |
| 164 | Detogreen Store | 7495481399524035079 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 165 | Devaira.id | 7494083696149891040 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 166 | Dewiku Clinic | 7494083521291519930 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-08-24 |
| 167 | Dianable Shop | 7494516313736710658 | Reguler | Shoes | Non BD Hande | 2027-06-12 |
| 170 | disai88 | 7494646854129584688 | Reguler | Menswear & Underwear | Non BD Hande | 2026-12-31 |
| 171 | DLINE OS | 7494711184028502689 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-01-31 |
| 172 | DnA Hijab Fashion | 7494901335380101801 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 173 | DNS Store.idn | 7494083743141889846 | Reguler | Home Supplies | Non BD Hande | 2026-11-30 |
| 174 | DO.Skin by Donna Agnesia | 7495582868388743922 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-02-05 |
| 175 | Dorskin | 7494083411368510521 | Reguler | Beauty & Personal Care | Non BD Hande | 2025-09-30 |
| 176 | Dove | 7495181208386570479 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 177 | Dr Althea Indonesia | 7494326043695810057 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 178 | Dr Ekle's Skincare | 7494731573439203419 | Retention | Beauty & Personal Care | Non BD Hande | 2025-12-09 |
| 179 | dr. Lely I Qadizza Skincare | 7494507210719463634 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-01 |
| 180 | Dr.Spock Official Store | 7495783896379459872 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 181 | Dricha | 7494537453470190153 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 182 | DRINK DAYTONIC ID | 7496248533263943956 | Reguler | Food & Beverages | Non BD Hande | 2027-03-24 |
| 183 | DRVE | 7496031009988708422 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2027-06-17 |
| 184 | dsaviorofficial | 7494083398227953519 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-03-24 |
| 185 | DSE Dermascalp Expert | 7495814325752793546 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 186 | DTG Grup | 7495276102755190828 | Running Bulan Pertama | Home & Living | Alya | 2027-01-23 |
| 187 | Dua Belibis | 7494504946518690203 | Retention | Food & Beverages | Erlina sri utami, Laila S | 2026-12-31 |
| 188 | DURARYLION | 7495208014065929198 | Reguler | Menswear & Underwear | Non BD Hande | 2026-12-31 |
| 189 | DVARA | 7494906156684446033 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 190 | Dya.Collection | 7494354946109768857 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-03-24 |
| 191 | Dyesoo.id | 7495892971426450131 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 192 | Dyson | 7495152152248289572 | Reguler | Phones & Electronics | Dania Tiffany | 2027-01-23 |
| 193 | Earth Love Life | 7495189849472403838 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 194 | ecentio Official Shop | 7494019617815103057 | Reguler | Home & Living | Laila S | 2026-12-31 |
| 195 | Elastigen | 7495167161000036999 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 196 | elevenbasic | 7494759567023376499 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-06-12 |
| 197 | Elleina Probeauty | 7496260898856798596 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 198 | Eloi Coco | 7494675388393228628 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 199 | Elsheskin | 7493999882387293815 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 200 | ELVICTO | 7493996645226087753 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2027-02-28 |
| 201 | ElvictoFragrance.id | 7495763154162387463 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 202 | ELYORA.ID | 7494457288895072283 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-03-01 |
| 203 | Embryolisse Indonesia | 7495066992398469742 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 204 | eminacosmetics | 7493997608841152075 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-17 |
| 205 | ENCHEN PERSONAL CARE | 7495475025526033107 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 206 | erafood | 7495759919796160784 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 207 | ERHA | 7494083548652799336 | Reguler | Beauty & Personal Care | Fanny, Laila S | 2027-06-17 |
| 208 | Erincollection01 | 7494493012228737854 | Reguler | Fashion Accessories | Non BD Hande | 2027-01-31 |
| 209 | Esqa Cosmetics | 7494597156705568891 | Running Bulan Pertama | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 210 | Etawaku Platinum | 7494547918922812323 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 211 | Etawaku Platinum Shop | 7494880432126135077 | Reguler | Health | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 212 | Etawalin Store | 7494733250585660194 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-11-25 |
| 213 | Etude Indonesia | 7496013178714359933 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 214 | Evangeline | 7494645330682546564 | Reguler | Fragrance | Laila S | 2026-12-31 |
| 215 | EVEBAG INDONESIA | 7494930968089234134 | Reguler | Phones & Electronics | Non BD Hande | 2027-02-28 |
| 216 | Expert | 7495515012143155767 | Reguler | Health | Non BD Hande | 2027-06-17 |
| 217 | Facerinna.indonesia | 7496239674854640316 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 219 | Fantech Smart Life | 7495193015255927481 | Reguler | Phones & Electronics | Non BD Hande | 2026-12-31 |
| 220 | FashionSpotGrosir | 7495301474942618093 | Reguler | Menswear & Underwear | Non BD Hande | 2026-12-31 |
| 221 | fassystore | 7493994095211939755 | Reguler | Women Bag | Non BD Hande | 2027-01-31 |
| 222 | Fastbikes Indonesia | 7495481479518784178 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-12-31 |
| 223 | Fifine Indonesia | 7496042140523464822 | Reguler | Phones & Electronics | Non BD Hande | 2027-03-01 |
| 224 | Fill The Room Fragrance | 7496229531934165942 | Hold | Beauty & Personal Care | Laila S | 2027-02-21 |
| 225 | Finally Found You | 7494748231736592749 | Retention | Beauty & Personal Care | Fanny, Laila S | 2027-02-28 |
| 226 | FIRPEC86 | 7494083413175207334 | Reguler | Kids' Fashion | Non BD Hande | 2027-03-24 |
| 227 | Fixcare Store | 7495865747921275406 | Reguler | Shoes | Non BD Hande | 2026-10-31 |
| 228 | flimbeauty.id | 7495212045229000936 | Retention | Health | Alya | 2027-02-28 |
| 229 | Flimcol By Flimbeauty | 7495212045229000936 | Reguler | Health | Non BD Hande | 2027-02-28 |
| 230 | Flimty Fiber | 7494055767719183761 | Retention | Food & Beverages | Alya | 2027-02-21 |
| 231 | FLSBeauteOfficial | 7494558948610312429 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-12-31 |
| 232 | Foca Kue Sachima Official | 7496203411210995779 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 233 | FOCA Sachima by AISA Food | 7496004098318895987 | Reguler | Food & Beverages | Non BD Hande | 2026-03-19 |
| 234 | FOCALLURE STORE | 7493997666171389058 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 239 | FOREBIE ACNE SKINCARE | 7494631963594164581 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 240 | Freemir | 7493995778015528220 | Running Bulan Pertama | Kitchenware | Alya | 2026-12-31 |
| 241 | Frisian Flag Official Store | 7494910991163689766 | Retention | Food & Beverages | Erlina sri utami, Laila S | 2026-11-25 |
| 242 | FSMILE SHOP | 7496153668546300122 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 243 | FTBW BOOK CORNER | 7495895662606387548 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 244 | Fuelin Official | 7495209002282552038 | Reguler | Health | Non BD Hande | 2026-11-30 |
| 245 | Fufumise Beauty | 7494780301503924922 | Reguler | Beauty & Personal Care | Laila S | 2027-03-01 |
| 246 | G-Power Official | 7494567036084980066 | Reguler | Phones & Electronics | Non BD Hande | 2026-10-31 |
| 247 | G&Zladybags | 7495819982416546773 | Reguler | Women Bag | Non BD Hande | 2027-02-28 |
| 248 | gaaborstore.id | 7494659397190977955 | Reguler | Home & Living | Non BD Hande | 2026-11-30 |
| 249 | Gabag Indonesia | 7494001668389897425 | Reguler | Baby & Maternity | Non BD Hande | 2027-03-24 |
| 250 | GAGA Shop Official Mie 100 | 7494831151462975864 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 251 | Gahalu | 7495956593763781546 | Reguler | Shoes | Non BD Hande | 2026-10-31 |
| 252 | Gain Yum Official | 7496031910742035328 | Reguler | Food & Beverages | Erlina sri utami, Alya | 2026-11-25 |
| 253 | GAMALEEA FASHION | 7493990301936354407 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-11-30 |
| 254 | Garnier Indonesia | 7494048805936399778 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 255 | GarudaLED Toko | 7494700544143821641 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-07-31 |
| 256 | Gendes id | 7495495321157536141 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-08-08 |
| 257 | Genskingdom | 7495490755927509890 | Reguler | Food & Beverages | Non BD Hande | — |
| 258 | Ghaya.outfit | 7494439618739669816 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-01-31 |
| 259 | GIRIK STORE | 7495076966450628959 | Reguler | Sports & Outdoor | Non BD Hande | 2024-06-30 |
| 260 | gitaglowofficial | 7494724494234585990 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 261 | glad2glow.indo | 7494807241590606114 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2026-12-31 |
| 262 | glamour.outfit | 7494698138665978770 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 263 | glamourdgp | 7495179543825254988 | Reguler | Computers & Office Equipment | Non BD Hande | 2027-03-24 |
| 264 | Glaranadi | 7494508207988378593 | Reguler | Food & Beverages | Non BD Hande | 2027-03-24 |
| 265 | Glise.id | 7495193124924328675 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-01-27 |
| 266 | gloow&be | 7495814429985900918 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 267 | GLOW FX | 7494734706184194419 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-11-25 |
| 268 | Glowing Skin is Gloskin | 7494849429404289755 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 270 | GLUGHAVA STORE | 7494083596463408348 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-30 |
| 271 | GMEELAN.ID | 7494664842103524187 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 272 | GO JILL GORDEN | 7495824148619430886 | Stop | Household Appliances | Non BD Hande | 2026-12-31 |
| 273 | Gohappy Store | 7494635277730745217 | Reguler | Kitchenware | Non BD Hande | 2026-12-31 |
| 274 | GOKOCO.ID | 7495001863012255803 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 275 | Gold Pigeon ID | 7494699656507328866 | Reguler | Menswear & Underwear | Non BD Hande | 2026-07-31 |
| 276 | Golden Up | 7494695197051750257 | Retention | Food & Beverages | Erlina sri utami, Alya | 2027-02-21 |
| 277 | Golden Us | 7494719215742388182 | Retention | Food & Beverages | Erlina sri utami, Alya | 2027-02-21 |
| 278 | Goldy Studio | 7494527496652557239 | Reguler | Fashion | Non BD Hande | — |
| 279 | goojodoq store | 7494043049082128084 | Reguler | Lifestyle | Non BD Hande | 2027-01-31 |
| 280 | GOOJODOQ.SHOP | 7494072976701228055 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 281 | Grandville Food | 7494547831600810815 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2027-01-31 |
| 282 | GRENEY.Underwear.id | 7494083724179703696 | Retention | Womenswear & Underwear | Alya | 2026-12-31 |
| 283 | Grosir Klamby | 7494083581858973019 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 284 | gwenza | 7494530650553354499 | Reguler | Muslim Fashion | Dania Tiffany | 2026-12-31 |
| 285 | GYBD COSMETIC STORE | 7495988273261546184 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 286 | H&H Skincare | 7494083747781968989 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2026-09-30 |
| 287 | HAJI SALMAN | 7494916758399519015 | Running Bulan Pertama | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 288 | HalloVin Daily | 7495476500237486572 | Reguler | Muslim Fashion | Non BD Hande | 2024-12-17 |
| 289 | Hanasui | 7494083639217390595 | Hold | Beauty & Personal Care | Alya | 2027-02-28 |
| 290 | Hannochs Official | 7494644448789433184 | Reguler | Home & Living | Non BD Hande | 2026-07-31 |
| 291 | Hansaplast Indonesia | 7494936513126894282 | Reguler | Health | Dania Tiffany | 2027-06-17 |
| 292 | Happy Family Storee | 7494083493978539781 | Reguler | Home Improvement | Non BD Hande | 2026-12-31 |
| 293 | Happysembako | 7495773180141734061 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 295 | Harletté | 7494489342982522898 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 296 | Heaven Lights | 7494020635315373567 | Reguler | Fashion | Dania Tiffany | 2027-04-30 |
| 297 | Heefn.id | 7495309904716860294 | Reguler | Phones & Electronics | Non BD Hande | 2027-12-31 |
| 298 | Heiji Active | 7496275732927711239 | Reguler | Sports & Outdoor | Non BD Hande | 2026-12-31 |
| 299 | Hello by Paseo Official | 7496007077727603353 | Reguler | Home Supplies | Non BD Hande | 2026-12-31 |
| 300 | Herba Budi Natura Store | 7495946241297320004 | Reguler | Food & Beverages | Non BD Hande | 2027-02-28 |
| 301 | HerbalIndonesia Store | 7494649622327298726 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 302 | Herborist Natural Care ID | 7494083492655236964 | Reguler | Beauty & Personal Care | Alya | 2027-02-28 |
| 303 | Hicoop | 7495815590762219955 | Reguler | Menswear & Underwear | Non BD Hande | 2027-03-24 |
| 304 | Hidden Vibe Memories Fragrance | 7494471067736968166 | Reguler | Fragrance | Non BD Hande | 2027-01-31 |
| 305 | Hijaberies | 7494083660856198996 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 306 | HijabZidny | 7494507720660191781 | Reguler | Muslim Fashion | Non BD Hande | 2025-01-09 |
| 307 | HINT Fragrance | 7495129287715359055 | Reguler | Fragrance | Non BD Hande | 2027-02-28 |
| 308 | HIQWEEN SKIN NUTRITION | 7495275963969866359 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 309 | HiVii Hijab | 7494831886478903582 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 310 | hmbl store | 7495295212646926791 | Reguler | Menswear & Underwear | Non BD Hande | 2024-09-05 |
| 311 | Holly scarf | 7495808226562116168 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 312 | Hollyland Indonesia | 7495210604119820621 | Reguler | Phones & Electronics | Non BD Hande | 2026-07-31 |
| 313 | holymoly parfum | 7494629782613821597 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 314 | Homega Indonesia | 7495783966080076474 | Reguler | Tools & Hardware | Non BD Hande | 2026-02-07 |
| 315 | honeyelens | 7494558812167702727 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-08-01 |
| 316 | Hongyada 0fficial Store | 7495021065839347765 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-09-06 |
| 317 | House Koala | 7495857539316877568 | Reguler | Home & Living | Non BD Hande | 2026-09-30 |
| 318 | Huawei Indonesia | 7494981603942894396 | Hold | Phones & Electronics | Alya | 2027-01-31 |
| 319 | HYLE Clothing | 7494775538383424365 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 320 | Hyoso Indonesia | 7494374314615604380 | Reguler | Health | Non BD Hande | 2027-06-17 |
| 321 | IAKA INTERIOR | 7494769701248796930 | Reguler | Home Supplies | Non BD Hande | 2026-10-31 |
| 322 | ichaandenishop | 7494083388786968376 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 323 | Icyee Indonesia | 7496020661994686844 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 324 | Iguls | 7494599902366239564 | Reguler | Sports & Outdoor | Non BD Hande | 2026-10-31 |
| 325 | Implora Cosmetics | 7493990177556497532 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 326 | INBEX Official Shop | 7494033758739793099 | Reguler | Phones & Electronics | Non BD Hande | 2026-12-31 |
| 327 | Infinix Indonesia | 7494083673759843716 | Reguler | Phones & Electronics | Alya | 2027-01-23 |
| 328 | innisfree Indonesia | 7494083561467971250 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 329 | Instaperfect | 7494193604552722811 | Reguler | Beauty & Personal Care | Laila S | 2026-12-31 |
| 330 | INTHEBOX | 7493990370410923973 | Reguler | Textiles & Soft Furnishings | Laila S | 2027-01-21 |
| 331 | irenaksesoris | 7494541092026419964 | Reguler | Fashion Accessories | Non BD Hande | 2026-10-31 |
| 332 | irmaLaila Sstore | 7494083459806431149 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 333 | itel Home ID | 7495479542837906274 | Reguler | Phones & Electronics | Alya | 2027-02-21 |
| 334 | Jacquelle_ID | 7493994074187204486 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 335 | Jajanku Food | 7495175449666620336 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 336 | Jas Hujan Rain City | 7494902483414911868 | Reguler | Home & Living | Non BD Hande | 2026-07-31 |
| 337 | Jeju Collection Shop | 7495970684568373759 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 338 | JESIAMA STORE | 7494524484762830968 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-10-31 |
| 339 | Jestham | 7494460339853035957 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2027-06-17 |
| 340 | Jezfit | 7494610123064183191 | Reguler | Sports & Outdoor | Non BD Hande | 2026-10-31 |
| 341 | Jglow Clinic Surabaya | 7494799412907706700 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-02-12 |
| 342 | JiehuaOfficial | 7494823892821707329 | Reguler | Shoes | Non BD Hande | 2027-01-31 |
| 343 | Jims Honey Offc | 7494003997029467956 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 344 | Jims Honey Official Shop | 7494568852019120243 | Hold | Women Bag | Non BD Hande | 2026-12-31 |
| 345 | JJ GLOW | 7493990105736971353 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-17 |
| 346 | Joey & Roo | 7494266461991830655 | Reguler | Toys & Hobbies | Non BD Hande | 2026-12-31 |
| 347 | Johnson's Baby ID | 7494083506288690969 | Hold | Beauty & Personal Care | Laila S | 2026-11-25 |
| 348 | Joybasic Official | 7495954469284776571 | Reguler | Fashion | Non BD Hande | — |
| 349 | joybasic.id | 7494936736767708129 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-03-09 |
| 350 | Judydoll Indonesia | 7495634419875220215 | Reguler | Beauty & Personal Care | Fanny, Dania Tiffany | 2027-02-28 |
| 351 | JUNNY ID | 7494259040399951666 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 352 | Juose Skincare | 7494653530017336030 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 353 | JuraganAccessories.id | 7494736904716585544 | Reguler | Fashion Accessories | Non BD Hande | 2027-02-28 |
| 354 | K-Online Klontong | 7495774835225758688 | Reguler | Food & Beverages | Non BD Hande | — |
| 355 | Kadens Sport | 7494586419010242581 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 356 | KAHF | 7494507916397742328 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 357 | Kalbe Consumer Health | 7494544595293079663 | Reguler | Health | Non BD Hande | 2027-02-21 |
| 358 | KalonOfficial.id | 7494505781899856331 | Reguler | Health | Erlina sri utami, Laila S | 2026-12-31 |
| 359 | KAO Indonesia | 7495748643643426874 | Reguler | Beauty & Personal Care | Alya | 2026-11-25 |
| 360 | Karakter Home | 7494469564141898062 | Reguler | Fragrance | Non BD Hande | 2026-11-30 |
| 361 | Kassapi parfum laundry | 7495111116734630749 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-30 |
| 362 | KASYFA FASHION | 7494489551906965950 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-02-28 |
| 363 | Kathwi Shop Indonesia | 7495486369172654686 | Running Bulan Pertama | Fragrance | Alya | 2026-12-31 |
| 364 | Katia Collections | 7494854118469765333 | Running Bulan Pertama | Womenswear & Underwear | Fanny, M Yaumal Mizan Firdaus | 2026-12-31 |
| 365 | KedaiMart | 7494649527781919026 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 366 | Kiara houseware | 7494784240631188162 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 367 | Kiehl's Indonesia | 7495029003058055944 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 368 | KiiP Official | 7493991129740117345 | Reguler | Computers & Office Equipment | Non BD Hande | 2027-02-21 |
| 369 | Kimberly Kreasi Indonesia | 7496111901019113639 | Reguler | Home & Living | Non BD Hande | 2025-09-30 |
| 370 | KIME | 7494474196244400831 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-17 |
| 371 | Kimmi_kidswear | 7494475155038242912 | Reguler | Kids' Fashion | Non BD Hande | 2027-10-31 |
| 372 | KIMOmen Store | 7496242930057382009 | Reguler | Food & Beverages | Non BD Hande | 2027-01-31 |
| 373 | KING MART88 | 7495864580120545554 | Reguler | Food & Beverages | Non BD Hande | 2026-09-30 |
| 374 | Kintakun Bedcover | 7493990565220550033 | Reguler | Home & Living | Non BD Hande | 2026-12-05 |
| 375 | Kiswah Hijab Style | 7494915004965292909 | Reguler | Muslim Fashion | Non BD Hande | 2026-05-06 |
| 376 | KJL Beauty | 7494705468249704100 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 377 | Klik.Apotek | 7494847406785071623 | Reguler | Health | Non BD Hande | 2026-11-25 |
| 378 | Kobeni Shop | 7495893183824103496 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-02-28 |
| 379 | Koepoe Koepoe Shop | 7494595239588366983 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2027-03-31 |
| 380 | Kojic Plankton Original | 7494529954242398927 | Retention | Beauty & Personal Care | Erlina sri utami, Laila S | 2027-03-01 |
| 381 | KOPHER ID | 7496101090037303518 | Running Bulan Pertama | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 382 | KOUO Official | 7495968539528562939 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 383 | Kremes Kraton | 7494965266172840762 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 384 | KTI-KONVEKSI TAS INDONESIA | 7496002528278645383 | Reguler | Women Bag | Non BD Hande | 2026-07-31 |
| 385 | Kue Kering BELLAROSA | 7494800440914315307 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 386 | KUJAKU BEAUTY | 7494083632290366529 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 387 | Kupnad | 7494769207416031330 | Reguler | Muslim Fashion | Non BD Hande | 2027-03-24 |
| 388 | Kylafood | 7494001738958996729 | Reguler | Food & Beverages | Non BD Hande | 2026-11-30 |
| 389 | KYMM SKIN | 7494614834177804802 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 394 | LABORE | 7494656771777596182 | Reguler | Beauty & Personal Care | Fanny, Alya | 2026-12-31 |
| 395 | Lahap Bareng | 7495479583098046475 | Reguler | Food & Beverages | Non BD Hande | 2027-10-19 |
| 396 | Lana° Collection | 7494480880267987073 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 397 | Laneige Indonesia Official | 7494754655541955273 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 398 | Lano Batik | 7494989027423521652 | Reguler | Menswear & Underwear | Non BD Hande | 2027-06-28 |
| 399 | LashBoss | 7494083449197331619 | Hold | Beauty & Personal Care | Laila S | 2026-12-31 |
| 400 | Last Supper Official | 7495127600316058024 | Reguler | Food & Beverages | Non BD Hande | 2027-03-24 |
| 401 | Laushine | 7495054904523655542 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 402 | Laushine.Healthy | 7496248820113181240 | Reguler | Health | Non BD Hande | 2027-02-28 |
| 403 | lavojoy.id | 7494658499329034710 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 404 | LDS Smart watch | 7495479731825969984 | Reguler | Phones & Electronics | Non BD Hande | 2027-03-01 |
| 405 | Le Chef | 7495490464436685349 | Reguler | Food & Beverages | Non BD Hande | 2027-06-28 |
| 406 | Le Ding Ding | 7495478238059465663 | Retention | Lifestyle | Dania Tiffany | 2026-12-05 |
| 407 | Le Ding Ding LifeShop | 7495582718469703940 | Reguler | Lifestyle | Non BD Hande | 2026-12-05 |
| 408 | LeDingDing | 7496149164176869721 | Running Bulan Pertama | Kids' Fashion | Alya | 2026-12-31 |
| 409 | leekumkeeindonesia | 7495139876079438479 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 410 | LEKA Indonesia | 7494002103797581516 | Reguler | Home & Living | Non BD Hande | 2027-01-31 |
| 411 | Lemonilo | 7494569963531176771 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-11-25 |
| 412 | Les Catino | 7494083606110897215 | Reguler | Women Bag | Non BD Hande | 2027-01-31 |
| 413 | Letme Home Living | 7495867457043466817 | Reguler | Home Supplies | Non BD Hande | 2027-07-21 |
| 414 | LGSgeneration | 7493999460842636932 | Reguler | Menswear & Underwear | Non BD Hande | 2027-03-24 |
| 415 | LiangGui Food | 7495660615512001016 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 416 | Lifebuoy | 7495181208386570479 | Retention | Beauty & Personal Care | Alya | 2027-03-01 |
| 417 | lightplus | 7496239719489309218 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-17 |
| 418 | Littlemissmos | 7494786892352031235 | Reguler | Muslim Fashion | Non BD Hande | 2027-02-28 |
| 419 | Locknlock.indonesia | 7494551647480089515 | Reguler | Kitchenware | Laila S | 2027-06-12 |
| 420 | LOGAM AUTO IND | 7495869232109750471 | Reguler | Tools & Hardware | Non BD Hande | 2026-10-31 |
| 421 | logeski ID | 7495974630869142137 | Reguler | Home & Living | Non BD Hande | 2027-01-31 |
| 422 | Loginmart | 7495904468431964568 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-30 |
| 424 | Loony | 7494551701629930456 | Reguler | Fashion | Dania Tiffany | 2026-12-31 |
| 425 | Lozy Hijab | 7494431046754339527 | Running Bulan Pertama | Muslim Fashion | Non BD Hande | 2026-12-02 |
| 426 | Lucat Indonesia | 7496277368313777118 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 427 | LUCKYMORE ID | 7496203411210995779 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 428 | LUMEA KITCHEN | 7495818624990283847 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 429 | LUMIWHITE | 7494940184937793986 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 430 | Luna Makeup Official Shop | 7495142704988850852 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-12-21 |
| 431 | Lunavee Indonesia | 7494202251683136851 | Hold | Beauty & Personal Care | Laila S | 2026-12-31 |
| 432 | LURAD SHOES | 7494003468279383841 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 433 | Madame Gie | 7493996803401680547 | Reguler | Beauty & Personal Care | Dania Tiffany | 2027-06-17 |
| 434 | Madu Uray Official | 7494849632246664117 | Reguler | Health | Non BD Hande | 2026-11-25 |
| 435 | Makarizo | 7493998308155622759 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 436 | makeoverid | 7493990262625109760 | Reguler | Beauty & Personal Care | Fanny, M Yaumal Mizan Firdaus | 2027-02-28 |
| 437 | Maricoba Herbals | 7495677101304351608 | Reguler | Health | Non BD Hande | 2026-12-31 |
| 438 | Marimar Beauty | 7494941949430565776 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-07-31 |
| 439 | Marlov | 7495909917380872889 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-06-17 |
| 440 | Mars Snacking Indonesia | 7495861496180214041 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 441 | Marven ID | 7495591206288198129 | Reguler | Food & Beverages | Non BD Hande | 2026-09-30 |
| 442 | Masak Apa Hari Ini | 7494925848126982530 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 443 | Masline Store | 7494940413693888625 | Reguler | Fashion | Non BD Hande | 2026-09-01 |
| 444 | Matrix Indonesia | 7496220600837180072 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 445 | Matsuda Apparel | 7494083504715564051 | Reguler | Sports & Outdoor | Non BD Hande | 2026-11-25 |
| 447 | Mays Official | 7494590304476302329 | Reguler | Home Supplies | Non BD Hande | 2027-03-24 |
| 448 | Mayscent | 7494913215074699552 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-10-31 |
| 449 | Mc Lewis Indonesia | 7495656314416695865 | Retention | Food & Beverages | Non BD Hande | 2026-12-31 |
| 450 | MEA Agency | 7493989963020470246 | Reguler | Lifestyle | Non BD Hande | 2026-03-04 |
| 451 | MEAM Mainan Edukasi | 7494667359276731313 | Reguler | Mom & baby | Non BD Hande | 2026-12-31 |
| 452 | Medicube Indonesia | 7496019554130888970 | Running Bulan Pertama | Beauty & Personal Care | Fanny, Dania Tiffany | 2026-12-31 |
| 453 | Melstorejkt | 7494083440687219814 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 454 | Menara Sbp | 7494388906934961347 | Reguler | Food & Beverages | Non BD Hande | 2027-02-21 |
| 455 | Menara Sembako | 7495295626462595675 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 456 | MEOKY official Mall | 7495982918891178211 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 457 | Metaverse.Koper | 7495030482964155030 | Reguler | Luggage & Bags | Non BD Hande | 2026-11-30 |
| 458 | Metto | 7496053226513402514 | Reguler | Health | Non BD Hande | 2027-03-01 |
| 459 | Milkita Indonesia | 7494083758575420490 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 460 | Min Soo | 7494903761626237107 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 461 | Minaier Official Store | 7494273583221540073 | Hold | Beauty & Personal Care | Laila S | 2027-06-17 |
| 462 | Mine. Perfumery Official | 7494083609054905652 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 463 | Miniso Beauty ID | 7493992463704688257 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 464 | Miniso Lifestyle ID | 7494007542750217515 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 465 | Miniso Toy ID | 7494055852502910484 | Reguler | Toys & Hobbies | Non BD Hande | 2026-12-31 |
| 466 | minisoshopid | 7495228315098515899 | Reguler | Beauty & Personal Care | Fanny, Alya | 2026-12-31 |
| 467 | MIORIO | 7494401438774428990 | — | Beauty & Personal Care | Laila S | 2027-06-17 |
| 468 | Miranda Hair Care | 7494083526967592680 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 469 | Mirukaku Skincare | 7494502516842203844 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 470 | Mirza Herbal | 7495041203377769290 | Reguler | Health | Non BD Hande | 2026-07-31 |
| 471 | Missy Indonesia | 7493991007917606069 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-30 |
| 472 | Mixio | 7494442713042225258 | Reguler | Phones & Electronics | M Yaumal Mizan Firdaus | 2026-12-31 |
| 473 | MK SKIN BEAUTY GLOOW | 7494083576749524686 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 474 | MlenDiaryID | 7495293503028562237 | Reguler | Beauty & Personal Care | Laila S, Fanny | 2027-06-17 |
| 475 | MOC Indonesia | 7494873758279240221 | Running Bulan Pertama | Fashion | Alya | 2026-12-10 |
| 476 | MOELL OFFICIAL | 7494840462703167559 | Running Bulan Pertama | Mom & baby | Dania Tiffany | 2026-12-31 |
| 477 | Moesha Sprei Collection | 7494488664878844133 | Reguler | Textiles & Soft Furnishings | Non BD Hande | 2026-12-31 |
| 478 | Mom Uung Official | 7493997672409892433 | Running Bulan Pertama | Baby & Maternity | Dania Tiffany | 2026-12-31 |
| 479 | Momami | 7494688620897863929 | Reguler | Mom & baby | Non BD Hande | 2027-02-21 |
| 480 | Monster Audio | 7494083628073321832 | Reguler | Phones & Electronics | Non BD Hande | 2026-12-31 |
| 481 | Monster Audio Shop | 7495068448260130842 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 482 | Monument Sandal | 7494489117108963872 | Reguler | Shoes | Non BD Hande | 2027-03-24 |
| 484 | MOP Beauty By Tasya Farasya | 7494691112018414131 | Reguler | Beauty & Personal Care | M Yaumal Mizan Firdaus | 2026-12-31 |
| 485 | Morris Indonesia | 7493991977724905079 | Reguler | Fragrance | Alya | 2026-12-31 |
| 486 | MOSSDOOM | 7494971800079993190 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 487 | Mossèru | 7495297011747293899 | Reguler | Beauty & Personal Care | Erlina sri utami, Laila S | 2026-12-31 |
| 488 | MR. epple | 7494083464359937038 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 489 | MSDxEveryone | 7495730252903910229 | Reguler | Fashion | Non BD Hande | — |
| 490 | Msgallery01 | 7494481573514152555 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-01-31 |
| 491 | Msglow Beauty Official | 7494507165596879345 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 492 | msollshop | 7495481067875830130 | Reguler | Textiles & Soft Furnishings | Non BD Hande | 2026-10-31 |
| 493 | Mukena Ayzara | 7494083526714558174 | Running Bulan Pertama | Muslim Fashion | Fanny, Laila S | 2026-12-31 |
| 495 | MumuFashion Store | 7494503315642812607 | Reguler | Muslim Fashion | Non BD Hande | 2027-02-21 |
| 496 | mustikaratuid | 7495169648134097488 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 497 | My Plus Size | 7494516411367458942 | Reguler | Muslim Fashion | Non BD Hande | 2027-01-31 |
| 498 | My SereHealth By Serenity | 7494517219059469279 | Reguler | Health | Non BD Hande | 2027-03-24 |
| 499 | Mymukena.official | 7494793698741750715 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-31 |
| 500 | myolaaa | 7496212534889253880 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 501 | Naavagreen Skincare | 7495285931126393814 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 502 | Nabati Indonesia | 7495909645038881575 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 503 | Naraanatural | 7495741878429190307 | Reguler | Food & Beverages | Non BD Hande | 2027-02-28 |
| 504 | Narumiya Hijab | 7495539709426043330 | Reguler | Muslim Fashion | Non BD Hande | 2027-01-31 |
| 505 | Natasha Skincare | 7494466456329357941 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 506 | natugenic | 7494989823469455724 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 507 | Natural Beyouti | 7494529982011378490 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 508 | Nazura Mart | 7496000256423660307 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 509 | ncoperfume | 7495917837212158137 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 510 | NDGROSIR | 7495824409079875630 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 511 | NDSTOREMDN | 7495036526336772554 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 512 | Neerme.id | 7494966871504292664 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 513 | Neoalgae Official | 7494698874318654145 | Reguler | Beauty & Personal Care | Fanny, Laila S | 2026-11-25 |
| 514 | Nerman Indonesia | 7496153651660753381 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 515 | nermee.id | 7494661155034991535 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 516 | Nestle Indonesia | 7494558784899090960 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 517 | Newlab | 7494083480430347521 | Retention | Beauty & Personal Care | Alya | 2027-02-28 |
| 518 | Nexman Kopi Gingseng | 7496223863675586643 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 519 | NEXT PRIME | 7494252350444373159 | Reguler | Beauty & Personal Care | Dania Tiffany | 2027-06-17 |
| 520 | NinaNurseID | 7496185689039735752 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 521 | NIVEA Official Store | 7494512520393231104 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | 2027-01-23 |
| 522 | Noera By Reisha | 7494083400990099312 | Reguler | Beauty & Personal Care | Dania Tiffany | 2026-12-31 |
| 523 | Nomby | 7495801669167319846 | Reguler | Baby & Maternity | Non BD Hande | 2027-03-24 |
| 524 | Noni Magic | 7494735752283785875 | Reguler | Beauty & Personal Care | Fanny, M Yaumal Mizan Firdaus | — |
| 525 | Nonico | 7494948622455900347 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 526 | NOOYA INDONESIA | 7496267563117218179 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2027-02-21 |
| 527 | Nordes | 7496287783506774404 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 530 | nubia Indonesia | 7495305712777661251 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 531 | NufaceID | 7494083470546732589 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 532 | Nunaraofficial | 7494558825504738193 | Reguler | Womenswear & Underwear | Non BD Hande | 2027-01-31 |
| 533 | NUQS Beauty | 7496210871420750798 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 534 | Nusa Inti Pangan | 7496162072465738583 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-11-25 |
| 535 | nusantarahelm | 7494083749832393923 | Reguler | Automotive & Motorcycle | Non BD Hande | 2027-01-03 |
| 536 | Nutrimart Store | 7494039647450596418 | Retention | Food & Beverages | Erlina sri utami, Laila S | 2026-09-30 |
| 537 | Nutrimax Indonesia | 7494083415669179726 | Retention | Health | Alya | 2026-12-31 |
| 538 | Nutripedia | 7495829710895942169 | Reguler | Health | Non BD Hande | 2027-03-01 |
| 539 | NVMEE | 7493990402252834077 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 540 | NYAI MERCON | 7494083437465077089 | Reguler | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 541 | OATSIDE Indonesia | 7494815890170153050 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-11-25 |
| 542 | Obsbot Indonesia | 7495889295632075375 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 543 | Octarine Official | 7494725083871611692 | Retention | Beauty & Personal Care | Erlina sri utami, Laila S | 2026-12-31 |
| 544 | Official Mie Sagu Bu Tuti | 7494607353840044518 | Reguler | Food & Beverages | Non BD Hande | 2027-03-24 |
| 545 | OfficialElishacoyIndonesia | 7495550905660181361 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 546 | OHSOME Homeliving | 7494066335012259149 | Reguler | Home & Living | Non BD Hande | 2027-01-31 |
| 547 | OHSOME Trends | 7495773932986469326 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 548 | OhSomeOfficialToys | 7495854435220294524 | Reguler | Lifestyle | Non BD Hande | 2027-01-31 |
| 549 | OhSomeToys | 7494544501485635772 | Reguler | Lifestyle | Non BD Hande | 2027-01-31 |
| 550 | Okey Motor | 7494511815010716007 | Reguler | Books, Magazines & Audio | Non BD Hande | 2026-12-31 |
| 551 | Olike Gadget | 7494200698243810868 | Reguler | Phones & Electronics | Non BD Hande | 2027-02-21 |
| 552 | Olike Store | 7494072428714952176 | Reguler | Home & Living | Non BD Hande | 2027-01-31 |
| 553 | OMG Store | 7494005712512845203 | Reguler | Beauty & Personal Care | Laila S | 2026-12-31 |
| 554 | OMRON Healthcare ID | 7495597609928788046 | Running Bulan Pertama | Health | Fanny, M Yaumal Mizan Firdaus | 2026-12-31 |
| 555 | OMURA POWDER SHOP | 7494759625119599254 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 556 | Onix Fragrance Indonesia | 7494940221962422503 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 557 | Onoma | 7494911167947573320 | Reguler | Fashion | Dania Tiffany | 2026-12-31 |
| 558 | OOJHI | 7494457292083267284 | Reguler | Food & Beverages | Non BD Hande | 2027-02-21 |
| 559 | OPPO Store Indonesia | 7493995189200651473 | Reguler | Phones & Electronics | Laila S | 2026-12-31 |
| 560 | oraimo Authentic Store | 7494898175670258586 | Reguler | Phones & Electronics | Non BD Hande | 2026-12-31 |
| 561 | Orinesia | 7494815213670992000 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 562 | Orkids Store | 7494712277609777991 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 563 | Orydear | 7496026393985321692 | Reguler | Menswear & Underwear | Non BD Hande | 2026-07-31 |
| 564 | OT-Store | 7494966433662864130 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2027-02-21 |
| 565 | otwoo_id | 7494045995362059522 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 566 | OURINONE | 7494581616182266319 | Reguler | Mom & baby | Dania Tiffany | — |
| 567 | Ovale Beauty | 7496039549785770855 | Retention | Beauty & Personal Care | Erlina sri utami, Alya | 2026-12-31 |
| 568 | Ovie Zahra | 7495479721689975315 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 569 | OWNER CANDI BEAUTY | 7494528254681909839 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 570 | Owner Candi Pusat | 7496050404715628858 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 571 | P&G Store | 7494432922944572288 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany, Fanny | 2026-11-30 |
| 572 | PACKBAGID | 7494489422883162267 | Reguler | Home Supplies | Non BD Hande | 2027-03-24 |
| 573 | Pahalahijab.id | 7495311921716693382 | Reguler | Muslim Fashion | Non BD Hande | 2027-03-24 |
| 574 | PANARYBODY_SHOES | 7493994544169846044 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 575 | Panova | 7494812655508424767 | Reguler | Kitchenware | Non BD Hande | 2027-01-23 |
| 576 | patris | 7494083375624128127 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 577 | PAWLOVIN | 7494863896644782577 | Reguler | Pet Supplies | Non BD Hande | 2026-01-05 |
| 578 | Penerbit Insan Kamil | 7494517088416664421 | Reguler | Books, Magazines & Audio | Non BD Hande | 2027-02-21 |
| 579 | perfectwhiteseries | 7494600208527362201 | Reguler | Beauty & Personal Care | Fanny, M Yaumal Mizan Firdaus | 2027-02-28 |
| 580 | Pero Indonesia | 7494511793213639278 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 581 | Philips Avent Official | 7494523723949115800 | Reguler | Baby & Maternity | Non BD Hande | 2026-12-31 |
| 582 | Philips Personal Care Official | 7494083592594032421 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 583 | Pigeonbabyindonesia | 7494475070809671863 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2026-02-21 |
| 584 | Pixy Official Store | 7495817031940737468 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 585 | PluviophileOfficial | 7494438727451642136 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 586 | Pods Store Indonesia | 7495228811222485327 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-23 |
| 587 | POLKI INDONESIA | 7494083647066703443 | Reguler | Home & Living | Laila S | 2026-12-05 |
| 588 | Pomapoo | 7494083468306253261 | Reguler | Fashion | Non BD Hande | 2027-03-24 |
| 589 | Pond's | 7494693460590561622 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2026-12-31 |
| 590 | Porto Footwear | 7493990205884696137 | Running Bulan Pertama | Shoes | Non BD Hande | 2026-12-31 |
| 591 | Porto X | 7495553106418698678 | Running Bulan Pertama | Shoes | Non BD Hande | 2026-12-31 |
| 592 | Poshboyid | 7494810336351258695 | Reguler | Menswear & Underwear | Non BD Hande | 2027-02-28 |
| 593 | premierebeaute.id | 7493994972381874084 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 594 | PRODUSEN TAS WANITA | 7494598785574669105 | Reguler | Lifestyle | Non BD Hande | 2026-07-31 |
| 595 | profesional bedcover | 7494926134679406864 | Reguler | Textiles & Soft Furnishings | Non BD Hande | 2026-10-31 |
| 596 | Pronas Indonesia | 7495475160973413268 | Reguler | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 597 | PUMA Indonesia | 7496085094426446137 | Reguler | Shoes | Alya | 2026-12-31 |
| 599 | Purela.id | 7495492105780955633 | Reguler | Baby & Maternity | Non BD Hande | 2026-12-31 |
| 600 | Puspa Pharma | 7494547072902334719 | Reguler | Health | Dania Tiffany | 2027-02-21 |
| 601 | Putri Hair Choice | 7494691073751354083 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 602 | PutriAuroraCollection | 7494450308157770506 | Reguler | Muslim Fashion | Non BD Hande | 2025-03-05 |
| 603 | Puxi Official Store | 7496087135491623856 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 604 | pvnshoes | 7493992673881655123 | Reguler | Shoes | Non BD Hande | 2027-06-13 |
| 605 | Pyunkang Yul Indonesia | 7494657842229906129 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 606 | QUEEN HERBAL OIL | 7494709205671577806 | Reguler | Personal care | Non BD Hande | 2027-03-24 |
| 607 | quivhair | 7496200914352245672 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 608 | Racertees Foryou | 7494083699944097259 | Reguler | Menswear & Underwear | Non BD Hande | 2027-03-24 |
| 609 | raeccaid | 7493994870019556382 | Reguler | Beauty & Personal Care | Fanny, Dania Tiffany | 2026-12-31 |
| 610 | rafalenshoes | 7494971881141667997 | Reguler | Shoes | Non BD Hande | 2026-10-31 |
| 611 | Ranee Bruggman shop | 7495160867561245659 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 612 | RANSEL ANAK VIRAL | 7495953374722361657 | Reguler | Kids' Fashion | Non BD Hande | 2026-12-31 |
| 613 | Ratu Ngemil 12 | 7494470655308892327 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 614 | RAYNAABAYA | 7494510165647723092 | Reguler | Muslim Fashion | Non BD Hande | 2026-01-25 |
| 615 | Real Body & Soul | 7495142762219604666 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 616 | realme Official Indonesia | 7496228080627125000 | Reguler | Phones & Electronics | Alya | 2027-12-31 |
| 617 | realmeofficialpartner | 7495188506495518744 | Reguler | Phones & Electronics | Alya | 2027-01-31 |
| 618 | REECA | 7494083638202106895 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 619 | Remington | 7494028547110110501 | Reguler | Personal care | Dania Tiffany | — |
| 620 | REREYSHOP | 7494083441640113885 | Reguler | Fashion | Dania Tiffany | 2027-07-10 |
| 621 | Resep Roemah | 7494852452105291792 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 622 | Ripple Indonesia | 7494925927748635624 | Reguler | Phones & Electronics | Non BD Hande | 2025-10-31 |
| 623 | risnabruggman | 7495487397331044636 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 624 | Rokid Indonesia | 7495960069806721715 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 625 | Rosé All Day Cosmetics | 7494002318068516091 | Running Bulan Pertama | Beauty & Personal Care | Fanny, Dania Tiffany | 2026-12-31 |
| 626 | Roux Bakes & Snack | 7494766975150033228 | Reguler | Food & Beverages | Non BD Hande | 2026-07-31 |
| 627 | Royal Fragrance ID | 7494895786286418213 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 628 | Royal Semprong | 7495996115425134638 | Reguler | Food & Beverages | Non BD Hande | 2026-02-28 |
| 629 | rtsr.id | 7494499498543647262 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 630 | Rudal Underwear | 7495888250269895308 | Reguler | Menswear & Underwear | Non BD Hande | 2027-01-31 |
| 631 | Rumi Hijab Oficial | 7494675774309960592 | Reguler | Muslim Fashion | Non BD Hande | 2027-01-31 |
| 632 | ruselco | 7494083449978455755 | Reguler | Luggage & Bags | Non BD Hande | 2027-01-31 |
| 633 | Rut.id | 7494782194252614503 | Reguler | Womenswear & Underwear | Non BD Hande | 2024-08-16 |
| 635 | S&D Project | 7494681166635961111 | Reguler | Muslim Fashion | Non BD Hande | 2026-11-30 |
| 636 | SAFF & Co. | 7494521006737033571 | Reguler | Beauty & Personal Care | Fanny, Alya | 2027-02-28 |
| 637 | safiindonesia | 7494544661167508361 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 639 | Sahara Indonesia | 7495061019420166594 | Reguler | Muslim Fashion | Non BD Hande | 2027-02-21 |
| 640 | Saint Helmi & Co. | 7496112952886265861 | Reguler | Fashion | Non BD Hande | 2027-03-24 |
| 641 | SAJJADZAMZAMI.STORE | 7496164512266619081 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-31 |
| 642 | Sajodo Snack & Food | 7493990017834189830 | Retention | Food & Beverages | Erlina sri utami, Laila S | 2026-12-31 |
| 643 | Sakura Baru | 7494438723482454810 | Running Bulan Pertama | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 644 | Sakurastore25 | 7496160717827902445 | Retention | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 645 | Sambro Shop | 7495772779916724635 | Reguler | Food & Beverages | Non BD Hande | 2024-09-09 |
| 646 | Samono Indonesia | 7494083391869387815 | Reguler | Home & Living | Fanny, Alya | 2026-12-31 |
| 647 | Saniye Beauty Store | 7494656046275070927 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-21 |
| 648 | Saramonic Indonesia | 7495210580168247937 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-23 |
| 649 | Sasa Melezatkan | 7494706614872148889 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2027-02-21 |
| 650 | SasaQueen Indonesia | 7494228135763150805 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 651 | SasaQueen Underwear id | 7494246799806400171 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 652 | SasaQueen.id | 7494172960764429390 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 653 | Satelliteofglow Indonesia | 7494925738974546656 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 654 | Satoku IMO-100 | 7496103832633445174 | Reguler | Health | Non BD Hande | 2027-03-24 |
| 655 | Saudara Popok | 7494475103634950528 | Reguler | Baby & Maternity | Non BD Hande | 2026-12-31 |
| 656 | SAVAGE INDONESIA | 7495470752103762401 | Reguler | Luggage & Bags | Non BD Hande | 2026-12-31 |
| 657 | SB 99 | 7494859061084195269 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 658 | SC Johnson & Son Indonesia | 7494007395773154487 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 659 | Scarlett Whitening | 7493994320825255288 | Reguler | Beauty & Personal Care | Dania Tiffany | 2027-02-28 |
| 660 | Scora | 7495479414655715854 | Retention | Beauty & Personal Care | Laila S | 2026-11-25 |
| 661 | Seagloca.id | 7494906863934539909 | Reguler | Luggage & Bags | Non BD Hande | 2026-12-31 |
| 662 | Secret Clean | 7494823858163386996 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 663 | Seger Snow | 7494484786387782536 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 664 | selyn.collection | 7495220489846688258 | Reguler | Muslim Fashion | Non BD Hande | 2024-10-29 |
| 665 | Semar Nusantara | 7494083747799795360 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 666 | Sembako murah88 | 7495843331233974783 | Reguler | Food & Beverages | Non BD Hande | 2026-09-30 |
| 667 | SEMIRA JAKARTA | 7494557684248185108 | Reguler | Home Supplies | Non BD Hande | 2026-12-31 |
| 668 | Sensodyne Indonesia | 7494785450118646625 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 669 | Sensorline | 7494766102860368002 | Reguler | Menswear & Underwear | Non BD Hande | 2026-10-31 |
| 670 | Sentra Digital | 7493992039333790870 | Reguler | Phones & Electronics | Non BD Hande | 2027-03-01 |
| 671 | Seolmi Official | 7495082520893819384 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 672 | Sepatu Kanky | 7494763862183872809 | Running Bulan Pertama | Shoes | Fanny, Laila S | 2027-02-21 |
| 673 | Sevenbee Clothing Store | 7496144751398258821 | Reguler | Menswear & Underwear | Non BD Hande | 2027-02-28 |
| 674 | Sf hijabOfficial | 7494083471994881433 | Reguler | Muslim Fashion | Non BD Hande | 2024-04-14 |
| 675 | SFgiandra | 7495119253229635953 | Reguler | Muslim Fashion | Non BD Hande | 2027-01-31 |
| 676 | SGNAL.FRAGRANCE | 7494379608711858011 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 677 | Sheriz | 7494083401096922609 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 679 | SHINON&NIKAI | 7495475140351592856 | Reguler | Personal care | Non BD Hande | 2027-01-31 |
| 680 | Shinzui | 7494919300905863950 | Reguler | Beauty & Personal Care | Fanny, Laila S | 2027-06-17 |
| 681 | shop sajira | 7494118695964935595 | Reguler | Women Bag | Non BD Hande | 2024-03-24 |
| 682 | Shorush | 7494656913334765574 | Reguler | Phones & Electronics | Non BD Hande | 2026-11-30 |
| 683 | Shudur Motor | 7494803240275839590 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-01-31 |
| 684 | Sido Muncul Store | 7494743120013789832 | Reguler | Health | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 685 | Sidomuncul Tolak Angin | 7495209408569313450 | Reguler | Health | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 686 | SipnPack Indonesia | 7496177874037214143 | Reguler | Phones & Electronics | Non BD Hande | 2026-11-30 |
| 687 | SKIN1004 | 7494928748302076708 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 688 | Skinlutions Official | 7494891174126455055 | Reguler | Beauty & Personal Care | Non BD Hande | 2025-10-31 |
| 689 | Skintificid | 7496055932977580622 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 690 | Slavina | 7495107083151640670 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 691 | Snack Sugih mandiri | 7494430896796043234 | Reguler | Food & Beverages | Non BD Hande | 2027-02-28 |
| 692 | SnBM Collection | 7494182034753094786 | Reguler | Muslim Fashion | Dania Tiffany | 2026-12-31 |
| 693 | Soho Global Health | 7494668433258940787 | Hold | Health | Alya | 2026-12-31 |
| 694 | SOLOEVER-ID | 7496235929136630559 | Reguler | Sports & Outdoor | Non BD Hande | 2027-02-21 |
| 695 | Sombong Men's Care | 7495233037037767585 | Reguler | Beauty & Personal Care | Non BD Hande | — |
| 696 | SOME BY MI SHOP | 7495500107169171632 | Running Bulan Pertama | Beauty & Personal Care | Fanny, Dania Tiffany | 2027-02-28 |
| 697 | Somethinc | 7493990307784328645 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-02-28 |
| 698 | sophiemartinparis | 7494783588612606327 | Reguler | Luggage & Bags | Non BD Hande | 2027-03-01 |
| 699 | Spotless Shoe Care Indonesia | 7494083392713950510 | Reguler | Shoes | Non BD Hande | 2024-12-31 |
| 700 | ST.TREEOfficial | 7495199958421309478 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-10-11 |
| 701 | Steincookware Official Store | 7493993425884054643 | Reguler | Home & Living | Non BD Hande | 2027-01-23 |
| 702 | Stellar Line | 7494499943157041751 | Running Bulan Pertama | Fashion | Alya | 2026-12-31 |
| 703 | Step To Bright Indonesia | 7494374249214871067 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 704 | sulistio irawan | 7494083476916766323 | Reguler | Fashion Accessories | Non BD Hande | 2027-03-01 |
| 705 | Sulwhasoo Indonesia | 7495609693569649132 | Retention | Beauty & Personal Care | Alya | 2026-12-31 |
| 706 | SunCoid | 7495305673342421068 | Retention | Food & Beverages | Erlina sri utami, Alya | 2026-12-31 |
| 707 | Swisse - Indonesia | 7494914015393057526 | Retention | Health | Fanny, Dania Tiffany | 2027-02-28 |
| 708 | SyabnamOfficial | 7495529204225641217 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 709 | sykamore.indonesia | 7494605296594028573 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-03-06 |
| 710 | Sylvia.Certified | 7494981569154877468 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-07-31 |
| 711 | TCHALQNESE 5 perawatan kulit | 7494637799712000284 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-09-30 |
| 712 | TECNO Indonesia Shop | 7495660671841437771 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 713 | Tenda Technology Indonesia | 7495275898052578175 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 714 | Tentang Anak | 7494582988621580368 | Reguler | Mom & baby | Non BD Hande | 2026-12-31 |
| 715 | TEPUNG SUPER | 7494607454251224063 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 716 | The Originote | 7494540976239708616 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-11-25 |
| 718 | Timephoria.id | 7496014128877898029 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 719 | Tirta Kencana Atelier | 7495289342288300766 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-06-30 |
| 720 | Tirtir Indonesia | 7495811548760148272 | Reguler | Beauty & Personal Care | Fanny, Dania Tiffany | 2026-12-31 |
| 721 | Toko Palmerah Jaya | 7494955753219459957 | Reguler | Food & Beverages | Non BD Hande | 2026-12-13 |
| 722 | Toko Vicenza | 7494474345412135913 | Reguler | Kitchenware | Non BD Hande | 2027-06-12 |
| 723 | tokosekarwangi | 7495209408569313450 | Retention | Food & Beverages | Erlina sri utami, Laila S | 2026-12-31 |
| 724 | TomHer | 7494880144026274195 | Reguler | Luggage & Bags | Non BD Hande | 2026-10-31 |
| 725 | Torch.id | 7494000639661475033 | Reguler | Luggage & Bags | Non BD Hande | 2026-01-26 |
| 726 | Torriden Indonesia | 7496054858587932747 | Reguler | Beauty & Personal Care | Alya, Dania Tiffany | 2026-12-31 |
| 727 | Toshiba TV Official Store | 7495188891025442904 | Reguler | Phones & Electronics | Fanny, Alya | 2026-12-31 |
| 728 | True to Skin | 7493990064508470623 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 730 | Tubita Official | 7494083489112819454 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 731 | Tuffero Patisserie | 7494083718441502103 | Reguler | Food & Beverages | Alya | 2026-12-31 |
| 732 | Tusen Cooling Dream | 7494609341834561573 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 733 | Twc Shop | 7494667845377952174 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-01-31 |
| 734 | Ultra Sakti Health | 7494529998403701089 | Reguler | Health | Erlina sri utami, Alya | 2026-12-31 |
| 735 | Ultra Sakti Store | 7494862522912508574 | Reguler | Health | Erlina sri utami, Alya | 2026-12-31 |
| 736 | UltraSleep | 7494420586596566564 | Reguler | Health | Non BD Hande | 2027-03-24 |
| 737 | UNES Official Store | 7496130373640620219 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 738 | Unicharm Official Store | 7494539035429734595 | Reguler | Baby & Maternity | Non BD Hande | 2026-12-31 |
| 739 | Unilever Food Solutions | 7495159511201122707 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 740 | Unilever Hair Beauty Studio | 7495116066316716919 | Reguler | Beauty & Personal Care | Alya | 2026-12-31 |
| 741 | Unilever Official Store | 7495129254209685773 | Reguler | Beauty & Personal Care | Alya | 2027-01-31 |
| 742 | UNITWO Home | 7495634116320922282 | Reguler | Home & Living | Non BD Hande | 2026-12-05 |
| 743 | Urban Factor | 7494534225340894159 | Reguler | Luggage & Bags | Non BD Hande | 2026-10-31 |
| 744 | uru underwear | 7495981614843594939 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 745 | USMILE | 7495000198045272280 | — | Beauty & Personal Care | Laila S, Dania Tiffany | 2027-02-21 |
| 747 | Valent Fashion88 | 7495144160033868069 | Reguler | Muslim Fashion | Non BD Hande | 2026-07-13 |
| 748 | Vannamille77 | 7494482912199739862 | Reguler | Muslim Fashion | Non BD Hande | 2026-10-31 |
| 749 | Vaseline Indonesia | 7494687833781864968 | Running Bulan Pertama | Beauty & Personal Care | Alya | 2026-12-31 |
| 750 | VELIA CO | 7496210867435899171 | Running Bulan Pertama | Fashion Accessories | Alya | 2027-07-10 |
| 751 | Ventedaily | 7494083427604399900 | Running Bulan Pertama | Muslim Fashion | Alya | 2026-12-31 |
| 752 | Vention Authorized Store | 7494083675625653671 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 753 | Verite Official Shop | 7495909685542357928 | Reguler | Women Bag | Non BD Hande | 2026-12-31 |
| 754 | VERMA | 7494451948084693086 | Reguler | Home Supplies | Non BD Hande | 2027-01-31 |
| 755 | verturewire | 7494609302783429610 | Reguler | Home Supplies | Non BD Hande | 2027-02-28 |
| 756 | Vianova Watch Store | 7494547827244435895 | Retention | Fashion Accessories | Alya | 2026-12-31 |
| 757 | Vibrant Glamour | 7495066760799816395 | — | Beauty & Personal Care | Laila S | 2027-06-17 |
| 758 | VINCITORY | 7496060952623679526 | Reguler | Shoes | Non BD Hande | 2026-10-31 |
| 759 | VINEDA'skin | 7495916852740852110 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-03-24 |
| 760 | Vinzz mode | 7494083436137973087 | Reguler | Fashion | Non BD Hande | 2027-01-31 |
| 761 | Virelai Teknik | 7494678467862366332 | Reguler | Automotive & Motorcycle | Non BD Hande | 2026-12-31 |
| 762 | Vitabumin | 7494627822148881126 | Reguler | Health | Non BD Hande | 2026-07-31 |
| 763 | vivanindonesia | 7494083547676509234 | Hold | Phones & Electronics | Alya | 2026-12-31 |
| 765 | Vixal | 7495129254209685773 | Reguler | Home & Living | Non BD Hande | 2027-01-31 |
| 766 | VONA | 7494598760445741477 | Reguler | Fashion Accessories | Non BD Hande | 2024-10-09 |
| 767 | Vone Sanitary Indonesia | 7494701184051939498 | Reguler | Home & Living | Non BD Hande | 2026-07-31 |
| 768 | voulao.indonesia | 7494629937377217113 | Reguler | Phones & Electronics | Non BD Hande | 2027-01-31 |
| 769 | WanhaBeauty | 7495636118026095219 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-10-31 |
| 770 | Wanodya Indonesia Official | 7494083372850644729 | Reguler | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 771 | wardahbeautyid | 7493999781643847575 | Reguler | Beauty & Personal Care | Fanny, Laila S | 2027-01-31 |
| 772 | Warung Marenta | 7494083429917296635 | Reguler | Food & Beverages | Non BD Hande | 2027-01-31 |
| 773 | Watsons Indonesia | 7494083387597948906 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-08-31 |
| 774 | White Diary | 7494083571604751852 | Reguler | Beauty & Personal Care | Non BD Hande | 2027-01-31 |
| 775 | Wijayawellness | 7496263818800040669 | Reguler | Food & Beverages | Non BD Hande | 2026-10-31 |
| 776 | Willofi Hijab | 7496046036214515820 | Hold | Muslim Fashion | Non BD Hande | 2026-12-31 |
| 777 | Wings Indonesia | 7495481450890169058 | Reguler | Food & Beverages | Erlina sri utami, M Yaumal Mizan Firdaus | 2026-12-31 |
| 778 | wiprounzaid | 7494798338028112048 | Reguler | Personal care | Non BD Hande | 2026-12-31 |
| 779 | Wiselie Indonesia | 7494083458844100167 | Reguler | Home & Living | Non BD Hande | 2026-12-31 |
| 780 | WOOZY ARTWEAR | 7494893961268857474 | Reguler | Menswear & Underwear | Non BD Hande | 2027-01-31 |
| 781 | World Of Make Scents | 7494693480761821593 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-09-11 |
| 782 | Worldhome Indonesia | 7494083610968950169 | Reguler | Home Supplies | Non BD Hande | 2026-06-22 |
| 783 | wulanshop klaten | 7494460702303029409 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-11-30 |
| 784 | X-Fourth | 7494776861930850993 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 785 | Xiaomi Indonesia | 7495759412282493465 | Reguler | Phones & Electronics | Alya | 2027-01-31 |
| 786 | YANIS3-ID | 7494331214964098146 | Reguler | Kitchenware | Non BD Hande | 2026-12-31 |
| 787 | Yeo's ID | 7495845602898381350 | Reguler | Food & Beverages | Non BD Hande | 2026-12-31 |
| 788 | Yesplus | 7495172633432328453 | Reguler | Shoes | Non BD Hande | 2026-12-31 |
| 789 | YOU Beauty Official | 7493996126462904041 | Reguler | Beauty & Personal Care | Non BD Hande | 2026-12-31 |
| 790 | YouHave Store | 7493992757856798648 | Reguler | Womenswear & Underwear | Non BD Hande | 2026-12-31 |
| 791 | Yourchapterone | 7494083540371539290 | Reguler | Lifestyle | Non BD Hande | 2024-12-31 |
| 792 | Youvit for life | 7494191970187446916 | Reguler | Baby & Maternity | Laila S, Fanny | 2027-06-17 |
| 793 | Yves Rocher Indonesia | 7495712062124952311 | Reguler | Beauty & Personal Care | Fanny, Dania Tiffany | 2027-02-21 |
| 794 | zataskin | 7494669575537199813 | Reguler | Beauty & Personal Care | Non BD Hande | 2024-06-05 |
| 795 | Zealo Shoes Official | 7494532680910080811 | Reguler | Shoes | Non BD Hande | 2024-04-14 |
| 796 | Zeea Store | 7494476661173881001 | Reguler | Fashion | Non BD Hande | 2026-12-31 |
| 797 | Zegavit Gummy | 7494374563450226664 | Reguler | Health | Fanny, M Yaumal Mizan Firdaus | 2027-02-21 |
| 798 | Zivace Bags | 7496097017973934489 | Reguler | Luggage & Bags | Non BD Hande | 2026-10-31 |
| 799 | Ziyadbooks | 7494588020447676996 | Reguler | Books, Magazines & Audio | Non BD Hande | 2026-12-31 |
| 800 | ZIZAHRA FOOD | 7494802736752397079 | Reguler | Food & Beverages | Non BD Hande | 2026-01-27 |
| 801 | ZOICY Skincare | 7495896565308689324 | Reguler | Beauty & Personal Care | Non BD Hande | — |
| 802 | Zonanyamnyam | 7495117565643229260 | Reguler | Food & Beverages | Non BD Hande | 2027-01-31 |
| 803 | ZOTECH.WORLD | 7494191179680548142 | Reguler | Lifestyle | Non BD Hande | 2026-12-31 |
| 804 | Zwitsal | 7494925843634358389 | Running Bulan Pertama | Baby & Maternity | Alya | 2027-01-31 |
| 805 | ZYHA ID | 7496075837488793905 | Reguler | Luggage & Bags | Non BD Hande | 2026-12-31 |
| 806 | ZYHA STUDIO | 7496052348782545189 | Reguler | Luggage & Bags | Non BD Hande | 2026-12-31 |
| 807 | ZYLOX.ID | 7496188143240579317 | Reguler | Home Supplies | Non BD Hande | 2026-10-31 |
| 808 | Zymuno Store | 7494598694205557714 | Reguler | Health | Non BD Hande | 2026-10-31 |
| 810 | Rabito.Indo | 7496034574991264003 | Running Bulan Pertama | Home Supplies | Alya | — |
| 811 | Gokoco | 7495001863012255803 | Running Bulan Pertama | Beauty & Personal Care | Dania Tiffany | — |
| 812 | Royal Fragrance | 7494895786286418213 | Running Bulan Pertama | Fragrance | M Yaumal Mizan Firdaus | — |
| 813 | Hefand | 7495204413219506897 | Running Bulan Pertama | Luggage & Bags | M Yaumal Mizan Firdaus | — |
| 814 | COTTONINK | 7494001615299512006 | Running Bulan Pertama | Fashion | M Yaumal Mizan Firdaus | — |
| 815 | Gamal Men | 7494475766161573902 | Running Bulan Pertama | Fragrance | M Yaumal Mizan Firdaus | — |

## Langkah yang menunggu persetujuan Yohan
1. Apply migrasi 0097 ke produksi (sudah di staging).
2. "Promote ke Produksi": replace brand_deals produksi dengan isi sheet + soft-deactivate baris di bagian 7.
3. Apply migrasi 0098 (unique index) SETELAH data bersih.
4. Ubah role akun Campaign Ops (lihat docs/reports/mcn-todo-tim-21okt.md).