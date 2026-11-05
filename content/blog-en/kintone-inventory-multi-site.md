---
slug: kintone-inventory-multi-site
lang: en
title: "How to manage inventory for multiple business locations in a single kintone app"
description: "Manage inventory for multiple business locations without separate kintone apps: add a location field, view stock by location with a cross-tabulation table, and restrict visibility per location."
date: 2026-11-03
theme: B
keyword: "kintone inventory management multiple locations"
product: none
approved: true
reviewed: true
translated_from_sha1: d5abc3294e4045d5cb1713972d25e4970efa5d80
translated_at: 2026-11-04T17:32:14-05:00
---

Even if your company has multiple business locations, you do not need a separate inventory management app for each one. By adding a single "Location" field to your item master and your inbound/outbound records, you can manage inventory for multiple locations within one app. You can view stock levels by location using a cross-tabulation table, and if you need to restrict what each location can see, an Organization Selection field is one way to do it (as of October 2026).

## You do not need separate apps per location — one "Location" field in the same structure is enough

A typical inventory management setup splits the work into two apps: an item master and an inbound/outbound records app, connected using a Lookup field and a Related records field. A Lookup field lets you retrieve and copy the data you need from another app, and a Related records field displays, as a list, the records in a configured app that match specified conditions. Add a single field for the location name or site code to this structure, and when the number of locations grows, you can keep using the same structure without building new apps (as of October 2026).

## You can see stock by location and item using "Items to Classify" in a cross-tabulation table

If you want a combined view of inventory activity across locations, the Graph feature's cross-tabulation table can do this. kintone's official help states that with the Graph feature, you can create a cross-tabulation table that combines multiple items for aggregation. If you set the "Major Category" under "Items to Classify" to location and the "Medium Category" to item, the major category appears on the horizontal axis (rows) and the medium category on the vertical axis (columns), letting you check quantities by location and by item in a single table. There is a limit on how many items can be set as classification items: you can set up to three — major, medium, and minor categories. In addition to location and item, you can also fit in a category for whether the movement was inbound or outbound, all in one table.

## Checking whether location and item fit together under "Items to Classify" in a cross-tabulation table

Create a new graph in the inbound/outbound records app and choose the cross-tabulation table graph type. Set the major category under "Items to Classify" to location and the medium category to item, and set the aggregation method to sum of quantity. Check whether inventory activity by item appears as a table for each location. If there are too many rows to read easily, another option is to create one graph per location, each filtered down to a single location.

## To restrict what each location can see, use an Organization Selection field for record-level access permissions

If you want to do more than just view stock by location — if you want to actually separate what each location can see — record-level access permissions can help. kintone's official help states that by specifying a User Selection field or Organization Selection field placed on the app's form, you can make the access permission target the specific user or organization selected in each record, rather than a fixed user or organization. Add an Organization Selection field for location to your item master or inbound/outbound records app, and set that field as the target for record-level access permissions, so that only people belonging to the location selected on each record can view or edit it. However, kintone's official help does not document a setting that automatically compares a logged-in user's organization against the field value to filter records (as of October 2026).

