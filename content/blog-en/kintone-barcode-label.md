---
slug: kintone-barcode-label
lang: en
title: "kintone has no barcode field — how to print barcodes on work reports and tags anyway"
description: "kintone's standard fields don't include a barcode or QR code type (as of October 2026). Here's what you can do with standard fields, and where you need another tool."
date: 2026-11-12
theme: B
keyword: "kintone barcode field for labels"
product: excel-report
approved: true
reviewed: true
translated_from_sha1: 5084747586cb5f8441d5efeb2460023cb4c7e350
translated_at: 2026-11-12T17:31:28-05:00
---

kintone's standard fields don't include a dedicated barcode or QR code type (as of October 2026). You can store a part number or control number in a Text field or Number field, but turning that value into a printed barcode image on a product tag or work report is outside what the standard fields do.

## kintone has no standard barcode or QR code field

The official kintone help page listing field types covers text, calculated fields, choice fields, date/time, link, attachment, table (subtable), Lookup, Related records, decoration fields such as label and space, and record information fields such as record number — but no barcode or QR code field is listed there. In other words, you can create a place to type a part number or control number using a Text field or Number field, but there's no built-in feature to render that value as a barcode image (as of October 2026).

## You can store part numbers in a field, but printing them as a barcode label is outside standard kintone

Storing a part number or control number on a record is well within what standard kintone does. But printing a batch of labels — one per unit of quantity, each with its own barcode or QR code, the way a product tag works on a shop floor — isn't something kintone does on its own. Excel Report Batch Generator has a label mode built for this: it can generate one label per unit of quantity for the records you select, with QR codes and barcodes included. If the goal is a product tag or work report that gets printed and then scanned on the floor, this is the kind of tool that fills the gap.

## Before using it as a product tag, check that the same part number isn't printed twice

Before relying on a label-printing setup, check the part number or control number field for duplicate entries. If the same part number appears on more than one record, a scan won't tell you which record it actually points to. Create a handful of test records, run a trial print of the labels, and confirm that each part number lines up with the correct barcode before putting the labels into use on the floor.

