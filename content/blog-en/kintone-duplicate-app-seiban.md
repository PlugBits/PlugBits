---
slug: kintone-duplicate-app-seiban
lang: en
title: "Does Duplicating a kintone App Copy Your Records? What Happens to Record Numbers"
description: "Duplicating a kintone app does not carry over records, and duplicated apps are not linked together automatically—each one numbers its records separately (as of October 2026)."
date: 2026-11-02
theme: B
keyword: "kintone duplicate app does not copy records"
product: none
approved: true
reviewed: true
translated_from_sha1: d3e7458f63c35957ad7aa71e164ff804eaf38a80
translated_at: 2026-11-03T17:31:15-05:00
---

In kintone, duplicating (copying) an app does not carry over the records (data) from the original app (as of October 2026). There is also no feature that automatically links duplicated apps together, and after duplication each app assigns its own record numbers as a sequence starting from 1, based on the order records are created in that app. Before you duplicate an app for each work order number, you need to confirm these two points.

## When You Copy an App, Records (Data) Are Not Carried Over

When you duplicate an app, the structure itself — the form settings, the source apps referenced by Lookup fields, and so on — is copied, but the record data is not (as of October 2026). The official kintone help clearly states: "When you create a new app by copying (reusing) another app, the app's record data is not carried over." In a workflow where you create a new app for each work order number, the duplicated app starts out with no records, so any master data you need (such as item numbers or customer names) has to be re-entered by hand or imported separately from a file. If your plan assumes that "duplicating the app also carries over its contents," duplicating an app per work order number will not work that way (as of October 2026).

## Duplicated Apps Aren't Automatically Linked, and Each App Numbers Its Own Records

There is no feature that automatically links the apps you end up with after duplication (as of October 2026). The help pages that explain app duplication do not mention any feature for syncing or linking data between the original app and the duplicated app (as of October 2026). Because record numbers are "assigned sequentially in the order the records were created," a newly duplicated app also starts numbering from record 1, which means you can end up with a record numbered, say, "1" in both the app for work order A and the app for work order B — two separate records with the same record number. If you want to avoid that kind of duplication, you need to design the app so the work order number itself is stored in a text field, rather than relying on the record number.

## How to Check What Doesn't Carry Over When You Duplicate Your Own App

Duplicate one of your apps and open the new app to check whether any records came with it. If none did, export the records you need from the original app and import them into the new app, then verify that the values match. Next, check whether the original app and the duplicated app end up with any matching record numbers. If they do, that confirms the record number alone cannot be used to uniquely identify a work order number.

## Adding a Work Order Field to One App Fits Standard Functionality Better Than Duplicating an App Per Work Order

Rather than duplicating an app for every work order number, designing a single app with a field that identifies the work order number lines up better with kintone's standard functionality. Related records works on the principle that "records whose values match the field you want to link on are displayed in the Related Records field," so if you add a work order number field to a single app, you can view all the records for the same work order number together. If you add one field to identify the work order number instead of duplicating the app, you avoid the record-number duplication problem entirely. There can still be a reason to duplicate an app — for example, if you need to completely separate permissions or notification recipients per app — but in that case you need to plan your operations around the fact that records will not carry over and record numbers will overlap.
