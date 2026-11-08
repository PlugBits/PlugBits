---
slug: kintone-markup-price
lang: en
title: "How to Manage Customer-Specific Pricing (Markup) in kintone"
description: "Set up a master app with base unit prices, pull them into the order app with a Lookup field, then multiply by a customer markup rate in a Calculated field."
date: 2026-11-06
theme: B
keyword: "kintone customer specific pricing markup"
product: none
approved: true
reviewed: true
translated_from_sha1: 5c1f0d75887cce4eba9f379db8031de75d991ce9
translated_at: 2026-11-07T17:32:36-05:00
---

The basic approach for managing customer-specific pricing (markup) in kintone is to build a master app that holds the base unit price for each item number, then use a Lookup field in the order app to pull in that base price, and multiply it by a customer-specific markup rate with a Calculated field to produce the final price. One thing to watch for: a value brought in through a Lookup field does not update automatically when the source record in the master app changes.

## Pull the base unit price from a master app with a Lookup field

The kintone help documentation explains that setting up a Lookup field requires both a master app that holds the source data and the app that retrieves data from it. Create a master app with item number and base unit price fields, then add a Lookup field for the item number in the order app. Once an item number is selected, the base unit price is copied over automatically.

Keep the customer markup rate in the order app (or in a customer master app) rather than in the item master. Markup rates tend to vary more as the number of customers grows, so it works well to keep separate item and customer master apps and have the order app pull from both with Lookup fields. This makes it easier to add new customers later without restructuring the whole setup.

## Calculate the price automatically with base price times markup rate

For the calculation itself, kintone's help documentation describes writing Calculated fields using half-width operators such as `+`, `-`, `*` and `/`. If the base unit price field code is `base_price` and the markup rate field code is `markup_rate`, the formula `base_price*markup_rate` will automatically produce the customer price.

Because the Lookup field re-fetches the base price and the Calculated field re-runs the formula whenever the item number or customer changes, there's no need to calculate prices by hand each time.

## Check what happens to the price after updating the master record

As a test, try updating one base unit price in the master app. The kintone help documentation notes that the value does not update to the latest figure automatically; clicking the Lookup field's fetch button again overwrites it with the current value. This means that an existing order record will not show the updated base price right away just because the master record changed.

Open that order record, click the Lookup field's fetch button again, and confirm that both the base price and the calculated customer price update to the new figures. Walking through this once ahead of time helps prevent a common mistake during a price revision: an order record quietly showing a markup price calculated from an outdated base price.
