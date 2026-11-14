---
slug: kintone-equipment-introduction-schedule
lang: en
title: "How to track equipment installation schedules in kintone (from order to setup)"
description: "Use kintone's date fields, list view sorting and filtering, plus built-in reminder notifications (up to 10 conditions) to track equipment installation schedules without customization."
date: 2026-11-13
theme: B
keyword: "kintone track equipment installation schedule"
product: none
approved: true
reviewed: true
translated_from_sha1: c0f80767399c367c01f749f3d7341855d2b90d04
translated_at: 2026-11-13T17:31:13-05:00
---

When you need to track an equipment installation schedule in kintone — from order date through delivery and on-site installation — you can reduce missed deadlines using only standard features: date fields, list view sorting and filtering, and reminder notifications based on a due date. This approach does not try to recreate a dedicated Gantt-chart style view. Instead, it treats each schedule as a record that says "what needs to happen by when," and lists those records so the next action is always clear.

## Track the schedule with date fields and list view sorting and filtering

For an equipment installation schedule, add date fields to the app such as order date, expected delivery date, and installation date, then sort the list view by one of those dates. Sorting alone lets you see upcoming items in order, starting with whichever date is closest. Filtering narrows the list further — for example, showing only records with a date somewhere in the current month, or only records where installation is not yet complete. When several pieces of equipment are being introduced in parallel, combining list view sorting with filtering makes it possible to tell at a glance which piece of equipment needs attention next.

## Set up due-date notifications with kintone's built-in reminder feature

When you want to be notified as an installation date (or any other date) approaches, kintone's reminder notification feature can handle it. You choose the date field to use as the basis, set how many days before that date and at what time the notification should fire, and you can add conditions such as limiting the reminder to records whose status is still "Not started." Notification recipients can include the record's creator, the record's updater, or whoever is specified in a user selection field. There is a limit of 10 reminder conditions per app, and each notification run can target up to 500 records. As long as the number of equipment installation schedules due at the same time stays under 500, this limit is not something app administrators need to worry about.

## Test the reminder conditions on a single record before rolling it out

Before applying reminder conditions to the entire production app, it helps to register one placeholder equipment record and set up the notification timing and conditions on that record alone. After configuring the number of days and time relative to the base date, along with any status conditions, confirm with that single test record that notifications arrive as expected. Doing this check first avoids spending extra time reconfiguring the conditions after multiple real equipment records have already been added.

