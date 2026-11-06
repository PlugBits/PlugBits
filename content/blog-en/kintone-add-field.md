---
slug: kintone-add-field
lang: en
title: "How to Add a Field to a kintone App (and Why Saving the Form Isn't Enough)"
description: "Adding a field in kintone means dragging it onto the form and saving — but that alone won't show it to users. You also need to click Update app (as of October 2026)."
date: 2026-11-04
theme: A
keyword: "kintone add field to app"
product: none
approved: true
reviewed: true
translated_from_sha1: f2054dfe9fee74633302994eb059c053462d3b00
translated_at: 2026-11-05T17:31:21-05:00
---

To add a field to a kintone app, open the app's form settings, pick the field type you want from the list on the left, and drag it onto the form on the right. Placing the field isn't the final step, though: you need to both save the form and click **Update app** before the change actually reaches the live app (as of October 2026).

## Drag and drop the field from the list on the left

kintone's official help describes the basic steps this way: open the form settings screen, choose the field you want to place from the field list on the left side of the screen, and drag and drop it into the area on the right. kintone offers many field types — Text, Number, Date, Attachment, and more — and the help documentation notes that admins "can choose from a variety of fields" when building a form. You can drop a new field between existing fields or in any open space, and you can always move it afterward. If you're not sure which field type fits your use case, it helps to compare the detail pages for a few similar field types before committing, since reworking a field after records exist can be more work than getting the type right the first time.

## Saving the form alone doesn't update the live app

Once the field is placed, the official help instructs you to click **Save form** when you're done configuring the form. This is where many admins get tripped up: according to kintone's official help, clicking Save form by itself does not apply the form's changes to the live app. Saving only locks in your changes inside the settings screen — it doesn't push anything to the screens your team is actually using. If you save the form and then step away assuming the job is done, the field you just added will stay invisible on the app your users have open.

## Click Update App to push the change out to users

To make the new field show up for everyone using the app, you need one more step after saving the form: clicking **Update app**. Until you do that, it doesn't matter how many fields you add or rearrange in the form settings screen — the screens your team actually opens won't change. The upside is that this gives you room to experiment: you can add, remove, and reposition fields freely in the settings screen, then click Update app once at the end, after you're happy with the layout. There's no need to rush and publish every single change the moment you make it; it's perfectly fine to finalize the whole form first and then update the app all at once.

## Open the record screen to check whether you've saved or updated

After adding a field, close the form settings screen and open the record details screen to add a new record. If the new field shows up there, Update app has already run and the change is live. If it's missing, the form has only been saved, not updated. This matters especially when more than one person manages the same app: it's easy for someone to save a form and forget the follow-up Update app step. Rather than guessing, the most reliable way to confirm where things stand is to open the actual record screen and look.
