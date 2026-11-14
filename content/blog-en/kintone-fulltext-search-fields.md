---
slug: kintone-fulltext-search-fields
lang: en
title: "Which Fields Does the kintone Search Box Actually Search?"
description: "kintone's search box covers text fields, comments, and attachment contents, but not number or date fields per official help (as of October 2026)."
date: 2026-11-13
theme: A
keyword: "kintone search box which fields are searched"
product: none
approved: true
reviewed: true
translated_from_sha1: e2a3d4d5c7a1579c9181f4e9b789a74f2696dd03
translated_at: 2026-11-13T17:31:28-05:00
---

The search box in the top right corner of kintone (the kintone search feature) covers Text (1 line), Text (multi-line), Rich Text, and Link fields, as well as record comments and the names and contents of attachment files. The official kintone help does not state that Number or Date fields are included in search results (as of October 2026). If you assume that typing a keyword into the search box will surface every matching record, you may find that fewer rows show up than you expected.

## What the Search Box Actually Covers Is Mostly Text

The fields that kintone search covers are Text (1 line), Text (multi-line), Rich Text, and Link. A Lookup field is only included when the source field it copies from is a Text (1 line) or Link field. Record comments are also searched. For attachments, it's not just the file name that's searched — the contents of the file are searched too. However, content search only works for certain file formats, such as Office documents and PDFs, and some files (for example, heavily encrypted PDFs) are excluded. That's a fairly wide range of coverage, but Number, Date, and Date and time fields are not listed among the searchable field types in the official help (as of October 2026). If your workflow relies on typing a model number into the search box to find it, keep in mind that there's no guarantee it will actually turn up.

## Use List View Filters Instead of Search to Narrow Results

If you need to narrow results by a Number or Date field, it's more reliable to use the filter feature on the record list screen than to worry about whether that field is covered by full-text search. Filtering lets you pick a field and build a condition against it directly, so it works the same way whether the field is text or numeric. The standard filter is enough whenever you already know which field you want to narrow down by. On the other hand, when you want to search across multiple fields for a keyword — for example, something found inside an attachment — that's a job for the search box, not the filter. Deciding up front whether you need the search box or the filter saves time chasing down why a record isn't showing up in your results.

## Compare Search Results Against Filter Results for Fields You're Unsure About

When the official help doesn't make it clear whether a specific field is covered by search, you can check it yourself: pick a value stored in that field, search for it in the search box, then filter the record list for the same value and compare the two results. If the filter returns records that the search box doesn't, that field is something you need to look up with a filter, not the search box. If you're expecting Number or Date fields to work through the search box, it's worth building the same condition as a filter first and confirming whether you get the results you're actually looking for.

