---
slug: kintone-list-total-row
lang: en
title: "How to Show a Total (Sum) on a kintone List View"
description: "kintone's list view settings don't include a built-in column total option (as of October 2026). Here's how to use the Graph feature instead to show sums and counts."
date: 2026-11-09
theme: A
keyword: "kintone show total in list view"
product: none
approved: true
reviewed: true
translated_from_sha1: a4f162de3ebd5d9e8c792a43875f1c5794efbb10
translated_at: 2026-11-09T17:32:00-05:00
---

Looking at kintone's list view (the record list screen), the official help for list settings doesn't include an option to show a total below a column (as of October 2026). The settings available are the list name, display format, the fields shown and their order, filter conditions, and sort order. Even if you line up a number field or a Calculated field as a column, there's no setting that automatically adds up the values in that column (as of October 2026). That doesn't mean totals are impossible in kintone, though. A separate feature, Graphs, lets you show a sum or a record count on the same app's top page.

## No option for a column total in the list view settings

The settings listed in kintone's official help for adding a list cover the list name, display format (table, calendar, or customization), the fields displayed and their order, filter conditions, and sort order. An option to show a total for each column isn't included anywhere in this list (as of October 2026). It's common to want a line that reads something like "Total: $X" automatically appearing below a list of quotes or order amounts, but adding more columns only lines up more numbers side by side — getting an actual total means turning to a different feature. This is the first thing to understand before trying to solve the problem inside the list settings themselves.

## The Graph feature can show totals and counts on the same top page

The standard way to see a total in kintone is the Graph feature. According to kintone's official help, Graphs let you aggregate the records added to an app — by record content or record count, for example — and display the results as a graph or a table. There are two ways to create one. Building a graph from the app's settings screen requires app management permissions. Building one from the record list screen, by aggregating a number field or the record count directly, doesn't require app management permissions. A saved graph isn't tucked away on a separate screen — it shows up on the app's top page, the same place as the record list view, and always displays the latest data. That said, kintone's official help notes that saving graph settings requires app management permissions, so a graph built from the list view by someone without those permissions can only be viewed on the spot; it won't be saved. The list rows themselves still won't show a total, but a graph on that same top page can give you the sum or the count you're after.

## Decide what you want to total before building the graph in your app

Before creating a graph, it helps to decide whether you want a total across all records or a total broken down by status, by assignee, or by some other grouping. Since kintone's official help describes Graphs as a feature for aggregating record content or record counts, knowing exactly which number you want to total, and by what grouping, means less back-and-forth once you're in the graph creation screen. Saving the graph for everyone to see later requires someone with app management permissions, so it's worth writing down the aggregation you want on paper or in a message first and handing that off — that way the request only needs to go back and forth once.
