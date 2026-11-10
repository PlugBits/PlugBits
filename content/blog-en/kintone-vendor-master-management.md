---
slug: kintone-vendor-master-management
lang: en
title: "How to Centralize Vendor (Supplier) Data in kintone with Lookup Fields"
description: "Centralize vendor data in kintone with one master app and a Lookup field. Learn why copied Lookup values don't auto-update, and how to fix outdated ones."
date: 2026-11-09
theme: B
keyword: "kintone lookup field not updating"
product: none
approved: true
reviewed: true
translated_from_sha1: 4685d072d844d1bb66fa657b28acbc54a0e04a55
translated_at: 2026-11-09T17:32:52-05:00
---

When vendor details are typed separately into purchase order apps, invoice management apps, and other apps, every change to a payment term or contact person means editing multiple records by hand. With standard kintone features alone, the basic way to centralize this information is to build a single vendor master app and reference it from your purchase order app with a Lookup field. This prevents inconsistent spelling of vendor names and contact details, but there's a catch: values copied by a Lookup field do not update automatically when you edit the master record later.

## Build One Vendor Master App and Reference It with a Lookup Field

Create a dedicated app that holds vendor names, contact information, payment terms, and other details, then add a Lookup field to your purchase order app (or any other app that needs vendor information) so it references that master app. This follows the same approach as the ordering example in kintone's official help for Lookup fields: when the person entering an order selects a vendor from the master app, related information such as the name and payment terms is copied in all at once. Instead of typing the same vendor name into multiple apps by hand, consolidating vendor data into one master app prevents inconsistent spelling and typos at data entry.

## Lookup Field Values Don't Update Automatically When You Edit the Master Record

One important thing to keep in mind: values copied by a Lookup field reflect only the moment they were retrieved. If you later change the information in the master app, kintone does not update records that already copied the old values. kintone's official help states that even if the value in the app referenced by the Lookup field changes, the value already retrieved through the Lookup field is kept as is. If a vendor's phone number or contact person changes, correcting the master record alone will not update how that vendor's details appear on past purchase order records. To bulk-update values that were already copied, kintone's help describes importing a CSV file to update Lookup field values in bulk.

## Decide Which Fields Should Live Only in the Master App Before You Build It

Before setting up the master app and Lookup field structure, decide which pieces of vendor information you want to handle with an "edit the master record only" workflow. Settling this up front keeps the design consistent later on. Fields that rarely change, such as payment terms, are often fine to leave as copied Lookup values. Fields you want to stay current, such as contact details, are better planned around a regular bulk-update routine from the start, so you don't end up discovering outdated values later.
