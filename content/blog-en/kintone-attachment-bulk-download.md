---
slug: kintone-attachment-bulk-download
lang: en
title: "Why kintone won't let you bulk-download attachments (and what the API allows)"
description: "kintone's standard screens only let you download attached files one at a time. Here's what official kintone help says about the API-based workaround, as of October 2026."
date: 2026-11-06
theme: A
keyword: "kintone bulk download attachments"
product: none
approved: true
reviewed: true
translated_from_sha1: 1681ee75150ee68a7c6bafb968f64eb0a39c9e14
translated_at: 2026-11-07T17:31:39-05:00
---

With kintone's standard operations, there is no way to download multiple attached files at once (as of October 2026). Official kintone help states plainly that you cannot bulk-download multiple files attached to an app, and that files need to be downloaded one at a time. If you want to collect files in bulk, the only remaining option is to use the API.

## Standard operations only let you download attachments one file at a time

Even when a record has many photos or documents attached, the standard screen only gives you the option to save files one by one. There is no built-in way to download a whole folder as a ZIP, or to select multiple files and save them together; the official kintone help page on this topic does not describe either option (as of October 2026).

When the file count is small, this isn't much of a burden. But once a single record has ten or more images attached, or you need to gather files from dozens of records, those one-at-a-time clicks start to add up.

## Official kintone help points to the API as the way to download files in bulk

The same help page adds, for reference, that bulk-downloading attached files is possible by using the API. In other words, a bulk option does exist, but it requires building something that calls the API; it can't be done through screen operations alone.

If you have an in-house developer, or access to an outside developer, you can use this approach to build a tool that downloads files in bulk. If that's not an option, you'll need to plan your workflow around saving files one at a time.

## Count how many records and files you actually need before deciding

Before deciding whether to build an API-based solution, first put a number on the scope of what you need to collect.

Write down the number of target records and the number of attachments per record, then calculate the total number of files you'd be saving one at a time. Also consider whether this is a one-time job or something that will keep happening going forward.

If it's a one-time task, doing it manually is often enough. If it's something that will recur, that's a good signal to start evaluating an API-based approach.
