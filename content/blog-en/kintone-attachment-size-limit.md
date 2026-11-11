---
slug: kintone-attachment-size-limit
lang: en
title: "kintone attachment upload failing? Here's where the file size limits are"
description: "kintone attachments have a 1GB per-file limit, and the App Management screen shows each app's total attachment size. Files over 50MB are searched by filename only."
date: 2026-11-10
theme: A
keyword: "kintone attachment file size limit"
product: none
approved: true
reviewed: true
translated_from_sha1: c77bde3d9faed5fce48f2d1f8753c6a8a92b2aff
translated_at: 2026-11-10T17:31:15-05:00
---

kintone's Attachment field has a 1GB limit per file. This is documented in the official kintone limits page, and uploading a file larger than that returns an error. On the other hand, attachment file size is not counted toward the overall record data size limit (as of October 2026). To see how much attachment data has built up in a given app, check the App list on the App Management screen.

## If an attachment won't upload, check the 1GB per-file limit first

kintone's Attachment field has a fixed limit: each file can be up to 1GB. The official kintone limits page states this file size limit directly. Files that app administrators deal with on the floor, such as inspection recording videos, work procedure videos, or scanned PDF drawings, tend to be large, and they can creep up toward 1GB without anyone noticing. If an upload throws an error, the first thing to check is the size of that individual file. If the error happens even with a file under 1GB, look for a cause other than file size. Still, keeping the documented 1GB limit in mind as a baseline makes it much faster to tell whether the problem is a size overage or something else.

## Check the total attachment size an app has accumulated

Even when every single file is under the 1GB limit, the combined size of all attachments stored in an app is worth tracking separately. The official kintone admin tips documentation outlines how to check this. From the Settings icon at the top of the kintone screen, open App Management, go to the App list, and click the Total Attachment File Size column header to sort apps by total size, largest first. Checking this column periodically makes it easy to identify which apps rely heavily on images or video. A large total size by itself isn't a reason to change how an app is used right away, but knowing which apps are the heaviest relative to your contracted disk space narrows down what to investigate if storage ever becomes a concern (as of October 2026).

## Large attachments also drop out of full-text search

Attachment file size doesn't just affect upload errors, it affects search too. The official kintone limits page states that what gets indexed for full-text search depends on attachment file size, and files of 50MB or larger are searched by filename only. For files under 50MB, both the filename and up to the first 1MB of text inside the file are searchable. In a workflow where meeting minutes or specification documents are attached as files and someone later tries to find them by searching for words inside the document, that approach stops working once the file reaches 50MB or more (as of October 2026). Switching to a naming convention that puts model numbers or dates directly in the filename keeps files findable by search regardless of size. This has no effect on record data size itself, since attachment file size is not included in the total record size (as of October 2026). The file size limit and the search size limit are two separate things, and it's worth keeping them straight.

