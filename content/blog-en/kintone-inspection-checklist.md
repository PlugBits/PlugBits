---
slug: kintone-inspection-checklist
lang: en
title: "How to Build an Equipment Inspection Checklist App in kintone (Daily and Monthly Inspections)"
description: "Build an inspection checklist app in kintone using an equipment master Lookup field, a table for inspection items, radio buttons, mobile entry, and reminder notifications — all with standard features."
date: 2026-10-29
theme: B
keyword: "kintone equipment inspection checklist"
product: none
approved: true
reviewed: true
translated_from_sha1: 18cf65015b6b8ac4a3cee610dcd27ec52f8eddd4
translated_at: 2026-10-31T18:31:46-04:00
---

You can build an inspection checklist in kintone with standard features alone: a Lookup field that pulls equipment data from a master app, inspection items listed in a table (subtable), pass/fail judgments with radio buttons or check boxes, mobile entry, and reminder notifications. What the official help does not document (as of October 2026) is a setting that automatically populates a table with multiple inspection-item rows when a new record is created. On sites where the number of items varies by piece of equipment, staff have to re-add the rows each time.

## Separate the equipment master app and the inspection app, and pull equipment details with a Lookup field

The standard pattern is to keep equipment data in its own master app, then use a Lookup field in the inspection app to bring in the equipment name, installation location, and asset number. The official kintone help explains that when you select a record in the referenced app, the corresponding data is copied in automatically.

This setup cuts down on manual entry the most at sites with many pieces of equipment and multiple people doing inspections. If a site only has a handful of machines and the people doing the inspections already know the details, a simple text field without a separate master app is enough.

## List inspection items in a table (subtable), and record pass/fail with radio buttons or check boxes

Adding a table inside the inspection app lets you list several inspection items, such as checking oil level, checking for unusual noise, or checking cleanliness, as multiple rows within a single record. The official help notes that you can add rows with the "+" button while creating or editing a record. For each row, you can capture the judgment with a radio button field, which allows only one selection, or a check box field, which allows multiple selections.

A radio button is enough for items that only need a pass/fail choice. Check boxes work better for items where more than one condition or task needs to be recorded. When the number of items differs by piece of equipment, you'll run into the limitation described in the next section.

## Check the mobile entry screen and reminder notification settings

Whether the checklist works well on a smartphone, and whether kintone can notify staff of the next inspection date, are both things you can verify directly in the settings screen and on a phone.

In the inspection app's notification settings, you can add a "Reminder notification" and choose a date field as the reference date; the official help explains that you can then specify how many days before or after that date the notification should go out.

Opening kintone on a smartphone and going to the screen for adding an inspection record lets staff add rows to the table and select a judgment for each one. kintone's list of things the mobile version cannot do includes "displaying table fields and attachment fields on the record list screen" (as of October 2026). For anyone who wants to review several inspection results at a glance from the list, opening each record one at a time remains the only option (as of October 2026).

## When inspection items differ by equipment, the table's initial rows aren't created automatically

When the number or order of inspection items varies by type of equipment, every new inspection record requires staff to add the table rows from scratch again.

The official help's explanation of tables covers adding and deleting rows and running SUM totals from outside the table, but it does not document a setting that pre-populates multiple rows as defaults and displays them automatically on a new record (as of October 2026).

For sites where every piece of equipment uses the same items in the same order, duplicating one record that already has the rows set up and reusing it adds no extra work. For sites where items differ significantly between pieces of equipment, duplication doesn't solve the problem, and some manual adjustment each time remains necessary.
