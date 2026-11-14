---
slug: kintone-related-records-in-list
lang: en
title: "Why the Related Records field won't show on kintone's record list screen"
description: "kintone's Related Records field works only on the record details screen. Official help confirms it cannot appear in the record list view (as of October 2026)."
date: 2026-11-13
theme: A
keyword: "kintone related records field list view"
product: none
approved: true
reviewed: true
translated_from_sha1: e870d00e55e32192aa12d47cdd1f3b878ab5de8e
translated_at: 2026-11-13T17:31:42-05:00
---

kintone's Related Records field displays records from another app (or the same app) that match a set of conditions, directly on the record details screen. kintone's official help states that the Related Records field cannot be displayed in the record list view (as of October 2026). If you want to see the count or contents of related orders or tasks at a glance as soon as you open the list, this isn't possible with standard functionality alone (as of October 2026).

## The Related Records field only works on the record details screen

When you set up a Related Records field, it pulls in records from a linked app that match conditions you specify, and shows them as a list. You can also choose which fields to display, picking only the ones you need from the linked app. However, this list only appears on the record details screen. The official help article on setting up this field clearly states that the Related Records field cannot be shown in the record list view. Scanning through records in the list view while also checking related information at the same time falls outside what standard functionality supports (as of October 2026).

## Consider carrying the information you need into the list another way

If you really need to see related information from the list view, you'll need an approach other than displaying the Related Records field directly in the list. For example, you could copy part of the related information into your own app using a Lookup field, since a Lookup field's value can be added as a column in the list view. Keep in mind that Lookup copies a value from a single record, so it isn't suited to summarizing multiple related records at once. When you need to check cases where there are multiple related records, it's generally easier to build your workflow around opening the record details screen rather than trying to force the list view to show that information.

## After setting up a Related Records field, check the list view's column options too

Once you've added a new Related Records field, open the record list view settings and confirm that the field doesn't appear among the columns you can add. Checking this ahead of time saves you from later wondering why a field you expect to be available isn't showing up as a column option. It also helps to check where the Related Records list appears on the record details screen and how far users need to scroll when there are many related records, so you can plan the layout around real usage.
