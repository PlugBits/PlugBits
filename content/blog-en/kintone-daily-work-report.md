---
slug: kintone-daily-work-report
lang: en
title: "How to track a daily work report in kintone: who worked on which job number, for how long"
description: "Build a kintone daily work report with a table (subtable), Lookup and Calculated fields and graphs. Covers the category limit and an unconfirmed point in time totals."
date: 2026-10-28
theme: B
keyword: "kintone daily work report by job number"
product: none
approved: true
reviewed: true
translated_from_sha1: 9a814634d36f7f195ad0ca61646252030d5f2884
translated_at: 2026-10-30T18:31:32-04:00
---

A daily work report that tracks who worked on which job number, on which process, and for how long can be built with kintone's standard features. Add a table (subtable) to line up each work entry, use a Lookup field inside each row to pull in the job number, and subtract the start time from the end time to calculate hours worked. Two things are worth checking before you rely on this setup: a graph that groups totals by person, job number and process at the same time runs into the category limit, and the official kintone help does not confirm how a Calculated field formatted as "time" is displayed once it is summed in a graph.

## Line up work entries in a table (subtable) and pull in the job number with a Lookup field in each row

A table (subtable) is a field type that lets you add or remove rows, which makes it well suited to managing several entries in one list. Place a table on a single daily report record, and let each row represent one job: add columns for job number, process, start time and end time. No matter how many job numbers or processes someone handles in a day, everything stays on a single record.

To pull in the job number for each row, set up the Lookup field inside the table so it references the job number master app. Note that a Lookup field can only copy retrieved data into fields within the same table, so related information such as a process name also needs to be copied into a field in that same row. This way, the person filling out the report only needs to select a job number instead of typing it in by hand.

## Subtract the start time from the end time to calculate hours worked automatically

Hours worked can be calculated with a Calculated field that subtracts the start time from the end time. If you need to subtract a break, convert the break length to seconds by multiplying the minutes by 60 before subtracting it, because kintone's date and time calculations work in seconds. The raw result is a number of elapsed seconds, so you'll need to set the display format of the Calculated field to "Time" to show it properly.

If you want to total the hours worked across a single record, a calculation formula outside the table can call the SUM function. However, only SUM and CONTAINS are available in these formulas, so you cannot build a conditional total such as "only sum the rows for job number A."

## Graphs can total hours by person or job number, but you're limited to three category levels

To total hours worked by person or job number, create a graph from the record list screen. Choose "Table" as the graph type, set person, job number and process as the categories, and choose "Total" as the aggregation method; the graph will then show the total hours for each value.

There is a limit, though: you can only use up to three category levels — major, medium and minor. If you use person, job number and process all as categories at once, you'll hit that limit and won't be able to add a fourth category such as date. If you also want to see a monthly trend, you'll need to build a separate graph for that.

## How to check whether a graph still shows totaled hours worked in the time format

When a Calculated field formatted as "Time" is used as the aggregation target in a graph, the official kintone help does not state whether the result is displayed in time format (for example, 3:30) or reverts to the underlying number of seconds (as of October 2026). It's worth confirming this before you put the report into production, using the following steps:

1. Prepare a handful of test rows with start and end times, mixing rows with and without a break.
2. Check that the hours worked for each row display correctly in time format.
3. Set the same field as the "Total" target in a graph, and check whether the totals by person or job number are still readable as a time value.

If the result comes out as a plain number instead, you can either divide the figure by 60 or 3,600 to read it as time, or keep a separate numeric field just for aggregation purposes.

