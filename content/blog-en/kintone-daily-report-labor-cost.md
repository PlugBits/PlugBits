---
slug: kintone-daily-report-labor-cost
lang: en
title: "Calculating Labor Cost from kintone Daily Reports: What Calculated Fields Can (and Can't) Do"
description: "kintone's calculated fields can multiply hours by rate for one daily report, but can't total labor cost across records by work order number. Here's how to see those totals with Graphs instead."
date: 2026-11-03
theme: B
keyword: "kintone calculate labor cost from work hours"
product: none
approved: true
reviewed: true
translated_from_sha1: f4b924bcd201b4efa43fc28078a7fcea527ebae8
translated_at: 2026-11-04T17:31:36-05:00
---

If you want to convert work hours from a kintone daily report app into labor cost, a calculated field that multiplies work hours by hourly rate will give you the labor cost for a single daily report using standard features. The hourly rate can be pulled in from a worker master app with a Lookup field. However, a calculated field cannot total labor cost across multiple daily reports for the same work order number (as of October 2026). To see totals by work order number, you need to use the Graph feature instead.

## A calculated field can multiply hours by rate to get labor cost for a single daily report

Calculated fields support multiplication between number fields. kintone's help documentation walks through an example of multiplying a Unit Price field by a Quantity field to automatically calculate a Subtotal field, using a simple formula format. You can set up the same kind of formula in a daily report app: multiply a Work Hours field (converted to a number of hours) by an Hourly Rate field, and the calculated field automatically produces the labor cost for that line. If the app uses a table (subtable) to list multiple work entries, you can use the SUM function to add up each row's subtotal, giving you the total labor cost for the entire record.

## Pulling the hourly rate from a worker master app with a Lookup field

If workers enter their hourly rate by hand on each daily report, it's easy to miss updating it when a worker's rate changes. kintone's help documentation explains that setting up a Lookup field lets you retrieve and copy the data you need from another app. Keep hourly rates in a worker master app, and set up a Lookup field in the daily report app so the rate is filled in automatically as soon as a worker is selected. If the rate in the source app changes later, values that have already been copied over do not update automatically, so you'll need to look up the rate again for those records after the change (as of October 2026).

## Checking that a Lookup's rate matches the source value in your app

To confirm the Lookup is working correctly, update the hourly rate for one worker in the worker master app, then create a new daily report for that same worker and check that the current rate is pulled in. Existing daily report records won't update automatically when the rate changes, so also open the rate field on older records and compare it against the source value. If there's a mismatch, that record needs to have its Lookup field triggered again to pull in the updated rate.

## You can't total labor cost across records for a work order number with a calculated field — use a Graph instead

A daily report typically records one worker, one day, and one work order number per entry, so adding up labor cost for the same work order number means aggregating across multiple records. A calculated field can't do this. kintone's help documentation lists the fields that can't be referenced in a calculation formula, and Related records is one of them — so even if you display daily reports as related records inside a work order management app, you still can't total that labor cost directly with a calculated field (as of October 2026). To see the totals, use the Graph feature: set the work order number as the grouping field and choose Total for the aggregation method on labor cost, and you can view labor cost by work order number as a graph or summary table. That said, there's no built-in way to automatically write that total back into a single field on the work order management app — this has to stay a manual, view-only process (as of October 2026).
