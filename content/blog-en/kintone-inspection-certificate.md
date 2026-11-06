---
slug: kintone-inspection-certificate
lang: en
title: "How to Create Inspection Certificates in kintone: A Standard Design Using a Product Specification Master"
description: "Link kintone inspection records to a product specification master via Lookup to auto-fill upper/lower limits and pass/fail results. Combining them into one printed report is outside kintone's standard features (as of October 2026)."
date: 2026-11-04
theme: B
keyword: "kintone inspection certificate"
product: excel-report
approved: true
reviewed: true
translated_from_sha1: d27c12e91226c018815b8e576f8416a35e9117cc
translated_at: 2026-11-05T17:33:34-05:00
---

To build inspection certificates in kintone, the basic design is to store each part number's standard values and tolerances in a separate app called a "Product Specification Master," then connect it to your inspection records app with a Lookup field. Once that's set up, entering a measurement is enough to automatically display the upper limit, lower limit, and pass/fail judgment. What kintone does not handle on its own is laying out a batch of records into a single formatted certificate for printing (as of October 2026).

## Link to a Product Specification Master to Auto-Fill Standard Values and Tolerances

The sample inspection app published by Cybozu is built from two apps: an "Inspection Record Management" app and a "Product Specification Master" app. According to the app's description, linking to the product master lets you enter product names and standard dimensions easily and accurately, so you don't have to retype the standard values and tolerances for each part number every time you run an inspection. By selecting a part number through a Lookup field, the matching product name and standard values are pulled in automatically. The more part numbers a shop floor handles, the bigger the payoff from keeping this master data separate.

## Automatically Display Upper/Lower Limits and Pass/Fail Results

Once standard values and tolerances live in the master app, the calculations that follow can also run automatically. The app description explains that the upper and lower limits are entered automatically based on the standard value and tolerance, and that entering a measurement is all it takes for the pass/fail result to be displayed automatically, calculated from the dimensional standards and tolerances registered in the product specification master. Creating individual inspection records is covered in a separate article, but for the certificate design discussed here, the key point is that even the pass/fail judgment can be derived automatically from values stored in the master. The same app description also covers charting measurements by location, inspection date, and lot.

## Combining Everything into One Printed Report Is Outside kintone's Standard Features

Everything above is about how individual records get created; turning them into a single document you hand to a customer is a separate question. kintone's official help describes file export as a CSV workflow: narrow down the records to export, then export them to a file, and it doesn't support laying out a template with borders and fixed field positions. For printing, the official guidance only goes as far as noting that besides using your web browser's print function, you can also export record data to a CSV file and use Excel's print function. There's no built-in kintone feature for assembling a finished, fixed-format inspection certificate on its own (as of October 2026).

## Check Whether Your Inspection Records Can Pull Standard Values From the Master

Open the Lookup field settings on your inspection app and check which fields from the product specification master are available under "Copy other fields." If standard values and tolerances already appear as options, you have what you need for the pass/fail result to display automatically. If a value you need isn't listed, that item will still require manual entry, so it's worth identifying those gaps ahead of time rather than discovering them during an inspection.

When you need to output a large batch of records in a fixed layout, a template-based output tool such as Excel Report Batch Generator is one way to get there.

