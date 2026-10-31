---
slug: kintone-inventory-app
lang: en
title: "How to Build an Inventory Management App in kintone: The Basic Structure for Parts and Materials"
description: "The basic kintone structure for tracking parts and materials: an Item Master app plus a Stock Movement Log app, linked with Lookup and Related records, with totals by item."
date: 2026-10-28
theme: B
keyword: "kintone inventory management app"
product: none
approved: true
reviewed: true
translated_from_sha1: 135e69254137167f310747272b2544b20403fe16
translated_at: 2026-10-30T18:32:22-04:00
---

To manage inventory for parts or materials in kintone, the basic structure built with standard features is to split the work into two apps—an "Item Master" app and a "Stock Movement Log" app—and connect them with a Lookup field and a Related records list. Totaling incoming and outgoing quantities by item with totals or a graph is also possible with standard features. However, a setting that automatically keeps a "current stock quantity" on the Item Master side by adding and subtracting movements is not documented in kintone's official help as of October 2026.

## Split Item Master and Stock Movement Log into Two Apps

To manage inventory for parts or materials, start by building an "Item Master" app and a "Stock Movement Log" app as separate apps. The Item Master app holds one record per item, with fields such as item number and item name. The Stock Movement Log app holds one record per movement, recording the date, item, quantity, and whether it was an incoming or outgoing movement. If both are packed into a single app, the item records get buried under a growing pile of movement records as activity increases.

This two-app structure is also used in Cybozu's official sample app set, the "Product Inventory Management Pack," which consists of a Product Master app and a Product Inventory Management app. If the number of items is small, a single app can work, but once movement volume grows, splitting the apps is the safer choice.

## Connect Items and Movements with Lookup and Related Records

The two apps are connected using a Lookup field and a Related records list. Adding a Lookup field to the Stock Movement Log app lets users pull in the item number or item name from the Item Master app just by selecting it, which prevents mismatched manual entries. Adding a Related records list to the Item Master app lets users view all the stock movement records for that item in one list.

The filter condition for the Related records list is set by specifying a field in the current app and a field in the referenced app. If the field used as the Lookup key is also used as the filter condition, opening an item record shows its movement history automatically. For display purposes alone, these two standard features are enough.

## Totals and Graphs Can Sum Movement Quantities by Item

The Stock Movement Log app can also use totals and graph features on the quantity field. The graph feature lets you set conditions to total numeric values or count records, so incoming and outgoing quantities can be summed and checked per item.

However, this totaled result only appears as a graph or a totals table. The graph feature's documentation does not describe a way to automatically write that total into a single field on the Item Master side (as of October 2026). Viewing a total on screen and holding a value as an item's field value are two different things that need to be handled separately.

## kintone's Official Help Does Not Document Automatic Stock Calculation on the Item Side

A setting that automatically reflects a "current stock quantity"—calculated by adding and subtracting movements—into a field on the Item Master app is not documented in kintone's official help as of October 2026, based on what has been checked. The documentation on which fields a Calculated field can reference explicitly states that a Related records list cannot be referenced. Even though movement records can be listed on the item side, their quantities cannot be summed directly with a Calculated field.

To check this in a specific app, add a Calculated field to the Item Master app and look at the settings screen to see whether a Related records list appears in the list of fields it can reference. If it does not appear, the options are to rely on totals or graphs for viewing the number, or to add a separate mechanism to handle the calculation.

