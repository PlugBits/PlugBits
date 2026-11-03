---
slug: kintone-quotation
lang: en
title: "kintone Quotations: Expiration Dates and Approvals Work Out of the Box, but Quote Numbers and Revisions Don't"
description: "kintone's Calculated field, Process management, and App Action cover expiration dates, approvals, and order handoff for quotations, but quote numbers and revision tracking need extra work."
date: 2026-10-31
theme: B
keyword: "kintone quotation number and revision tracking"
product: excel-report
approved: true
reviewed: true
translated_from_sha1: a3684b879b41bd5f45b08f9dfac3946b21f0350a
translated_at: 2026-11-02T17:33:01-05:00
---

When you build a quotation app in kintone, standard features are enough to calculate an expiration date, run an internal approval, and hand data off to an order app. What's missing is quote numbers and revisions: every time you create a new quote, it gets a new record number, and there's no built-in way to link it back to the previous version of the same quote as of October 2026.

## What trips up admins first when creating quotations

A quotation is a document you often reissue before an order is finally placed. Every time you send a revised quote, you need a way to track the quote number and its relationship to the previous version. On top of that, three more questions usually come up: whether an expired quote might accidentally get reused, whether staff have to re-enter the same data again once an order is confirmed, and whether the approval history shows who signed off and when. If any one of these four points is unclear, every quotation adds a little more checking work.

## Expiration dates, approvals, and order handoff are covered by standard features

You can calculate an expiration date with a Calculated field. kintone's official help shows a date calculation example that adds a fixed number of seconds to a date field — for instance, adding 60×60×24×30 (the number of seconds in 30 days) to an application date field. Applying the same formula to the quote date field gives you an automatic expiration date. Internal approval can be built with Process management: kintone's help describes using an app "to manage request approvals or decision-making, similar to a workflow," and notes that from the record details screen, a reviewer can click a single button to review, approve, or pass the record on to the next person in the flow. Handing data off to an order app is a job for App Action: set the destination app to your order app and map the fields between the source and destination records. Fields inside a table (subtable) are mapped using the "table name > field name" format. These three requirements can all be met with standard app configuration.

## Quote numbers and revisions fall outside what kintone offers

A record number is assigned automatically in the order records are created, and it cannot be changed, as of October 2026. When you create a new record for a reissued quote, it gets a different record number from the original. There is nothing in kintone's official help, as of October 2026, that lets you match your company's own numbering format or add a revision suffix that stays tied to the original quote number. Customizing the number format is explicitly described as requiring JavaScript, as of October 2026. To keep the same quote number across revisions while still tracking which version is which, you need to design around it: use a manually entered Text field for the quote number, and manage the revision separately with its own Number field.

## A checklist for the quote number, revision, and expiration date before you send a quotation

Before creating a reissued quote, open the original quote record, copy its quote number into the new record, and increase the revision Number field by one. Open the expiration date Calculated field and confirm the number of days from the quote date matches what was intended. Once an order is confirmed, click the App Action button and compare the fields copied into the order app against the original quote to make sure nothing was missed. For quotes that require approval, check that the status hasn't been sent out while it's still sitting at "Approval pending."

For teams that need to batch-generate multiple quotations at once, right down to the revision number, following a fixed template, Excel Report Batch Generator is one way to handle that step.

