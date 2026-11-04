---
slug: kintone-subtable-horizontal-scroll
lang: en
title: "kintone table (subtable) field too wide to read? Fixing horizontal scroll without removing columns"
description: "kintone's table (subtable) field has no setting to freeze columns or remove horizontal scrolling (as of October 2026). Here's what reordering fields can and can't fix."
date: 2026-11-02
theme: A
keyword: "kintone table field too many columns horizontal scroll"
product: gep
approved: true
reviewed: true
translated_from_sha1: e7f659305b016fc8692b8e636d50cc971efb6f45
translated_at: 2026-11-03T17:32:58-05:00
---

A kintone table (subtable) field gets wider every time you add a column, and the input area stretches out horizontally. The standard settings have no option to freeze columns or remove horizontal scrolling altogether (as of October 2026). The only thing you can do is reorder the fields so the ones you use most often sit toward the left. On a table with many child fields, reordering alone won't get rid of the horizontal scroll.

## The standard table field has no setting to freeze columns or remove horizontal scrolling

The table field's settings screen has no items for freezing columns or auto-adjusting width (as of October 2026). The kintone help page that explains the table field doesn't mention column display, column width, or horizontal scrolling either (as of October 2026). In an app with ten child fields inside a table, all ten columns line up side by side on the record add/edit screen, and anything that doesn't fit on screen has to be checked by scrolling horizontally. On the record list screen, you can choose and save column widths either app-wide or per user, but that's a list view display setting — it doesn't apply to the columns inside a table field (as of October 2026). The more child fields a table has, the more horizontal scrolling stays in place as standard behavior (as of October 2026).

## Reordering fields lets you move frequently used columns to the front

You can change the order of fields inside a table even after the app has been published. The official kintone help lists reordering fields inside a table as one of the operations you can still make after an app is already in use. If you group the fields you fill in every time at the left edge, they show up as soon as you open the screen, and in many cases you can finish entering data without scrolling at all. That said, scrolling to check columns placed further to the right still remains. Reordering reduces the effort of data entry, but it doesn't solve the effort of reviewing data.

## Checking how far reordering a table's columns can take you in your own app

Open the table field from the app's settings screen and drag the child fields to change their order. Save the change, update the app, then open the record details or edit screen to confirm the columns now appear in the order you intended. Reordering doesn't change the width of the columns themselves, so on the same screen it's worth checking whether a field with a lot of text still stretches as far horizontally as it did before.

## Reordering alone isn't enough once a table has a lot of columns

For a table with around four or five child fields, reordering alone cuts down data entry effort quite a bit. On the other hand, for a use case like comparing around ten inspection results side by side, reordering doesn't reduce the work of hunting for the column you need. The more a workflow depends on not being able to cut down the number of columns, the more often standard reordering alone falls short.

Another option is a dedicated editing screen that automatically adjusts column width to fit the content and remembers the same width the next time you open it (Grid Edit Pro).
