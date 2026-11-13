---
slug: kintone-equipment-maintenance-history
lang: en
title: "How to track maintenance history for each piece of equipment in kintone"
description: "Link an equipment master app and a maintenance log app with a Lookup field and a Related Records field to see each machine's full history, but search across equipment from the maintenance log app (as of October 2026)."
date: 2026-11-12
theme: B
keyword: "kintone equipment maintenance history by machine"
product: none
approved: true
reviewed: true
translated_from_sha1: 9ded6a212902b3b8de8621ef90af58da2f8bc3b0
translated_at: 2026-11-12T17:31:57-05:00
---

To keep maintenance history organized by piece of equipment in kintone, build two apps: an equipment master app and a maintenance log app. Give the maintenance log app a Lookup field that pulls in equipment information from the master app, and add a Related Records field to the equipment master app that points back to the maintenance log. Open any equipment record's details screen and its maintenance history appears as a list right there. The one thing this setup cannot do is let you search across all equipment at once from the Related Records field itself, so cross-equipment search needs to happen from the maintenance log app instead (as of October 2026).

## Link an equipment master app to a maintenance log app with a Lookup field and a Related Records field

In the maintenance log app, add a Lookup field keyed on the equipment name or equipment code from the equipment master app, then record each repair date, description, and the person who handled it as maintenance happens. In the equipment master app, set up a Related Records field that references the maintenance log app. Once that's in place, opening an equipment record's details screen shows every maintenance record tied to that piece of equipment, all in one list. For anyone who needs to trace "what was done, and when" for a specific machine, this two-app structure handles it with standard kintone features alone.

## Why you still need to search from the maintenance log app to look across all equipment

According to kintone's official documentation, a Related Records field cannot be displayed on a record list screen, and it is excluded from Totals, Auto-Calculation, and in-app search (as of October 2026). In practice, that means the equipment master app's list screen cannot show maintenance record counts or the most recent maintenance date for each machine, and there is no way to search all maintenance records across equipment from that list. To find out which equipment has the most repairs, switch perspective to the maintenance log app itself: filter its list view by the equipment Lookup field, or use a graph to total record counts by equipment.

## Enter a few maintenance records and check how the equipment master app's detail and list screens actually behave

A good way to confirm this setup works as expected is to register two or three maintenance records for the same piece of equipment, then open that equipment's record in the master app and verify the records appear in the Related Records field. Next, open the equipment master app's list screen and confirm that maintenance record counts and details do not show up there. Seeing both behaviors side by side makes it clear that "viewing history on the details screen" and "searching across equipment in a list" are two separate mechanisms, which is a useful thing to know before finalizing the app design.

