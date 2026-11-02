---
slug: kintone-sort-multiple
lang: en
title: "How to sort a kintone list view by multiple fields (like date, then person in charge)"
description: "kintone list view sorting supports up to five stacked conditions, each with its own ascending/descending order, but only certain field types can be used (as of October 2026)."
date: 2026-10-30
theme: A
keyword: "kintone sort list view by multiple fields"
product: none
approved: true
reviewed: true
translated_from_sha1: 766f1406fdd824c749975424f610a4dd324498d7
translated_at: 2026-11-01T17:32:55-05:00
---

Sorting a kintone list view lets you add sort conditions one at a time, up to five in total, and you can choose ascending or descending order for each condition separately (as of October 2026). However, only certain field types can be used for sorting, and related records fields and tables (subtables) cannot be sorted at all (as of October 2026). The kintone help documentation, as of October 2026, does not describe a way to switch the sort order simply by clicking a column header in the list view.

## You can stack multiple sort conditions by adding them one by one

According to the official kintone help, "You can specify up to five sort conditions." Each time you add a condition, you choose a field and set its own ascending or descending order, so building a two-step (or more) sort — for example, sorting by date first and then by person in charge — is possible with standard settings alone. A sort like "date order, then person in charge order" fits comfortably within this limit.

## Only certain field types can be used as sort conditions

Not every field type can be used in a sort condition. The kintone help page on which fields can be selected for sorting lists Record number, Created by, Updated by, Created datetime, Updated datetime, Text (single-line text), Number, Calculated field, Radio button, Drop-down, Date, Time, Date and time, Link, Lookup, and Process management status as sortable field types, and explicitly states that related records fields and fields set as a table (subtable) cannot be sorted. Text (multi-line), Check box, Multi-choice, and Attachment fields are not included in this list (as of October 2026). Another easy detail to miss: when you sort by Created by or Updated by, the order is not alphabetical by name. The official help states that it follows the ascending or descending order of the user ID assigned when the user was added, not the person's name.

## There's no click-the-column-header shortcut — you open the sort settings screen instead

Standard kintone does not appear to offer a way to switch sort order just by clicking a column header in the list view. According to the official help, sort settings "can be configured from the record list screen, the filter screen, the list settings screen in the app settings, Lookup settings, and related records list settings." You can change the sort order from the list view itself, but doing so means opening the settings entry point and specifying the conditions there, not clicking a header to toggle order. The kintone help documentation, as of October 2026, does not describe a column-header-click shortcut for changing sort order. The settings screen where you add conditions one at a time supports up to five conditions, so it's enough if you need to build out a detailed priority order.

## Checking after setup that a multi-condition sort behaves as intended

After setting up a multi-condition sort, it helps to check that it behaves as intended before saving, so you don't have to redo it later.

1. Add your sort conditions in order — for example, Date as the first condition and Person in charge as the second.
2. Open the list view and confirm that, among records sharing the same first-condition value, they fall in the expected order for the second condition.
3. Check that the ascending/descending order for each condition isn't reversed from what you intended.
4. If everything looks right, save the settings.

Checking after you add each condition makes it easier to catch mistakes even when you build up to the full five conditions.
