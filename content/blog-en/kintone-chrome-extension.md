---
slug: kintone-chrome-extension
lang: en
title: "What to check before installing a Chrome extension for kintone"
description: "Before adding a Chrome extension to make kintone easier to use, check its requested permissions, your company's admin policy, and whether it depends on kintone's screen layout."
date: 2026-10-22
theme: A
keyword: "kintone Chrome extension"
product: launcher
approved: true
reviewed: true
translated_from_sha1: 1aa18dadf1afd32caf915cc5eb11e13f2cc96358
translated_at: 2026-11-15T17:32:25-05:00
---

When you're looking for a Chrome extension to make kintone easier to use, there are three things worth checking first: how much access the extension requests, whether your company or admin needs to approve it, and whether the extension depends too heavily on kintone's screen layout. Chrome shows you permission prompts and admins can set policies, but neither one tells you how much an extension relies on kintone's on-screen elements.

## Check the scope of permissions it requests

Chrome extensions show the permissions they request at install time, and if an update adds a new permission, the extension is disabled until you approve it. Some extensions limit access to specific sites only, and request certain permissions, such as notifications, only when that feature is actually used. You can review the full permission list on the details screen at chrome://extensions, but that list only shows which resources the extension can access, not what the data is used for. It's worth also checking the extension's description and publisher before installing it.

## Check your company's policy and admin approval

If your company manages Chrome centrally, an admin may have already set a policy in the Google Admin console that allows or blocks extension installation. In other words, some environments let individual users install extensions freely, while others require a request to IT first. The standard Chrome interface is built around the assumption that anyone can install extensions on their own, and it won't tell you whether your workplace has a rule about it. It's safer to check with your IT department or manager before installing one.

## Extensions that rely on kintone's screen layout can break after updates

Chrome extensions built for kintone often mix two approaches: some parts use kintone's public JavaScript APIs, while other parts read elements directly off the screen. The parts built on the API tend to hold up even when kintone's interface changes, but the parts that read screen elements directly can stop working if the layout changes. Since you can't see how an extension is built internally, the best signal available is whether it's still being actively updated.

## Company policy decides the tool; you can still shape your own workflow

According to a note published by the developer of PlugBits Launcher, which tools, is a decision the company makes, but how you organize your own work is still something you can arrange yourself. Rather than modifying a company-wide system, the extension was built as a small tool that only runs within the user's own browser screen. The reasoning behind it is described in more detail in the note "kintone didn't have a command palette, so we built one" (https://note.com/plugbits/n/nc648a8a99f2e).

PlugBits Launcher is published as a free Chrome extension, with its permissions limited to kintone-related domains.
