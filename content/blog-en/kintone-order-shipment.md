---
slug: kintone-order-shipment
lang: en
title: "How to Manage Orders and Shipments in kintone (Basic Setup with Standard Fields)"
description: "Track order quantity and shipped quantity in one record and let a Calculated field work out the remaining balance. Covers splitting shipments across multiple records with Related records."
date: 2026-11-06
theme: B
keyword: "kintone order and shipment management"
product: none
approved: true
reviewed: true
translated_from_sha1: 2061712e96e6aafdbe05c96328ef3d2a595c013f
translated_at: 2026-11-08T17:30:21-05:00
---

To manage orders and shipments in kintone, the basic setup is to add order quantity and shipped quantity fields to the order record, then use a Calculated field to automatically work out the remaining quantity (the outstanding balance). This is enough when a single shipment covers the full order quantity. If you need to record shipments in multiple batches, you'll need a separate app combined with a Related records list.

## Keep order quantity and shipped quantity on one record, and let a Calculated field work out the remaining balance

kintone's official help explains that a Calculated field's formula can use "half-width operators such as '+', '-', '*', and '/'." If the order quantity field code is `order_quantity` and the shipped quantity field code is `shipped_quantity`, entering `order_quantity-shipped_quantity` in the Calculated field automatically works out the remaining quantity (the outstanding balance).

Every time you update the shipped quantity after a shipment, the remaining quantity recalculates on its own. As long as one order is fulfilled in a single shipment, two number fields and one Calculated field are all you need to manage it.

## To record shipments in multiple batches, link a separate app with a Related records list

If you want to record multiple shipments against a single order, create a separate app for shipments and link it to the order app with a Related records field. kintone's official help describes Related records as a feature that "can display records not only from the app where the field is placed, but also from another app," and explains that the condition for which records to display is set by "specifying a field in this app on the left and a field in the referenced app on the right."

If both apps share the same order number, linking on that field lets you see every shipment recorded against an order, as a list, right from the order record details screen.

## Add test shipment records one by one under the same order number and check how the list behaves

Start by creating one test record in each of the order app and the shipment app, entering the same order number in both, and checking that the shipment record shows up in the Related records list.

Next, add a second and third shipment record under the same order number, and confirm that all of them appear together in the Related records list. Since the shipped quantity on the order record is a value you enter yourself, it's worth checking at this stage that it matches the total of the quantities across the shipment records.

If the order number is typed incorrectly, the records won't link up, so it's worth double-checking for inconsistent formatting of the order number while you're testing.

