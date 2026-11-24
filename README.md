# Arby's coordinator timeline

This repository hosts an encrypted, dated Arby's coordinator timeline. The viewer requires its complete private link, including the fragment key. Repository files contain generic viewer code and encrypted chart data; the plaintext chart and key are not committed.

The chart is read-only. Its provider and customer selection controls identify the work order or FORM project, but Outlook draft creation remains disabled while company sign-in, protected source checks, and the shared duplicate guard are completed. Thirsty remains the book of record for work-order changes. The chart displays its last verified time and warns when its work-order source is older than 24 hours.

Anyone with the complete link can view the decrypted chart. The `noindex` tag is advisory; it does not make a public GitHub Pages site private. There is no Power Apps or Power Automate runtime in this viewer.

## Held Outlook actions

This branch prepares two buttons: **Create or reopen provider parts draft**
for the selected Thirsty work order, and **Create or reopen customer milestone
draft** for the selected FORM project. The provider draft includes the six
reviewed PICOS-to-myCoke part links. The customer draft uses that project's
private tracker URL. Both open an editable, unsent Outlook draft; the app has
no Send control or `Mail.Send` scope. A separate Check Sent Items action can
record a verified sent copy in a shared receipt so another coordinator cannot
create a duplicate first draft through this app.

All buttons remain disabled in the checked-in build. Activation requires the
company sign-in and restricted SharePoint List grants, current protected WO
and contact reads, existing pilot-draft occupancy proof, and no-send canaries.
Passing local tests does not establish those live conditions.

The current build comes from
`source/gantt_github_two_button_site_integrated_source_only_20261123_v4_verified_prefill`.
Its only other runtime source packages are the V7 provider flow, lean Graph V3
actions, and provider snapshot resolver under `source/`. The pinned build and
public-file checks are in `scripts/`. The focused tests and checks were run
locally. This review branch omits a GitHub Actions workflow because the
available GitHub OAuth session cannot create or update workflow files; the
full workflow remains on the separate local branch.
