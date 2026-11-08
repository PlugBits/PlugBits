---
slug: kintone-list-date-filter
lang: en
title: "Can kintone filter one date field against another in list view? (As of October 2026)"
description: "kintone's list filters support on/before and before for date, time, and date/time fields, but only against a fixed date — not against another field (as of Oct 2026)."
date: 2026-11-06
theme: A
keyword: "kintone compare two date fields in list filter"
product: none
approved: true
reviewed: true
translated_from_sha1: 4601801e7c72daab44e51bf6f79e09cfc0a4dd98
translated_at: 2026-11-07T17:31:57-05:00
---

In kintone's list view filters, the [date], [time], and [date and time] fields support operators such as [on or before] and [before]. However, these only compare a field against a fixed date you enter. Based on the official kintone help documentation, there is no way to set the comparison value to another field — for example, filtering for records where the date in Field A comes before the date in Field B (as of October 2026).

## Date field filters only support operators like "on or before" and "before" against a fixed value

The official kintone help documentation covers filtering [date], [time], and [date and time] fields using operators such as [on or before] and [before]. In every example, what the field is compared against is the fixed date value entered as the filter condition.

When you open the screen to save a filter condition for a list view, you can choose an operator from the list that matches the date field you want to filter. The value field is where you enter a date — there is no option in the official help documentation for selecting another field as the comparison target (as of October 2026).

## The comparison target is a fixed date, and there's no documented way to specify another field

The "Filtering Records Displayed in List View" help page confirms that the values you can specify for a filter condition are either a value you enter or "blank." There's no description of an option that lets you compare against the value of a different field. Based on the official kintone help documentation, there is no standard setting that lets you compare the dates in Field A and Field B using only a list view filter (as of October 2026).

There's also an important caveat: the official help documentation states that for conditions like [on or before], "records where the field's value is blank are also included in the filter results." This means records with no date entered can end up mixed into your results. If you want to exclude them, you need to add an "is not" and "blank" condition and combine it with your existing filter.

## Count the results to check whether more records are showing up than you expect

Start by preparing a few test records where the date field you want to filter has no value entered.

Next, filter the list view using an [on or before] or [before] condition, and check whether any records with a blank date are mixed into the results. If the count is higher than you expected, blank records may be included.

If that's the case, add "is not" and "blank" conditions to the same filter, select "Match all of the following conditions," and run the filter again.

