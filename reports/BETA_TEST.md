# PlugBits Reports Beta Test

## Setup
1) Open plugin settings.
2) Enter:
   - API ベースURL
   - Worker API キー
   - kintone APIトークン (テンプレ編集で必要)
   - 添付ファイルフィールドコード
3) Click "テンプレを選ぶ" and pick a template.
4) Save settings.

## Template Lifecycle Tests
1) Create -> Select -> Output
   - Create a new template in the editor.
   - Select it in the picker and return to settings.
   - Confirm: name/updatedAt/status/valid badges show.
   - In record view, click "PDF出力 (PlugBits)" and verify PDF is attached.
2) Edit -> Save -> Output reflects changes
   - Open selected template, change a visible element, save.
   - Output PDF again and confirm the change is reflected.
3) Move to Trash -> Block output
   - Delete (soft) the selected template (Trash).
   - Return to settings: status shows Trash/無効 and warning text appears.
   - Record view: PDF output must be blocked with an alert.
4) Restore -> Output works
   - Restore the template from Trash.
   - Settings should show Active/有効.
   - Record view: PDF output works.
5) Delete permanently -> Block output
   - Purge the selected template.
   - Settings: status Not Found/無効 and warning text appears.
   - Record view: PDF output is blocked.

## Multi-user Scenario
1) User A selects a template and saves settings.
2) User B deletes or archives the same template.
3) User A opens settings:
   - Status should show Archived/Trash/Not Found and validity "無効".
   - Saving must be blocked until reselecting a valid template.
4) Record view:
   - PDF output must be blocked with the invalid template.

## Troubleshooting
| Symptom | Likely Cause | Action |
| --- | --- | --- |
| Missing Authorization | editorToken not included on editor-only endpoints | Launch editor/picker from plugin settings (session token is required). |
| Template not found | TemplateId does not exist or was deleted | Reselect a valid template in settings. |
| Unknown templateId | Mismatch between tenant (kintoneBaseUrl/appId) and stored template | Verify kintone app and workerBaseUrl, then reselect. |
| Unauthorized (401) | Wrong API key or expired editorToken | Check Worker API key in settings; relaunch editor/picker. |

## Visual Checks
- Settings page shows chips: template name, updatedAt, status, validity.
- Invalid template shows red warning text and "無効" badge.
- Record view button has blue styling and shows "出力中..." while running.
