---
slug: kintone-attachment-duplicate-filename
lang: en
title: "What Happens When You Attach Two Files With the Same Name in kintone"
description: "kintone's official help doesn't say whether attaching two files with the same name overwrites one of them (as of October 2026). Here's how to think it through."
date: 2026-11-13
theme: A
keyword: "kintone attachment field same file name"
product: none
approved: true
reviewed: true
translated_from_sha1: badde52be5cde5576d3497d0b8c63ad224cee267
translated_at: 2026-11-13T17:30:52-05:00
---

kintone's official help does not say whether attaching two files with the same file name to an Attachment field causes one to overwrite the other (as of October 2026). This comes up often with photos taken on a phone, since the device or camera app assigns the file name automatically, so two different photos can easily end up with the same name. When several people add attachments to the same record, name collisions become even more likely. Before jumping to a conclusion, it helps to separate what's actually documented from what isn't.

## Why file names collide more often with phone photos and shared records

One common situation where attachment file names collide is when users attach photos straight from a phone camera without renaming them. Because the file name is generated automatically by the device or app, two unrelated photos can end up with identical names without the person who took them noticing. The more users an app has, the more likely this becomes, especially in workflows where multiple people add photos to the same record over time. The official kintone help page on attachments confirms that a field can hold multiple files, but it does not explain what happens when two files share the same name (as of October 2026). That silence leaves open the worry that a later attachment with the same name might silently overwrite and remove an earlier one, and the help documentation alone can't settle that concern.

## Design your workflow around unique names instead of relying on unknown behavior

Since kintone's help doesn't document how same-name attachments are handled, it's safer not to assume the system will sort it out correctly. In practice, one option is to set up a separate Attachment field for each stage or scene of photo capture, with only one file expected per field; this at least reduces the chance of a name collision happening within a single field. Another option is to have users check the already-attached file names on the record details screen before adding a new photo, confirming visually that no name is about to repeat. Neither approach resolves the underlying question of whether overwriting actually occurs, but both reduce how often the situation can arise in the first place.

## Test the behavior on a sample record before relying on it in production

If you're unsure how kintone handles same-name attachments, test it before trusting it with real data. Create a single test record, then attach two images that share exactly the same file name. After attaching both, check whether both files still appear in the list and open each one to confirm the contents haven't swapped or disappeared. This at least tells you how the behavior plays out in your own environment. Running this check before going live means that if a user later reports a photo "disappearing," you'll already know whether that's expected behavior or something else going wrong.

