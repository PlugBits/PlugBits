---
slug: kintone-latest-record-only
lang: en
title: "How to Show Only the Latest Record per Customer or Item Number in a kintone List View"
description: "kintone's list filters, sorting, and graphs can't keep only the latest record per group (Oct. 2026); a flag field or Related records view gets you closer."
date: 2026-10-30
theme: A
keyword: "kintone show only the latest record per group in list view"
product: none
approved: true
reviewed: true
translated_from_sha1: 92632af11ccc4cfc27da58d1c13cb2afdb5575e7
translated_at: 2026-11-01T17:32:36-05:00
---

None of kintone's list view filters, sorting, or graphs (reports) include a setting that keeps only the "latest" record for each customer or item number, as of October 2026. Each of these features works on individual records or display order, with no mechanism for picking one representative record out of a group, as of October 2026. Two workarounds can get you closer: using a flag field with a filter condition, and using the sort order and display count on a Related records view.

## Filters, sorting, and graphs work on individual records, not group representatives

According to the official kintone help, the conditions you can set for a filter are field values, relative date conditions, whether a field is blank, and status. Each of these conditions applies to a single record, and there's no condition that compares records to find the latest one within the same customer or item number group, as of October 2026. The fields available for sorting are limited to those listed in the official help (Related records views and tables (subtables) aren't included), and changing the sort order alone doesn't reduce the number of records shown. Graphs (reports) can group data up to three levels deep, but they can only return a count, sum, average, maximum, or minimum — not display a single record, as of October 2026.

## To filter within the list view itself, combine a flag field with a filter condition

If you want to filter within the list view itself, add a field such as a checkbox, give it a value like "Latest," and point your filter condition at that field. A single condition — "Latest = checked" — narrows the list down to only the checked records. However, every time a new record is added, someone has to separately uncheck the old record and check the new one. The filter feature has no setting that reassigns this flag automatically, so if that step is forgotten, old records stay in the results too.

## To show it on a customer or item record's details screen, get closer with a Related records view's sort order and display count

Rather than on the list view, if you want to show only the latest record on the record details screen of your customer or item number master app, you can use a Related records view. According to the official help, this is a feature that matches records in another app against a condition and displays them as a list on the "record details" screen. Along with the filter condition, the settings include "Sort" for the records and "Maximum number of records displayed at a time." Set the sort order to descending by update date/time and limit the number shown, and you can get close to showing only the latest record. However, this list can't be shown on the destination app's own list view — it's only visible on the details screen.

## Steps to check how far you can narrow down a Related records view in your own app

The specific numbers available for the display count don't appear in the body of the official help, as of October 2026. Following these steps in your own app shows you the available range:

1. Open the form settings for your customer or item number master app and add a Related records field.
2. Specify the destination app to link to and the field to match records on.
3. Set the condition, the record sort order (descending by update date/time), and the maximum number of records displayed at a time, then save.
4. Open a record's details screen in the master app and check whether the count and sort order match what you intended.

These steps let you confirm, directly in your own app, the range of numbers you can choose from.
