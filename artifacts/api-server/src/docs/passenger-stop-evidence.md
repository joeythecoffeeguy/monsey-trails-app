# Landmark boarding stops: evidence checked 2026-09-20

## Sources and method

The operator's [route descriptions and linked maps](https://www.monseytrails.com/routes)
are the boarding-location authority. Google My Maps KML point coordinates were
compared with named highway geometry from the
[OpenStreetMap map API](https://www.openstreetmap.org/api/0.6/map?bbox=-74.071,41.105,-74.059,41.118).
OSM road names establish geography, not permission to board at a nearby junction.
Distances below are approximate straight-line distances to shared road nodes,
not walking distances. No operational coordinates, raw descriptions, IDs, or
timing rules were changed.

Official maps (KML downloadable with `/maps/d/kml?mid=ID&forcekml=1`):

- [Route 1](https://www.google.com/maps/d/edit?mid=1Trdy3G4gRQ65OdxyYNFEoh7wkfEKtbfy)
- [Route 1P](https://www.google.com/maps/d/edit?mid=1Qcil1Z7SP0TQD-fieLDJSPfteA3WybNl)
- [Route 3](https://www.google.com/maps/d/edit?mid=1A26JGQh2BsawVJXaHVvI8PmbbL5F4_KT)
- [Route 3P](https://www.google.com/maps/d/edit?mid=1nzsmXfVQsUDmb9onyytevhD6Dj41hDY)

## Findings

| Stop | Evidence | Passenger label / decision |
| --- | --- | --- |
| Maple nursing home | Route 1/1P pin “Maple Ave” at 41.1158632, -74.067946 matches the existing coordinate. Maple/Phyllis OSM node 261811441 is about 80 m away; Maple/Main node 261788654 about 93 m. Route 3 uses a different pin at 41.1159187, -74.0673413. Text specifies “in front of the nursing home,” not either corner. | Keep **Maple Avenue — nursing home**; do not move to either junction. |
| Monsey Boulevard shelter | Route 1/1P pin at 41.1158955, -74.0620344; Route 3 pin at 41.1156479, -74.0619823. The first is about 58 m south of Maple (OSM node 261776473), and about 52 m north of Sunrise (261793462). Text explicitly distinguishes this shelter from the second West Central stop. | **Monsey Boulevard — bus shelter**. Do not alias shelter wording to the existing “corner Maple” coordinate merely because one map pin coincides with that alias. Bare “Monsey Boulevard” stays unqualified. |
| Amazing Savings | Route 1/1P pin “43 NY-59” at 41.1079204, -74.063017 matches the existing coordinate; Route 3 “Kosher Castle” is nearby at 41.1079115, -74.0628527. Road data includes Downtown Drive (way 1295693658) nearby, but the Route 59/Robert Pitt junction (261777285) is about 128 m away. No official boarding-corner instruction. | Keep **Amazing Savings bus shelter**; neither Downtown Drive nor Robert Pitt is a verified boarding intersection. |
| Monsey Park & Ride | Route 3P pin at 41.1064718, -74.0684144 matches the existing coordinate. Route 1P uses 41.1063672, -74.0678863. Route 59/Main/Saddle River junction (261794366) is about 135 m from the existing point. The route text identifies the lot, not the junction. | Keep **Monsey Park & Ride**. |

## Variant and safety boundaries

The published Route 1/1P/3/3P outgoing descriptions repeat the same nursing-home,
shelter, and Amazing Savings wording; P routes add the park-and-ride. New Square
through routes also use the Monsey descriptions. Return routes explicitly say
“Monsey Blvd corner Maple Ave” and “corner West Central”: those remain separate
verified intersection labels, not evidence for relabeling the outgoing shelter.
These display rules apply to pickup and dropoff summaries, independent of service
line. Tests exercise both Monsey and New Square area contexts and other-area
negative controls.

No new cross-street alias met the requested boarding-intersection standard.
The maps contain duplicate/offset pins and even a Route 3P “Park & Ride” pin at
the Amazing Savings location. Do not treat a map's nearest junction or a lone
pin title as sufficient verification. Resolve conflicts with the operator before
any future coordinate or boarding-location changes.

## Regional stop audit: 2026-09-22

The remaining Williamsburg, Flatbush, Lakewood, and Kiryas Joel wording was
checked against the operator's current [route page](https://www.monseytrails.com/routes).
Coordinates for explicit New York City intersections use the public
[MTA Bus Stops dataset](https://data.ny.gov/Transportation/MTA-Bus-Stops/2ucp-7wg5).
Kiryas Joel public-stop coordinates use the active Transit Orange
[Kiryas Joel Area Transit GTFS feed](https://www.transit.land/feeds/f-kiryas~joel~ny/versions/b92f47836c717d05669086bb4fc61497c032d311).
Transit Orange separately documents the Bais Medrash boarding shelter.
Named Lakewood landmarks were checked against their published addresses;
explicit intersections were checked against municipal street geometry.

| Published wording | Canonical stop decision |
| --- | --- |
| Bedford between Hewes and Hooper / 613 Bedford | **Bedford Avenue & Hewes Street** |
| Bedford between Wilson and Taylor | **Bedford Avenue & Wilson Street**, the public stop serving that block |
| Route Q Bedford/Wallabout | **Bedford Avenue & Wallabout Street** |
| Coney/Conery Island at Avenues N and J | Two ordered stops: **Coney Island Avenue & Avenue N** and **Coney Island Avenue & Avenue J**; “Conery” is a source typo |
| Squankum/Kennedy, across Astor | One stop: **Kennedy Boulevard & Squankum Road**; Astor describes the opposite side of the same junction |
| Westgate/Kosher West | **Westgate Shopping Center** |
| River Avenue at Evergreen | **Evergreen — 945 River Avenue**, using the market's published address |
| River Avenue at Kimball Hospital | **Monmouth Medical Center — 600 River Avenue**, the current name and published address of Kimball Medical Center |
| Bais Medrash | **Bais Medrash bus shelter**, corroborated by Transit Orange |
| Bais Hachaim | **Bais Hachaim — 82 Raywood Drive**, using the published landmark address |
| KJ Park and Ride / Garfield | Public GTFS stops **Kiryas Joel Park & Ride** and **Garfield Road bus stop** |

All other Lakewood and Kiryas Joel intersection wording is retained only when
both named streets form an explicit intersection in the operator description.
The resolver no longer sends an unmatched phrase to a general geocoder. An
unknown or changed phrase returns an unresolved-stop error so navigation cannot
silently invent a boarding point.

## Tishrei 2026 stop-role audit

The uploaded **Monsey Trails Tishrei '26** schedule, dated **September 11-October
8, 2026**, is the source for the catalog's pickup/drop-off defaults. Page 1
defines the P/Q/R symbols and route 7/8 distinctions; page 2 names the designated
Monsey, Boro Park, Manhattan, and Williamsburg stops and their roles. A catalog
role is only a union of evidenced uses: it does not make a conditional stop part
of every trip, and it does not change the scheduled route kind.

The Boro Park classification follows the rider-confirmed line distinction:
New York service starts at 18th Avenue/50th and continues on 49th; 18th
Avenue/49th starts Lakewood service only. The PDF's 50th Street drop-off and
Manhattan 5th Avenue 46th-to-23rd corridors are represented only by already
verified catalog stops, not invented intersections. Page 2 explicitly identifies
Bedford/Hewes and Bedford/Taylor as both pickup and drop-off and says there is no
highway pickup. Existing repository evidence identifies the verified
40.7053505/-73.958891 point as Bedford/Wilson, so the catalog preserves that
coordinate and label for the Wilson/Taylor block rather than claiming the point
is the Taylor intersection. Bedford/Wallabout remains conditional Q service; the
highway wording is not treated as permission to remove any custom stop.

Administrator-saved categories remain overlays and take precedence over these
published defaults. Stops in other service areas, and previously verified stops
not named by this PDF, retain their prior default classification.

## NYC physical-stop additions: Tishrei page 2

The page 2 corridor wording was checked against current rows in the public
[MTA Bus Stops dataset](https://data.ny.gov/Transportation/MTA-Bus-Stops/2ucp-7wg5).
The exact evidence query selected `stop_id`, `stop_name`, coordinates, route,
direction, and boarding/alighting fields for the active source rows:

<https://data.ny.gov/resource/2ucp-7wg5.json?$select=stop_id%2Cstop_name%2Clatitude%2Clongitude%2Croute_id%2Cdirection%2Cboarding%2Calighting&$where=in_effect%3D%27true%27%20AND%20stop_id%20in%28%27400516%27%2C%27301173%27%2C%27301174%27%2C%27301175%27%2C%27307619%27%2C%27301177%27%2C%27301178%27%2C%27301179%27%2C%27301180%27%2C%27306965%27%2C%27303427%27%2C%27300814%27%2C%27301286%27%29&$order=stop_id>

The Manhattan corridor now includes the all-purpose local M5 stop **400516**,
5 AV/W 46 ST at **40.756156, -73.979047**, as a catalog-only drop-off.
The Boro Park 50th Street drop-off corridor uses the eastbound B11 poles:
**301173** Fort Hamilton (**40.637656, -73.998083**), **301174** 11th Avenue
(**40.636887, -73.996815**), **301175** New Utrecht Avenue
(**40.635485, -73.994491**), **307619** 13th Avenue
(**40.634173, -73.992311**), **301177** 14th Avenue
(**40.632924, -73.990247**), **301178** 15th Avenue
(**40.631556, -73.987988**), **301179** 16th Avenue
(**40.630239, -73.985805**), **301180** 17th Avenue
(**40.628740, -73.983327**), and **306965** 18th Avenue
(**40.627499, -73.981263**). New Utrecht retains its actual stop name; it is
not presented as a synthetic 12th Avenue stop.

The rider-confirmed New York pickup remains **18th Avenue & 50th Street** at
MTA **300814** (**40.627930, -73.981252**). Its historical `both` category is
preserved for backward compatibility. The distinct B11 endpoint is cataloged
as **50th Street & 18th Avenue — drop-off**, so new consumers can retain the
directional curb position. The 49th Street pickup templates are unchanged, and
MTA **301286** at 18th Avenue/49th remains Lakewood-only.

Finally, page 2's Bedford/Taylor wording is represented by independent MTA stop
**303427**, BEDFORD AV/TAYLOR ST at **40.705825, -73.962904**, with a `both`
catalog role. The pre-existing Bedford/Wilson pin and label remain untouched;
Taylor evidence is not used to relabel that coordinate.

## Rockland Route 8 drop-off additions: Tishrei page 2

The five public-feed coordinates come from the verified Monsey Trails
[GTFS feed](https://s3.amazonaws.com/datatools-511ny/public/Monsey_Trails.zip):
stop **9jgr**, Maple Ave & Route 45 (**41.117476, -74.044177**); **hwr5**,
Maple Ave & Twin Ave (**41.117161, -74.050228**); **cth5**, Maple Ave &
Decatur Ave (**41.116979, -74.054589**); **ccok**, Remsen Ave & Route 59
(**41.10911412, -74.08070326**); and **3c3i**, Grove street & Saddle River
(**41.110945, -74.071434**). They are cataloged with normalized, explicit
intersection labels and the page 2 `dropoff` role. They remain catalog-only:
no route template, schedule, alias ordering, or manual override was changed.

The operator's official
[Route 8 KML](https://www.google.com/maps/d/kml?mid=1kmlwNbdmTLR39ScBgNOfcEZIe8AGTVCG&forcekml=1)
has corresponding pins for Maple/45, Maple/Twin, Remsen, and Grove/Saddle.
Those pins differ from the GTFS points by approximately 5-40 metres, so the
operator GTFS coordinates are used consistently for all five feed records.
The KML has no separate Decatur pin.

The GTFS has no Route 306/Maple record. For that sixth page 2 drop-off, the
official Route 8 KML pin **41.116215, -74.0688627** is used. The Transport of Rockland
MOMA stop is named incorrectly near Monsey Boulevard and is not evidence for
Route 306/Maple; Monsey Boulevard/Maple remains a separate stop at its existing
coordinate. These coordinates designate operator stops only. No physical pole,
shelter, platform, or other fixture has been verified or claimed.

## Published wording release audit: 2026-09-23

Run `pnpm --filter @workspace/api-server run audit:schedule-stops [YYYY-MM-DD]`
before release. It reads the operator homepage's current line/direction list and
every available run over seven service dates, then checks the exact parsed stop
phrases against verified aliases. It reports date, direction, run, area, and
unresolved source wording. It deliberately does not use the geocoder or write
coordinates; a failure needs evidence review, not an automatic coordinate guess.
Empty directions are reported separately, including Wall Street, which had no
runs during this audit week.

The following new source spellings were confirmed against **existing** stop
records rather than mapped to newly guessed positions:

| Source wording | Existing curbside evidence retained |
| --- | --- |
| “Drops off on 9Th Ave and 34Th street” | B&H at 34th/9th, MTA stop **401818**, 40.753106, -73.995857 (the existing 34th/9th alias). |
| “On Old Nyack Tpk. Corner S Madison (Chaya Sarah hall).” | Same named Old Nyack/South Madison intersection and Chaya Sarah Hall landmark as the pre-existing alias, 41.101364, -74.047608. |
| “Route 59 corner Robert Pitt.” | Same explicitly named Robert Pitt/Route 59 junction as the pre-existing return-stop alias, 41.107788, -74.064541; not the nearby Amazing Savings shelter. |
| “Cross Street corner Granite drive (satmar)” | Same Cross/Granite intersection as the pre-existing “satmer” source alias, 40.055448, -74.222459; only the parenthetical spelling differs. |

The audit still fails on runs with neither description and on Kiryas Yoel →
Monsey drop-off narratives that list turns across several roads without naming
a verified final boarding point. Those are **not** mapped to the last mentioned
intersection or a geocoder result. Ask the operator for exact curbside evidence
before treating those descriptions as passenger stops. Until then the release
preflight's nonzero exit is intentional.