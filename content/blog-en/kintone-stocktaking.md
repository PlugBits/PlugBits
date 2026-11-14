---
slug: kintone-stocktaking
lang: en
title: "How to Record Stocktaking Checks in kintone Using the Checkbox Field"
description: "Checkbox fields can be edited directly in kintone's list view, so items can be checked off on the spot, with updated date and updater logged automatically on save."
date: 2026-11-13
theme: B
keyword: "kintone edit records directly in list view"
product: none
approved: true
reviewed: true
translated_from_sha1: 87310e9e6cb0adc43a0946cbe50bfdc003808eb7
translated_at: 2026-11-13T17:32:09-05:00
---

When recording stocktaking (physical counts of inventory or fixed assets) in kintone, a checkbox field lets you check off items as confirmed without leaving the record list screen. The official kintone help documentation lists the checkbox field among the field types that can be edited directly from the record list view. Because there is no need to open each record's details screen one by one, this standard setup can handle a stocktaking workload with a large number of items as-is.

## Checking items off in the list view is a standard feature

kintone's record list view supports inline editing for certain field types, including Text, Number, Date, Checkbox, and Drop-down fields. A checkbox field used to mark an item as confirmed during stocktaking falls into this group. You can list all the items to be counted in the list view and check each one off as it's physically confirmed, with no additional configuration required. If you also add "Updated datetime" and "Updater" fields to the app, kintone automatically records who made a change and when, each time a record is edited and saved. The official help documentation doesn't specifically state whether checking a box from the list view counts as this kind of save (as of October 2026), but it does say that these fields are recorded "when a record's content is changed and saved," so saving from the record details screen will always trigger the update.

## Recording who checked an item or color-coding rows isn't part of the standard settings

While checking boxes from the list view is itself a standard feature, the kintone help documentation on inline list editing doesn't describe any setting for logging the person and time into a dedicated field the instant a box is checked, or for changing the appearance of rows that have already been checked (as of October 2026). Adding that kind of behavior would require customization that changes how the screen displays or how records are saved. For smaller stocktaking operations, the Updated datetime and Updater fields may already provide enough of a record, and the standard checkbox plus inline list editing is enough to get started. The decision about whether to go beyond the standard feature set typically comes up once requirements grow, such as needing to track who checked which item individually or wanting unchecked items to stand out visually.

## Test the save behavior with sample records before the real stocktaking

Before relying on checkboxes and inline list editing for an actual stocktaking count, it's worth setting up a handful of test records first. Check a few boxes directly from the list view and confirm how the Updated datetime and Updater fields update. It also helps to check what happens when a box is unchecked, and whether the screen keeps up when several records are checked off in quick succession. Working through this ahead of time helps avoid surprises on the day of the actual stocktaking if the behavior doesn't match expectations.

