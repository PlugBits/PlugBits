---
slug: kintone-quality-management
lang: en
title: "How to Track Quality Management (Defect Reports and Corrective Actions) in kintone"
description: "Link defect reports to serial and part numbers with Lookup and Related records, and track the flow from defect to corrective action with process management statuses and branching. kintone has no built-in root-cause analysis feature (as of October 2026)."
date: 2026-10-31
theme: B
keyword: "kintone quality management app"
product: none
approved: true
reviewed: true
translated_from_sha1: e402ceea210d98d91c80e97461dc64665124e2ff
translated_at: 2026-11-02T17:32:27-05:00
---

To run quality management in kintone, build a dedicated app for defect reports and connect it to serial numbers and part numbers with Lookup and a Related records list. You can follow the flow from when a defect occurs to when the corrective action is completed using process management statuses and branching. Defect counts can be totaled with a graph, but automatic analysis by cause is not documented in the official kintone help (as of October 2026).

## Build a dedicated app for defect reports and connect serial and part numbers with a Related records list

The basic setup is to create one dedicated app for defect reports. Pulling serial numbers and part numbers from a master app with a Lookup field prevents mismatched spelling, and selecting the source record automatically copies over its information. Photos can be kept as multiple files in an Attachment field. Placing a Related records list on the serial number master app lets you view only the defect reports tied to that serial number. A Related records list works by showing records in the referenced app whose linked field value matches.

Cybozu's introduction page for manufacturing lists "claim management" and "inspection report" under quality management and quality assurance, and "defect report" under production engineering, but it could not be confirmed whether app templates with those exact names are distributed (as of October 2026). Assume you will combine standard fields yourself.

## Track the flow from occurrence to corrective action with process management statuses and branching

The flow from when a defect occurs to when the corrective action is finished can be placed on process management statuses. Once set up, the app gains "which status, which assignee, and which action," and you can rename statuses to things like "Occurred," "Cause investigation," "Corrective action review," and "Completed."

Splitting the flow based on a judgment is also possible with standard features. The design page includes an example of "when the next status and next assignee branch depending on a condition," so you can move only defects that need corrective action from "Cause investigation" to "Corrective action review," while sending the rest directly to "Completed." That said, fields specific to quality management, such as a field for the corrective action details or recurrence prevention measures, are not documented in the official help (as of October 2026), so you need to add those fields yourself.

## Check how far the branching conditions can go on the process management settings screen

Set up one field for a pass/fail or similar judgment, then configure two actions on the "Cause investigation" status so the destination status changes depending on the judgment result. Using a test record, click both buttons and confirm that each one moves the record to the intended next status. If a record does not move as expected, review the field and value specified in the action's execution condition.

## Defect counts can be totaled with a graph, but you choose the angle for cause analysis yourself

Defect counts can be totaled with a graph. Set the defect content field as the item to classify by, and set the aggregation method to "Number of Records," and you get the counts. A pie chart is suited to showing proportions, and setting the occurrence date as the item to classify by lets you see the monthly trend in a line graph.

However, automatic classification by cause, or a feature that automatically narrows down the items with the highest counts, is not described in the graph documentation (as of October 2026). The value of the field used for classification has to be chosen by the person entering the record every time, and adding more angles for analysis depends on how you design the app.
