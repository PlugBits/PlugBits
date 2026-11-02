---
slug: kintone-gantt-chart
lang: en
title: "Does kintone Support Gantt Charts? What List Views and Graphs Can (and Can't) Show"
description: "kintone's official help does not document a Gantt chart feature (as of October 2026). See how close Calendar view, List view, and Graphs get to a process schedule by job number."
date: 2026-10-30
theme: B
keyword: "kintone gantt chart"
product: none
approved: true
reviewed: true
translated_from_sha1: 24ac4c32b33beba30e004b5edcb8f2a703f9f32f
translated_at: 2026-11-01T17:31:49-05:00
---

For the request "I want to see the schedule and actuals for each job number as a horizontal-bar process chart (Gantt chart)," the official kintone help does not describe a Gantt chart feature (as of October 2026). The closest standard ways to display this are a calendar-style list, a table-style list sorted by date, and a graph. Here is what each one can and cannot show.

## List views come in three types: table, calendar, and customization

Standard list views come in three types—table, calendar, and customization—and none of them lays out records as horizontal bars (as of October 2026). A table-style list lets you choose which fields to display, set the sort order, and set display conditions, so sorting by a start date or end date field will line up job numbers in date order. A calendar-style list lets you pick a single Date or Date and time field to control the display, and records appear on the matching date on the calendar. Both a date-sorted list and a calendar view let you track scheduled dates to some extent, but neither draws a period as a single horizontal bar (as of October 2026). What a standard list view can do is limited to sorting and displaying by a single date.

## None of the graph types draws a period as a horizontal bar either (as of October 2026)

It's also worth checking whether the Graph feature can make up for what list views can't do. According to the official help, the available graph types are: bar graph, column graph, line graph, spline graph, area graph, spline area graph, pie graph, and table (plain table and cross table). A bar graph is used to compare the size of aggregated values by category, and the help does not describe using it to draw a bar for the period between a start date and an end date (as of October 2026). You can use a bar graph to compare record counts by process, but that is a graph for comparing the size of numeric values, not a graph that draws a period along a time axis (as of October 2026). None of the graph types is built to show scheduled and actual dates per job number as horizontal bars.

## Steps for checking how close List views and Graphs get to a process chart in your own app

The fastest way to see how far you can get with standard features is to try it in your own app. In the list settings, set a start date or end date field as the sort order and check whether job numbers line up in date order. Next, add a calendar-style list, set the display date to the start date or end date, and check how the day-by-day schedule looks. Finally, add a graph, choose a bar graph, and aggregate record counts by process. Changing the sort order, viewing things day by day, and comparing counts all confirm the same thing: none of these produces a single bar that lines up schedule and actuals together (as of October 2026).

## No standard setting turns a start date and an end date into a single bar (as of October 2026)

Finally, it's worth checking whether there is any way to turn two dates—a start date and an end date—into a single bar. The official kintone troubleshooting help includes an FAQ titled something like "Can records be displayed as a Gantt chart for things like workload management?", but the documentation for standard features does not mention Gantt chart display (as of October 2026). You can store a start date and an end date as separate Date fields, but what's missing is a way to turn those two fields into one horizontal bar. A horizontal-bar process chart organized by job number is not something standard List views or Graphs provide (as of October 2026).

