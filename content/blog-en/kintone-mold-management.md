---
slug: kintone-mold-management
lang: en
title: "Can kintone Manage Molds and Tooling? How Far the Master List, Maintenance Reminders, and History Go With Standard Features"
description: "Build a mold master list with Lookup, send maintenance reminders with conditional notifications, and view history with Related Records. Usage-count alerts aren't built in (as of October 2026)."
date: 2026-11-10
theme: B
keyword: "kintone mold and tooling management"
product: none
approved: true
reviewed: true
translated_from_sha1: 83d2d6a39fc40b9a00789fbb4127d0509eca4bf0
translated_at: 2026-11-10T17:32:41-05:00
---

If you want to track molds and tooling one by one in kintone, you can build a master list with a master app and Lookup fields, and use conditional notifications (reminders) to flag upcoming maintenance and inspection dates. Usage history and maintenance history can be gathered on one screen with a Related Records field. However, kintone's standard features don't automatically warn you when a mold's usage count passes a limit, and they don't automatically rebuild maintenance schedules across multiple molds (as of October 2026).

## Build a per-mold master list with a master app and Lookup

Start by creating a mold master app that holds one record per mold, with fields such as a management number, model/type, and storage location. On the usage-log and maintenance-log apps, add a Lookup field that pulls in the management number so staff don't have to re-type the mold's details. The official kintone help explains that "setting up a Lookup field lets you retrieve and copy the data you need from another app," and this is built around clicking **Copy** on screen to pull the value in. Because values copied this way aren't updated automatically when the master record changes, updating a mold's model or storage location in the master app won't fix older records already saved in the usage log (as of October 2026).

## Use conditional notifications (reminders) to flag upcoming maintenance and inspection dates

To avoid missing a maintenance or inspection date, you can use kintone's conditional notifications, often referred to as reminders. The official kintone help states that you "specify how many days before or after the date in the reference date field the notification should be sent." Add a field such as "Next inspection date" to either the mold master app or the maintenance log app, set it as the reference date, and a notification goes out a set number of days ahead. This feature assumes someone enters the inspection date manually, so unless inspection records are logged separately, the next date won't be calculated for you automatically (as of October 2026).

## Check in the settings screen whether usage and maintenance history can appear on one screen per mold

If you want to see all the usage and maintenance records for a mold gathered together when you open its master record, a Related Records field is the standard option to check. Open the settings screen and confirm there's a place to specify both the mold master app and the field in the usage/maintenance log app that links back to it. The official kintone help states that "placing a Related Records field lets you display, as a list, the records in the specified app that match the set conditions." The result is shown as a list, and each record still has to be opened individually to see its details. You also can't select a usage or maintenance log app as the link target until that app already exists.

## How far can usage-limit tracking and automated maintenance planning go with standard features?

Combining a master list, reminders, and a Related Records field lets you keep a mold's basic details, upcoming inspection dates, and history organized using only standard kintone features. That said, the official kintone help doesn't document any feature that automatically warns you once a mold's usage count passes a limit, or that automatically rebuilds maintenance schedules across multiple molds (as of October 2026). The official help also states that values shown in a Related Records field "are not included in totals, Calculated fields, or in-app search," which means you can't have kintone automatically count the number of history records or tally up usage counts from a Related Records field either (as of October 2026). If you need automatic usage-limit tracking or automated maintenance planning, you'll need to count usage manually or bring in an additional tool.

