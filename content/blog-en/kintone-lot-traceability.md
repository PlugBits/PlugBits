---
slug: kintone-lot-traceability
lang: en
title: "How to Trace Lot Numbers from Raw Materials to Shipments in kintone"
description: "Build lot traceability in kintone using standard features: link three apps with Lookup fields, then use Related Records to trace backward. Covers the table-field limit on Related Records."
date: 2026-11-10
theme: B
keyword: "kintone lot traceability"
product: none
approved: true
reviewed: true
translated_from_sha1: 33851df273e25a785f01dfd8979ac9c53cf92232
translated_at: 2026-11-10T17:32:13-05:00
---

To build lot traceability with kintone's standard features, create three apps — a raw material lot master, a production record app, and a shipping record app — and connect them in order with Lookup fields that pull in the lot number from the previous step. To trace in the opposite direction, use the Related Records list. However, Related Records conditions cannot reference a field inside a table (subtable), so when a single production lot uses more than one raw material lot, you'll need a separate app to record each material input in order to trace it back (as of October 2026).

## Connect raw material lots to shipments with Lookup fields across three apps

Split the process into a raw material lot master app, a production record app, and a shipping record app, and build the design by having each app look up the lot number from the previous step with a Lookup field. A Lookup field copies a value from a record in another app, and the value it retrieves automatically includes a link to that source record. Put a Lookup field for the raw material lot in the production record app, and a Lookup field for the production lot in the shipping record app, and you get the same linked structure all the way back to the first step.

## When one production lot uses multiple raw material lots, use a separate app for input records

If a production lot only ever uses a single raw material lot, one Lookup field is enough. On a shop floor where multiple raw material lots are blended into one production lot, a single Lookup field can only record one of them. You can also place a Lookup field inside a table to add rows, but in that case the fields you can copy into are limited to fields within the same table (as of October 2026). The problem is that this layout makes it impossible to set up the backward trace described in the next section (as of October 2026). To build both the forward link and the backward trace with standard features, create a separate input record app where each record represents one combination of a production lot and a raw material lot, and have that app look up both lot numbers.

## Know the Related Records limitation before you design the backward trace

You can go from a production record back to its raw material lot with one click using the Lookup field's link, but the reverse direction — seeing "which production records used this lot" — doesn't appear from a link alone (as of October 2026). For this direction, you need Related Records, which lists records that share a matching value. However, kintone's official help states that for the Related Records list's "Conditions for displaying records," "Fields set in [Table] cannot be specified." (as of October 2026). If the raw material lot's Lookup field sits inside a table, you won't be able to trace from the raw material lot master to production records through a Related Records list (as of October 2026). By keeping a separate input record app instead, the raw material lot master's Related Records list will show every input record tied to that lot.

## Check that your apps are actually connected correctly by lot number

You can confirm the app connections match your design by following a single lot all the way through. Open one shipping record, and follow the Lookup field's link to the production record, then on to the raw material lot master. For the reverse direction, open a raw material lot master record and check whether the Related Records list shows the input records for that lot. It's also worth checking that the number of input records matches the number of raw material lots actually used in production.

