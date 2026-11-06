---
slug: kintone-app-publish-setting
lang: en
title: "kintone App Permissions: How to Restrict Who Can Use an App (There's No Public/Private Toggle)"
description: "kintone apps don't have a single public/private switch. To restrict who can use an app, set its access permissions and consider whether it lives in a private space (as of October 2026)."
date: 2026-11-04
theme: A
keyword: "kintone app access permissions"
product: none
approved: true
reviewed: true
translated_from_sha1: 3eb03dbadedc74929afd0dc34d6955b0ea64bd99
translated_at: 2026-11-05T17:31:48-05:00
---

If you want to make a kintone app private, there's no "public" or "private" switch in the app settings screen (as of October 2026). To limit who can use an app, you have two options: set access permissions for that specific app, or build the app inside a private space.

## There's no single on/off switch to make an app private

Even after going through the app settings screen, you won't find a toggle labeled "public" or "private" (as of October 2026). The official kintone help guides administrators toward the app's access permissions settings instead, explaining that setting access permissions for an app lets you restrict which users can use it. If you want an app placed on your company portal to be limited to a specific department, you're not flipping a visibility switch on the app itself — you're narrowing down who is allowed to use it through access permissions. It helps to think of this not as a way to hide an app, but as a way to decide who is allowed to use it.

## Access permissions control who can actually use the app

Access permissions are set from the "Access Permissions" option under the app settings, where you choose "App" and then add users, organizations, or groups and check off the actions you want to allow. The official help notes that, by default, only the app creator is allowed to perform certain actions, specifically app management, importing files, and exporting files. Viewing and editing records, on the other hand, start out open to users beyond the creator by default, so if you want to narrow that down, you need to add rows yourself and define exactly who gets access. Permissions are evaluated with higher rows taking priority over lower ones, so if you're trying to carve out an exception for a specific user or group, pay close attention to the order of the rows (as of October 2026).

## Placing an app in a private space blocks anyone who isn't a space member

Where an app lives also affects who can reach it. The official kintone help explains that regardless of an app's access permission settings, users who are not members of a private space cannot access apps built inside that space. In other words, if you build an app inside a private space, you don't even need to fine-tune access permissions — anyone who isn't a member of that space is excluded from the start. Apps placed directly on the portal don't have this "space is public or private" mechanism at all (as of October 2026), so if you need to restrict access to one of those apps, setting access permissions is your only option.

## Check your app's settings to see exactly who can currently reach it

Open the "Access Permissions" option under the app settings for the app in question, and check how broad each allowed row is — everyone, a specific organization, or specific users. Next, check whether the app sits directly on the portal or inside a space; if it's inside a space, confirm whether that space is set to public or private. Looking at both of these settings together will tell you exactly how widely the app is currently exposed.
