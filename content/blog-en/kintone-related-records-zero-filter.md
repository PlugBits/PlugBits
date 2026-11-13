---
slug: kintone-related-records-zero-filter
lang: en
title: "Why kintone can't filter a list for records with zero related records"
description: "kintone's official help says you can't filter a list to show records with zero entries in a Related Records field, and there's no calculated-field workaround (as of October 2026)."
date: 2026-11-12
theme: A
keyword: "kintone filter records with no related records"
product: none
approved: true
reviewed: true
translated_from_sha1: cb36e96b4d2bd37d6bbdaf4c879250d37f055cb2
translated_at: 2026-11-12T17:32:41-05:00
---

In a kintone list, you can't filter to show only the records that have zero entries in a Related Records field. The official kintone help states that you cannot filter for records that have no records in a Related Records field (as of October 2026). What the filter *can* do is show records that have one or more related rows matching your condition — there's no way to set a condition for the zero-match side directly.

## You can't filter a list for records with zero related records

When you set a filter condition using a field inside a Related Records field, the behavior matches the official help: records are shown in the filter results if the related records contain at least one row that satisfies the condition. This is the same mechanism used when filtering by a condition inside a table (subtable). Say you have a Quotes app and want to find quotes that have zero linked records in an Orders app — the filter condition itself can only express "one or more matches," so there's no way to directly specify the zero-match side.

## "One or more matches" filtering works, but a calculated field can't stand in for a zero count either

At first glance, it looks like you could work around this by using a Calculated field to count the related records and then filtering on whether that count equals zero. But the official help also states that Related Records fields are not supported for use in aggregation, calculated fields, or app-wide search. Because an automatic calculation can't reference a Related Records field to count its rows in the first place, there's no standard way to build a calculated field that flags a zero-count record either. Switching the condition around — for example, filtering the Orders app for records where the quote number field is blank — doesn't help: that surfaces orders with no linked quote, which is a different question from the one you're trying to answer (quotes with no linked order). If you need to distinguish this within kintone's standard features, the usual approach is to add a choice field such as "Order placed" to the Quotes app and switch it manually whenever an order is created, then filter on that field's value instead.

## Confirm the filter's behavior with one test record that has no related records

To see this for yourself, create one test record that has zero related records, then set a filter condition using a field inside the Related Records field. Watching that test record stay out of the filter results confirms, as a basic fact about the app's design, that the condition can only express "one or more matches" — not "exactly zero matches" — so you can plan your app's layout and workflow around that limit from the start.

